"""Dashboard usage tracking: any signed-in user records their own activity.

Writes to an app-owned BigQuery table (``settings.dashboard_usage_events_table``,
see ``core/config.py``) via ``database.insert_rows`` — degrades to a logged
warning until Data Engineering creates the table, same pattern as the
E!nsight audit log and the weekly digest snapshot table.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class TrackEventRequest(BaseModel):
    event: str = Field(pattern="^(page_view|session_end)$")
    view: str = Field(min_length=1, max_length=50)
    session_id: str = Field(min_length=1, max_length=100)
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)


@router.post("/event")
def track_event(body: TrackEventRequest, user: UserAccess = Depends(current_user)):
    """Fire-and-forget: always 200s so a tracking hiccup never surfaces as a
    user-visible error. A missing table or bad row is logged, not raised."""
    row = {
        "event_id": str(uuid.uuid4()),
        "event_timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": body.event,
        "user_email": user.email,
        "view": body.view,
        "session_id": body.session_id,
        "duration_seconds": body.duration_seconds,
    }
    errors = database.insert_rows(settings.dashboard_events_table, [row])
    if errors:
        logger.warning("Usage-analytics write failed (table may not exist yet): %s", errors)
    return {"status": "ok"}
