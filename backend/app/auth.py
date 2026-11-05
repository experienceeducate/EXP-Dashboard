"""Authentication: Google SSO for staff, magic links for approved guests, and
server-side sessions for both (security review DATA-894, plan v1.3 §5).

  * Staff  → GET /api/auth/google/login → Google → /api/auth/google/callback,
    which redirects to ``FRONTEND_URL/#login_code=<one-time code>`` (60 s, single
    use — never a token in a URL); the SPA POSTs it to /api/auth/session/exchange.
  * Guests → POST /api/auth/request-access, an access manager approves them AND
    whitelists their email (separate controls), then POST /api/auth/magic-link
    emails a single-use 15-minute link; the landing page POSTs
    /api/auth/magic-link/redeem when the guest presses "Sign in".
  * The shared-password login (POST /api/auth/login) is gone: anyone who knew
    that password could sign in as ANY listed email, admins included.

Every session lives in core/guest_access.py: a 15-minute access JWT carrying
the session id (re-validated on every request, so revocation is immediate), a
rotating refresh token, an idle timeout and an absolute lifetime. Access scope
is re-resolved from the live mapping on every request, as before.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWTError as JWTError
from pydantic import BaseModel, Field

from app.core import access_runtime
from app.core import guest_access as ga
from app.core.access import UserAccess, resolve_access
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=True)
ACCESS_TOKEN_SECONDS = ga.ACCESS_TOKEN_SECONDS

# ── OAuth registration (only wired if creds are present) ─────────────────────
oauth = OAuth()
if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


# ── Tokens ───────────────────────────────────────────────────────────────────
def create_token(access: UserAccess, sid: str, kind: str = ga.KIND_STAFF, method: str = "google") -> str:
    """15-minute access token bound to a server-side session id."""
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "access",
        "sub": access.email,
        "sid": sid,
        "kind": kind,
        "via": method,
        "iat": now,
        "exp": now + timedelta(seconds=ACCESS_TOKEN_SECONDS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def guest_access(email: str, grant: dict) -> UserAccess:
    """A guest's scope is exactly the region or CU an access manager chose at
    approval. Never national, never admin, never an access manager, whatever
    lists the email may also be on."""
    scope_type = (grant or {}).get("scope_type")
    scope_key = (grant or {}).get("scope_key") or ""
    if scope_type == "regional" and scope_key:
        return UserAccess(email=email, regions=[scope_key], kind=ga.KIND_GUEST)
    if scope_type == "cu" and scope_key:
        return UserAccess(email=email, cus=[scope_key], kind=ga.KIND_GUEST)
    return UserAccess(email=email, kind=ga.KIND_GUEST)


def current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> UserAccess:
    """FastAPI dependency on every /api/* data route.

    Validates the session behind the token on every call (revoked, idle,
    expired or — for guests — no longer approved/whitelisted all end access
    immediately), then re-resolves the access scope fresh, so a mapping
    change applies to an already-signed-in user on their next request.
    """
    payload = _decode(creds.credentials)
    if payload.get("typ") != "access" or not payload.get("sid"):
        # Tokens issued before server-side sessions: refused (one-time sign-out).
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    store = access_runtime.ensure_loaded()
    try:
        session = store.validate(payload["sid"])
    except ga.AccessError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.public) from exc
    if session.email != payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    if session.kind == ga.KIND_GUEST:
        g = store.guests.get(session.email)
        user = guest_access(session.email, g.grant if g else {})
        user.access_expires_at = ga._iso(g.expires_at) if g else None
    else:
        user = resolve_access(session.email)
        user.kind = ga.KIND_STAFF
    user.session_id = session.sid
    user.session_expires_at = ga._iso(session.abs_expires_at)
    if not user.has_any_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has no dashboard access configured. Contact an admin.",
        )
    request.state.user_email = user.email
    return user


def _client_ip(request: Request) -> str:
    # uvicorn trusts X-Forwarded-For only from the cluster's private ranges
    # (Dockerfile --forwarded-allow-ips), so this is the client as nginx saw it.
    return request.client.host if request.client else ""


def _rate_limit_ip(request: Request) -> None:
    if not access_runtime.ip_limiter.allow(f"ip:{_client_ip(request)}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Too many requests. Please wait a few minutes and try again.")


def _session_response(grant: ga.SessionGrant, method: str) -> dict:
    if grant.kind == ga.KIND_GUEST:
        g = access_runtime.store.guests.get(grant.email)
        user = guest_access(grant.email, g.grant if g else {})
    else:
        user = resolve_access(grant.email)
    return {
        "status": "ok",
        "token": create_token(user, grant.sid, grant.kind, method),
        "refresh_token": grant.refresh_token,
        "expires_in": ACCESS_TOKEN_SECONDS,
        "session_expires_at": ga._iso(grant.abs_expires_at),
        "auth_kind": grant.kind,
        "user": user.to_dict(),
    }


def _unavailable() -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                         detail="Sign-in is temporarily unavailable. Try again shortly.")


# ── Google SSO ───────────────────────────────────────────────────────────────
def _google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


@router.get("/google/login")
async def google_login(request: Request):
    if not _google_configured():
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    redirect_uri = request.url_for("google_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


def _sso_error(code: str) -> RedirectResponse:
    """Send the browser back into the SPA with an error fragment it can render."""
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/#error={code}")


@router.get("/google/callback", name="google_callback")
async def google_callback(request: Request):
    store = access_runtime.ensure_loaded()
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:  # noqa: BLE001 — bad state, expired code, user-denied consent, etc.
        logger.exception("Google OAuth callback failed")
        store.record_auth_failure("oauth_failed", ip=_client_ip(request))
        return _sso_error("oauth_failed")

    userinfo = token.get("userinfo") or {}
    email = (userinfo.get("email") or "").strip().lower()
    domain = email.split("@")[-1] if "@" in email else ""
    if domain != settings.OAUTH_ALLOWED_DOMAIN or userinfo.get("email_verified") is False:
        store.record_auth_failure("domain_not_allowed", email or None, ip=_client_ip(request))
        return _sso_error("domain_not_allowed")

    if not resolve_access(email).has_any_access:  # parity with the old password path
        store.record_auth_failure("no_access", email, ip=_client_ip(request))
        return _sso_error("no_access")

    code = store.issue_login_code(email, ga.KIND_STAFF, "google")
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/#login_code={code}")


class CodeExchangeRequest(BaseModel):
    code: str = Field(..., min_length=10, max_length=200)


@router.post("/session/exchange")
def exchange_login_code(body: CodeExchangeRequest, request: Request):
    _rate_limit_ip(request)
    store = access_runtime.ensure_loaded()
    try:
        grant = store.exchange_login_code(body.code, ip=_client_ip(request))
    except ga.AccessError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.public) from exc
    except ga.PersistenceError as exc:
        raise _unavailable() from exc
    return _session_response(grant, "google")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=20, max_length=300)


@router.post("/session/refresh")
def refresh_session(body: RefreshRequest, request: Request):
    _rate_limit_ip(request)
    store = access_runtime.ensure_loaded()
    try:
        grant = store.refresh(body.refresh_token, ip=_client_ip(request))
    except ga.AccessError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.public) from exc
    except ga.PersistenceError as exc:
        raise _unavailable() from exc
    return _session_response(grant, store.sessions[grant.sid].method)


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        try:
            payload = jwt.decode(authorization[7:].strip(), settings.JWT_SECRET,
                                 algorithms=[settings.JWT_ALGORITHM])
        except JWTError:
            payload = {}
        if payload.get("sid"):
            try:
                access_runtime.ensure_loaded().logout(payload["sid"])
            except ga.PersistenceError:
                logger.warning("Logout applied in memory only (event log write failed)")
    return {"status": "ok"}


# ── Guests: request access, magic links ──────────────────────────────────────
class AccessRequestBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    organization: str = Field(..., min_length=1, max_length=200)
    reason: str = Field(..., min_length=1, max_length=1000)


@router.post("/request-access", status_code=status.HTTP_202_ACCEPTED)
def request_access(body: AccessRequestBody, request: Request):
    """Same response whatever the email's state; the write runs on the
    background queue, so response time reveals nothing either."""
    _rate_limit_ip(request)
    ip = _client_ip(request)
    try:
        email = ga.normalize_email(body.email)
    except ValueError:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if access_runtime.email_limiter.allow(f"request:{email}"):
        organization, reason = body.organization, body.reason

        def job():
            try:
                access_runtime.ensure_loaded().request_access(email, organization, reason, ip=ip)
            except ga.PersistenceError:
                logger.warning("An access request could not be recorded (event log write failed)")

        access_runtime.jobs.submit(job)
    return {"status": "ok", "message": ga.GENERIC_REQUEST_MESSAGE}


class MagicLinkRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


@router.post("/magic-link", status_code=status.HTTP_202_ACCEPTED)
def request_magic_link(body: MagicLinkRequest, request: Request):
    _rate_limit_ip(request)
    ip = _client_ip(request)
    try:
        email = ga.normalize_email(body.email)
    except ValueError:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if access_runtime.email_limiter.allow(f"link:{email}"):   # over the limit: silently dropped
        access_runtime.jobs.submit(access_runtime.send_magic_link_job(email, ip))
    return {"status": "ok", "message": ga.GENERIC_LINK_MESSAGE}


class RedeemRequest(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)


@router.post("/magic-link/redeem")
def redeem_magic_link(body: RedeemRequest, request: Request):
    _rate_limit_ip(request)
    store = access_runtime.ensure_loaded()
    try:
        grant = store.redeem_magic_link(body.token, ip=_client_ip(request))
    except ga.AccessError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.public) from exc
    except ga.PersistenceError as exc:
        raise _unavailable() from exc
    return _session_response(grant, "magic_link")


@router.get("/config")
def auth_config():
    """Public: lets the login screen show only the sign-in options that work."""
    return {
        "status": "ok",
        "google": _google_configured(),
        "guest_sign_in_available": access_runtime.guest_sign_in_available(),
    }


@router.get("/me")
def me(user: UserAccess = Depends(current_user)):
    return {"status": "ok", "user": user.to_dict()}


def person_level_user(user: UserAccess = Depends(current_user)) -> UserAccess:
    """current_user, minus the "National view only" tier.

    Any colleague on the allowed domain who isn't on a list gets national_only
    access: national aggregates for orientation. Before the security review
    that tier could also open every CU's school list, every mentor's scores
    and every free-text observer comment in the country (access_clause applies
    no filter to has_national). Person- and school-level drill-downs now need
    an explicit national, regional or CU grant.
    """
    if user.national_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Drill-down detail needs a national, regional or CU assignment. Ask an access manager.",
        )
    return user
