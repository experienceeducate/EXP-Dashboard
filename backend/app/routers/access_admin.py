"""Admin: CU->FOA / Region->PO access mapping editor.

Backed by an app-owned, append-only BigQuery table
(``settings.access_mapping_table`` — see DATA_ENG_BIGQUERY_TABLES_REQUEST.md
table 5), same "one row per action, latest wins" idiom as
``routers/tasks.py``. Viewing is gated to ``ACCESS_CONFIG["admin"]`` (every
admin); editing is gated to the narrower ``ACCESS_CONFIG["access_managers"]``
(see core/access.py) — Evelyne can see this, only Afra/Charlotte/John Bosco
can change it.

A change here takes effect immediately for anyone already logged in:
``current_user()`` re-resolves access from ``get_live_config()`` on every
request rather than trusting a JWT snapshot (see app/auth.py), and this
router invalidates the short-lived mapping cache right after a successful
write so that re-resolution picks the change up on the very next request.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth import current_user
from app.core import access, database
from app.core.access import UserAccess
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/access", tags=["admin", "access"])


@router.get("/mapping")
def get_mapping(user: UserAccess = Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access mapping is not available for this account.")
    config = access.get_live_config()
    return {
        "status": "ok",
        "regional": config.get("regional", {}),
        "cu": config.get("cu", {}),
        "canEdit": user.can_manage_access,
    }


class UpdateMappingRequest(BaseModel):
    scope_type: str = Field(pattern="^(regional|cu)$")
    scope_key: str = Field(min_length=1, max_length=200)
    add_email: str | None = Field(default=None, max_length=200)
    remove_email: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _at_least_one(self) -> "UpdateMappingRequest":
        if not (self.add_email or self.remove_email):
            raise ValueError("Provide add_email, remove_email, or both (a switch).")
        return self


@router.post("/mapping")
def update_mapping(body: UpdateMappingRequest, user: UserAccess = Depends(current_user)):
    if not user.can_manage_access:
        raise HTTPException(status_code=403, detail="Not permitted to edit the access mapping.")

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    if body.remove_email:
        rows.append({
            "event_id": str(uuid.uuid4()),
            "event_timestamp": now,
            "action": "remove",
            "scope_type": body.scope_type,
            "scope_key": body.scope_key,
            "user_email": body.remove_email.strip().lower(),
            "changed_by": user.email,
        })
    if body.add_email:
        rows.append({
            "event_id": str(uuid.uuid4()),
            "event_timestamp": now,
            "action": "add",
            "scope_type": body.scope_type,
            "scope_key": body.scope_key,
            "user_email": body.add_email.strip().lower(),
            "changed_by": user.email,
        })

    # Unlike tasks.py/analytics.py's writes, a failed write here is raised,
    # not swallowed into a logged-warning-but-still-200: an admin who thinks
    # they just revoked someone's access needs to know if that didn't
    # actually happen, rather than getting a false "ok".
    errors = database.insert_rows(settings.access_mapping_table, rows)
    if errors:
        logger.warning("Access-mapping write failed: %s", errors)
        raise HTTPException(status_code=502, detail="Failed to write the access-mapping change. Try again.")

    access.invalidate_dynamic_mapping_cache()
    return {"status": "ok"}
