"""Issue-tracking follow-up state (Regional Issues + CU Priority Alerts).

Backed by an app-owned, append-only BigQuery table
(``settings.dashboard_tasks_table`` — see
DATA_ENG_BIGQUERY_TABLES_REQUEST.md table 2) — one row per ACTION, not per
issue. An issue's current status is derived as its latest row by
``action_timestamp``. Replaces the localStorage-only tracker in
``frontend/src/lib/issueTracker.js`` — same ``issue_key`` scheme
(``cu + issue_type + issue_detail``, so a changed detail is a new key and
"reappears" even if the old instance was resolved), now centralized instead
of per-browser.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.config import settings
from app.core.sql import access_clause, build_where

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _may_act_on(user: UserAccess, region: str, cu: str) -> bool:
    if user.has_national:
        return True
    if cu and cu.lower() in {c.lower() for c in user.cus}:
        return True
    if region and region in user.regions:
        return True
    return False


def _combine_notes(reason: str | None, notes: str | None) -> str:
    reason = (reason or "").strip()
    notes = (notes or "").strip()
    if reason and notes:
        return f"{reason} — {notes}"
    return reason or notes


@router.get("")
def list_task_status(user: UserAccess = Depends(current_user)):
    """Every issue_key's full action history within the caller's access
    scope, as ``{issue_key: {status, timeline: [...]}}`` — the same shape
    ``issueTracker.js`` used for its localStorage tracker."""
    clause, params = access_clause(user)
    where, params = build_where((clause, params))
    sql = f"""
        SELECT issue_key, status, reason, notes, user_email, action_timestamp
        FROM `{settings.dashboard_tasks_table}`
        {where}
        ORDER BY action_timestamp ASC
    """
    rows = database.query_rows_ignore_missing_table(sql, params)

    tasks: dict[str, dict] = {}
    for r in rows:
        entry = tasks.setdefault(r["issue_key"], {"status": "open", "timeline": []})
        entry["status"] = r["status"]
        entry["timeline"].append({
            "timestamp": r["action_timestamp"],
            "status": r["status"],
            "notes": _combine_notes(r.get("reason"), r.get("notes")),
            "user": r.get("user_email") or "—",
        })
    return {"status": "ok", "tasks": tasks}


class UpdateTaskRequest(BaseModel):
    issue_key: str = Field(min_length=1, max_length=300)
    region: str = Field(default="", max_length=100)
    cu: str = Field(default="", max_length=100)
    issue_type: str = Field(default="", max_length=100)
    issue_detail: str = Field(default="", max_length=500)
    severity: str = Field(default="", max_length=30)
    status: str = Field(pattern="^(open|in-progress|resolved)$")
    reason: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


@router.post("")
def update_task_status(body: UpdateTaskRequest, user: UserAccess = Depends(current_user)):
    if not _may_act_on(user, body.region, body.cu):
        raise HTTPException(status_code=403, detail="Not permitted to update issues for this region/CU.")

    now = datetime.now(timezone.utc)
    row = {
        "issue_key": body.issue_key,
        "region": body.region,
        "cu": body.cu,
        "issue_type": body.issue_type,
        "issue_detail": body.issue_detail,
        "severity": body.severity,
        "status": body.status,
        "reason": body.reason,
        "notes": body.notes,
        "user_email": user.email,
        "action_timestamp": now.isoformat(),
    }
    errors = database.insert_rows(settings.dashboard_tasks_table, [row])
    if errors:
        logger.warning("Task-tracking write failed (table may not exist yet): %s", errors)

    # Not re-queried from BigQuery: a streaming insert isn't guaranteed
    # visible to a query run immediately after (buffer latency), so the
    # caller builds its own optimistic timeline entry from what it just
    # sent plus this timestamp/user rather than re-fetching.
    return {
        "status": "ok",
        "timestamp": now.isoformat(),
        "user_email": user.email,
        "notes": _combine_notes(body.reason, body.notes),
    }
