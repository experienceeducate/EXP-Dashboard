"""Overview / summary data.

Serves the CU-level and school-level rows the authenticated user is scoped to,
in one call (mirrors the legacy ``?view=summary`` which split a combined payload
by ``level`` client-side). Row-level access filtering happens server-side.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.sql import access_clause, build_where, level_clause, term_clause
from app.core.tables import DASHBOARD_MODEL, LEVEL_CU, LEVEL_SCHOOL

router = APIRouter(prefix="/api/overview", tags=["overview"])


def _fetch_level(level: str, term: str | None, user: UserAccess) -> list[dict]:
    where, params = build_where(
        level_clause(level),
        term_clause(term),
        access_clause(user),
    )
    sql = f"SELECT * FROM {DASHBOARD_MODEL} {where}"
    return database.run_query(sql, params, scope_key=f"{user.scope_key}|{level}|{term}")


@router.get("/summary")
def summary(
    term: str | None = Query(default=None, description="term1|term2|term3, omit for all"),
    user: UserAccess = Depends(current_user),
):
    """Combined CU- and school-level rows within the caller's access scope."""
    cu_rows = _fetch_level(LEVEL_CU, term, user)
    school_rows = _fetch_level(LEVEL_SCHOOL, term, user)
    return {
        "status": "ok",
        "data": cu_rows + school_rows,
        "cu": cu_rows,
        "schools": school_rows,
        "access": user.to_dict(),
    }
