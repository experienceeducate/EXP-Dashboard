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
        SELECT event_type, view, user_email, session_id, duration_seconds, event_timestamp
        FROM `{settings.dashboard_events_table}`
        WHERE event_timestamp >= @since
    """
    params = [bigquery.ScalarQueryParameter("since", "TIMESTAMP", since)]
    rows = database.query_rows_ignore_missing_table(sql, params)

    page_views: dict[str, int] = {}
    active_users: set[str] = set()
    durations: list[int] = []
    # Per-user breakdown, built from this same row set (no second query) —
    # active_seconds sums the real duration_seconds column rather than
    # counting heartbeat pings, since this table (unlike some other
    # dashboards') already captures actual elapsed time per session.
    by_user: dict[str, dict] = {}
    for r in rows:
        email = r.get("user_email")
        ts = r.get("event_timestamp")
        if email:
            active_users.add(email)
            u = by_user.setdefault(email, {
                "page_views": 0, "sessions": set(), "views": set(),
                "active_seconds": 0, "first_seen": None, "last_seen": None,
            })
            if r.get("session_id"):
                u["sessions"].add(r["session_id"])
            if ts is not None:
                if u["first_seen"] is None or ts < u["first_seen"]:
                    u["first_seen"] = ts
                if u["last_seen"] is None or ts > u["last_seen"]:
                    u["last_seen"] = ts
        if r.get("event_type") == "page_view":
            v = r.get("view") or "unknown"
            page_views[v] = page_views.get(v, 0) + 1
            if email:
                by_user[email]["page_views"] += 1
                by_user[email]["views"].add(v)
        elif r.get("event_type") == "session_end" and r.get("duration_seconds") is not None:
            durations.append(r["duration_seconds"])
            if email:
                by_user[email]["active_seconds"] += r["duration_seconds"]

    by_user_rows = sorted(
        (
            {
                "user_email": email,
                "page_views": u["page_views"],
                "sessions": len(u["sessions"]),
                "distinct_tabs": len(u["views"]),
                "active_seconds": u["active_seconds"],
                "first_seen": u["first_seen"],
                "last_seen": u["last_seen"],
            }
            for email, u in by_user.items()
        ),
        key=lambda row: -row["active_seconds"],
    )

    return {
        "page_views_by_tab": sorted(
            ({"view": v, "count": c} for v, c in page_views.items()),
            key=lambda row: -row["count"],
        ),
        "active_users": len(active_users),
        "total_sessions": len(durations),
        "avg_session_seconds": round(sum(durations) / len(durations), 1) if durations else 0,
        "by_user": by_user_rows,
    }


@router.get("/analytics-summary")
def analytics_summary(
    days: int = Query(default=30, ge=1, le=365),
    user: UserAccess = Depends(current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin analytics is not available for this account.")
    return {"status": "ok", **_summary(days)}
