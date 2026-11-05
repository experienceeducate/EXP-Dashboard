"""Admin — individual guest access (security review DATA-894, plan v1.3 §5).

Replaces the shared dashboard password. A guest (a partner, a field officer on
a personal address) requests access or is invited; an access manager approves
them with ONE regional or CU scope and an end date (90 days by default), and —
as a separate control — puts their exact email on the whitelist. Only then can
the guest get a single-use sign-in link. Revocation is immediate.

Gating mirrors the access-mapping editor (routers/access_admin.py): every admin
can VIEW; only ``access_managers`` can CHANGE anything. A guest is never an
admin or access manager (auth.guest_access never sets those flags). Every
change is an audited event; no response or log line contains a token or link.

    GET    /api/admin/guests                    requests, guests, whitelist, scopes
    GET    /api/admin/guests/audit?limit=200    recent access events
    POST   /api/admin/guests/invite             {email, scope_type, scope_key, days?, organization?}
    POST   /api/admin/guests/approve            {email, scope_type, scope_key, days?, whitelist?}
    POST   /api/admin/guests/reject             {email, reason?}
    POST   /api/admin/guests/renew              {email, days?}
    POST   /api/admin/guests/revoke             {email}
    POST   /api/admin/guests/whitelist/add      {email}
    POST   /api/admin/guests/whitelist/remove   {email}

(Email in the body, not the path, and POST only: the dashboard's CORS policy
allows GET/POST, and emails in URLs end up in access logs.)
"""
from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import current_user
from app.core import access, access_runtime
from app.core import guest_access as ga
from app.core.access import UserAccess

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/guests", tags=["admin", "guests"])

ScopeType = Literal["regional", "cu"]


def _viewer(user: UserAccess = Depends(current_user)) -> UserAccess:
    if user.is_guest or not user.is_admin:
        raise HTTPException(status_code=403, detail="Guest access administration is not available for this account.")
    return user


def _manager(user: UserAccess = Depends(current_user)) -> UserAccess:
    if user.is_guest or not user.can_manage_access:
        raise HTTPException(status_code=403, detail="Not permitted to change guest access.")
    return user


def _store() -> ga.AccessStore:
    store = access_runtime.ensure_loaded()
    if not store.loaded:
        raise HTTPException(status_code=503, detail="Guest access records are unavailable right now. Try again shortly.")
    return store


def _email(raw: str) -> str:
    try:
        return ga.normalize_email(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Enter a valid email address")


def _available_scopes() -> dict:
    config = access.get_live_config()
    return {
        "regional": sorted(config.get("regional", {}).keys()),
        "cu": sorted(config.get("cu", {}).keys()),
    }


def _grant(scope_type: str, scope_key: str) -> dict:
    """A guest gets exactly one known region or CU — never national."""
    options = _available_scopes()[scope_type]
    match = next((k for k in options if k.lower() == scope_key.strip().lower()), None)
    if match is None:
        raise HTTPException(status_code=422, detail=f"Unknown {scope_type} scope: choose one from the list")
    return {"scope_type": scope_type, "scope_key": match}


def _run(fn):
    try:
        return fn()
    except ga.NotFoundError:
        raise HTTPException(status_code=404, detail="No such guest")
    except ga.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ga.PersistenceError:
        raise HTTPException(status_code=502, detail="The change could not be saved. If you were removing "
                            "access, it is in effect now but must be repeated so it survives a restart.")


@router.get("")
def list_guests(user: UserAccess = Depends(_viewer)):
    store = _store()
    rows = store.guest_rows()
    return {
        "status": "ok",
        "requests": [r for r in rows if r["status"] == ga.PENDING],
        "guests": [r for r in rows if r["status"] != ga.PENDING],
        "whitelist": store.whitelist_rows(),
        "defaultDays": store.config.default_access_days,
        "maxDays": store.config.max_access_days,
        "scopes": _available_scopes(),
        "signInAvailable": access_runtime.guest_sign_in_available(),
        "canEdit": user.can_manage_access,
    }


@router.get("/audit")
def audit(limit: int = Query(200, ge=1, le=1000), user: UserAccess = Depends(_viewer)):
    return {"status": "ok", "events": _store().audit_rows(limit)}


class EmailBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


class InviteBody(EmailBody):
    scope_type: ScopeType
    scope_key: str = Field(..., min_length=1, max_length=200)
    days: Optional[int] = Field(None, ge=1, le=365)
    organization: Optional[str] = Field(None, max_length=200)


@router.post("/invite")
def invite(body: InviteBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    grant = _grant(body.scope_type, body.scope_key)
    _run(lambda: store.invite(email, user.email, grant, body.days, body.organization))
    sent = access_runtime.guest_sign_in_available()
    if sent:
        access_runtime.jobs.submit(access_runtime.send_magic_link_job(email, None))
    return {"status": "ok", "linkSent": sent}


class ApproveBody(EmailBody):
    scope_type: ScopeType
    scope_key: str = Field(..., min_length=1, max_length=200)
    days: Optional[int] = Field(None, ge=1, le=365)
    whitelist: bool = True


@router.post("/approve")
def approve(body: ApproveBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    grant = _grant(body.scope_type, body.scope_key)
    _run(lambda: store.approve(email, user.email, grant, body.days))
    if body.whitelist and email not in store.whitelist:
        _run(lambda: store.whitelist_add(email, user.email))
    return {"status": "ok"}


class RejectBody(EmailBody):
    reason: Optional[str] = Field(None, max_length=500)


@router.post("/reject")
def reject(body: RejectBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    _run(lambda: store.reject(email, user.email, body.reason))
    return {"status": "ok"}


class RenewBody(EmailBody):
    days: Optional[int] = Field(None, ge=1, le=365)


@router.post("/renew")
def renew(body: RenewBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    g = _run(lambda: store.renew(email, user.email, body.days))
    return {"status": "ok", "expiresAt": ga._iso(g.expires_at)}


@router.post("/revoke")
def revoke(body: EmailBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    sessions = _run(lambda: store.revoke(email, user.email))
    return {"status": "ok", "sessionsRevoked": sessions}


@router.post("/whitelist/add")
def whitelist_add(body: EmailBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    _run(lambda: store.whitelist_add(email, user.email))
    return {"status": "ok"}


@router.post("/whitelist/remove")
def whitelist_remove(body: EmailBody, user: UserAccess = Depends(_manager)):
    store, email = _store(), _email(body.email)
    _run(lambda: store.whitelist_remove(email, user.email))
    return {"status": "ok"}
