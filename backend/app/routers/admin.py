"""Admin: dashboard usage analytics (page views, active users, session length).

Gated to ``ACCESS_CONFIG["admin"]`` (see core/access.py) — independent of
national/regional/cu row-scoping, since this reads usage events, not
programme rows. ``/availability`` is open to any signed-in user so the SPA
can decide whether to render the tab, same pattern as E!nsight's
``/availability`` (routers/ensight.py).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import bigquery

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/availability")
def availability(user: UserAccess = Depends(current_user)):
    return {"status": "ok", "available": user.is_admin}


def _summary(days: int) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    sql = f"""
        SELECT event_type, view, user_email, duration_seconds
        FROM `{settings.dashboard_events_table}`
        WHERE event_timestamp >= @since
    """
    params = [bigquery.ScalarQueryParameter("since", "TIMESTAMP", since)]
    rows = database.query_rows_ignore_missing_table(sql, params)

    page_views: dict[str, int] = {}
    active_users: set[str] = set()
    durations: list[int] = []
    for r in rows:
        if r.get("user_email"):
            active_users.add(r["user_email"])
        if r.get("event_type") == "page_view":
            v = r.get("view") or "unknown"
            page_views[v] = page_views.get(v, 0) + 1
        elif r.get("event_type") == "session_end" and r.get("duration_seconds") is not None:
            durations.append(r["duration_seconds"])

    return {
        "page_views_by_tab": sorted(
            ({"view": v, "count": c} for v, c in page_views.items()),
            key=lambda row: -row["count"],
        ),
        "active_users": len(active_users),
        "total_sessions": len(durations),
        "avg_session_seconds": round(sum(durations) / len(durations), 1) if durations else 0,
    }


@router.get("/analytics-summary")
def analytics_summary(
    days: int = Query(default=30, ge=1, le=365),
    user: UserAccess = Depends(current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin analytics is not available for this account.")
    return {"status": "ok", **_summary(days)}
