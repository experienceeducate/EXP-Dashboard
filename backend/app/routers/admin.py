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
from app.core import access, database
from app.core.access import UserAccess, resolve_access
from app.core.config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])

# The 3 rostered categories usability rate is computed against — each has a
# fixed total (a roster size), so "active / total" is a real rate. A domain-
# fallback National-view login (any @experienceeducate.org email not
# explicitly listed anywhere) has no fixed roster to divide by, so it's
# classified "other" and excluded from these 3, not folded into "national".
_ROLE_CATEGORIES = ("national", "regional", "cu")


def _role_for(email: str, config: dict) -> str:
    u = resolve_access(email, config=config)
    if u.has_national and not u.national_only:
        return "national"
    if u.regions:
        return "regional"
    if u.cus:
        return "cu"
    return "other"


def _role_totals(config: dict) -> dict[str, int]:
    regional_emails = {e for emails in config.get("regional", {}).values() for e in emails}
    cu_emails = {e for emails in config.get("cu", {}).values() for e in emails}
    return {
        "national": len(config.get("national", [])),
        "regional": len(regional_emails),
        "cu": len(cu_emails),
    }


def _week_start(ts) -> str | None:
    """Monday of ts's ISO week, as YYYY-MM-DD. ``ts`` is normally a datetime
    (real BigQuery TIMESTAMP rows), but tests mock rows with plain ISO
    strings, so parse those too rather than assume one shape."""
    if ts is None:
        return None
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts)
        except ValueError:
            return None
    d = ts.date() if hasattr(ts, "date") else ts
    return (d - timedelta(days=d.weekday())).isoformat()


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

    config = access.get_live_config()
    role_cache: dict[str, str] = {}

    def role_for(email: str) -> str:
        if email not in role_cache:
            role_cache[email] = _role_for(email, config)
        return role_cache[email]

    page_views: dict[str, int] = {}
    active_users: set[str] = set()
    durations: list[int] = []
    # Per-user breakdown, built from this same row set (no second query) —
    # active_seconds sums the real duration_seconds column rather than
    # counting heartbeat pings, since this table (unlike some other
    # dashboards') already captures actual elapsed time per session.
    by_user: dict[str, dict] = {}
    # (week_start, role) -> distinct active emails that week, for the
    # weekly usability trend (active / that role's fixed roster size).
    weekly_role_users: dict[tuple[str, str], set[str]] = {}
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
                week = _week_start(ts)
                role = role_for(email)
                if week and role in _ROLE_CATEGORIES:
                    weekly_role_users.setdefault((week, role), set()).add(email)
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
                "role": role_for(email),
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

    role_totals = _role_totals(config)
    weeks = sorted({week for (week, _role) in weekly_role_users})
    by_week_role = []
    for week in weeks:
        entry: dict = {"week_start": week}
        for role in _ROLE_CATEGORIES:
            active = len(weekly_role_users.get((week, role), set()))
            total = role_totals.get(role, 0)
            entry[role] = {
                "active_users": active,
                "total_users": total,
                "usability_pct": round((active / total) * 100, 1) if total > 0 else 0,
            }
        by_week_role.append(entry)

    return {
        "page_views_by_tab": sorted(
            ({"view": v, "count": c} for v, c in page_views.items()),
            key=lambda row: -row["count"],
        ),
        "active_users": len(active_users),
        "total_sessions": len(durations),
        "avg_session_seconds": round(sum(durations) / len(durations), 1) if durations else 0,
        "by_user": by_user_rows,
        "role_totals": role_totals,
        "by_week_role": by_week_role,
    }


@router.get("/analytics-summary")
def analytics_summary(
    days: int = Query(default=30, ge=1, le=365),
    user: UserAccess = Depends(current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin analytics is not available for this account.")
    return {"status": "ok", **_summary(days)}
