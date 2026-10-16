"""Mentoring Week — which schools have reported each mentoring trip.

Source: ``MENTOR_ACTIVITY_REPORT`` (silver_exp.exp_common_mentor_activity_report),
the table mentor reports land in, filtered to ``report_type`` 'Mentoring_week'
(trimmed, case-insensitive). No year or term is hard-coded: rows keep their
year and term, and the term filter is the same optional ``term`` parameter the
Mentor Quality endpoints take (omitted or 'all' = every term). Year is applied
on the frontend from the dashboard's year selector, as for the gold rows. The
source's term column is mixed case ('term3' / 'Term3'), so it is compared
trimmed and lower-cased. The trip comes
from ``mentoring_week_category``, trimmed and case-insensitive:
"Mentoring week - Trip 1" → 1, "Mentoring week - Trip 2" → 2. NULL or any other
value counts toward neither trip.

Returns one row per school_id, year and term with whether the school has at
least one report for each trip. Grouping by school_id is what makes the
counts distinct, so duplicate rows never inflate a percentage. Region, CU,
mentor and FOA come from the gold school master list on the frontend (joined
on school_id), not from this source.

Read live on every request (``use_cache=False``) so new reports show up as
soon as they land, not after the in-memory query cache expires.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from google.cloud import bigquery

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.sql import access_clause_fuzzy_cu, build_where
from app.core.tables import MENTOR_ACTIVITY_REPORT

router = APIRouter(prefix="/api/mentoring-week", tags=["mentoring-week"])

_TERM_PATTERN = "^(term1|term2|term3|all)$"
_IS_MENTORING_WEEK = "LOWER(TRIM(report_type)) = 'mentoring_week'"
_TRIP_EXPR = """CASE LOWER(TRIM(mentoring_week_category))
        WHEN 'mentoring week - trip 1' THEN 1
        WHEN 'mentoring week - trip 2' THEN 2
      END"""


@router.get("/schools")
def schools(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-school Mentoring Week reporting, one row per school/year/term:
    ``trip1`` / ``trip2`` are true when the school has at least one report for
    that trip. Access-scoped like the other silver sources (fuzzy CU match,
    since CU spelling differs here). ``term`` 'all' or omitted = every term."""
    term_clause = (
        ("LOWER(TRIM(term)) = @mw_term", [bigquery.ScalarQueryParameter("mw_term", "STRING", term)])
        if term and term != "all" else ("", [])
    )
    where, params = build_where(
        (_IS_MENTORING_WEEK, []),
        term_clause,
        access_clause_fuzzy_cu(user, region_col="region", cu_col="CU", param_prefix="mw"),
    )
    sql = f"""
    SELECT
      CAST(school_id AS STRING) AS school_id,
      year,
      term,
      LOGICAL_OR(trip = 1) AS trip1,
      LOGICAL_OR(trip = 2) AS trip2
    FROM (
      SELECT school_id, year, LOWER(TRIM(term)) AS term, {_TRIP_EXPR} AS trip
      FROM {MENTOR_ACTIVITY_REPORT}
      {where}
    )
    WHERE school_id IS NOT NULL AND trip IS NOT NULL
    GROUP BY school_id, year, term
    """
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|mentoring-week|{term}", use_cache=False)
    return {"status": "ok", "data": rows}
