"""E-Lab (mentor digital-lesson activity) — a third BigQuery source.

Sourced from ``silver_exp.exp_elab_mentor_activity_report`` (one row per
mentor x lesson attempt), not ``gold_exp``. See docs/DECISION.md for why this
is a separate source, same reasoning as Mentor Quality (ADR-008).

Scope for v1 (see plan): only the term's ``LEC_``-prefixed lessons count as
"sessions" — that's what ties an e-lab lesson to a specific LEC number via
``core.metric_rollup.TERM_LECS``. Non-LEC-prefixed curriculum lessons (e.g.
``Financial_Management``, ``Milestone_1``) aren't counted here.

"Active mentors" (the completion-rate denominator) comes from
``gold_exp``'s ``total_active_mentors`` — the e-lab table has no active/status
column of its own. That denominator is a CU/region-level aggregate with no
gender or mentor/co-mentor split, so it can't be used for the gender/role
breakdowns below; those instead show completion against mentors who have any
e-lab record in that slice (labelled accordingly, not as "active mentors").
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from google.cloud import bigquery

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.metric_rollup import lecs_for_term
from app.core.sql import access_clause, access_clause_fuzzy_cu, build_where, level_clause, term_clause
from app.core.tables import DASHBOARD_MODEL, ELAB_ACTIVITY

router = APIRouter(prefix="/api/elab", tags=["elab"])

_TERM_PATTERN = "^(term1|term2|term3)$"

# Normalizes CU spelling drift between this source and gold_exp (e.g.
# "Busia-Namayingo" vs "busia - namayingo") into one canonical hyphenated
# form so the two can be joined — same expression already used for this in
# routers/mentor_quality.py.
_CU_NORMALIZE_EXPR = "TRIM(INITCAP(TRIM(REGEXP_REPLACE(REGEXP_REPLACE({col}, r'\\s+', ' '), r'\\s*-\\s*|\\s+', '-'))), '-')"


def _elab_sessions_cte(user: UserAccess, term: str, lec_nums: list[int]) -> tuple[str, list]:
    """One row per (region, cu, mentor, lec_num) the caller may see, scoped to
    this term's expected LEC-numbered lessons only."""
    where, params = build_where(
        ("mentor_id IS NOT NULL", []),
        ("REGEXP_CONTAINS(lesson_name, r'^LEC_\\d+_')", []),
        term_clause(term, param_name="elab_term"),
        (
            "CAST(REGEXP_EXTRACT(lesson_name, r'^LEC_(\\d+)_') AS INT64) IN UNNEST(@lec_nums)",
            [bigquery.ArrayQueryParameter("lec_nums", "INT64", lec_nums)],
        ),
        access_clause_fuzzy_cu(user, cu_col="CU", param_prefix="elab"),
    )
    sql = f"""
    elab_sessions AS (
      SELECT
        region,
        {_CU_NORMALIZE_EXPR.format(col="CU")} AS cu,
        CAST(mentor_id AS STRING) AS mentor_id,
        ANY_VALUE(mentor_name) AS mentor_name,
        CASE
          WHEN LOWER(TRIM(gender)) = 'female' THEN 'female'
          WHEN LOWER(TRIM(gender)) = 'male' THEN 'male'
          ELSE 'unknown'
        END AS gender,
        CASE
          WHEN LOWER(TRIM(position)) LIKE '%co%' THEN 'co_mentor'
          WHEN LOWER(TRIM(position)) LIKE '%mentor%' THEN 'mentor'
          ELSE 'unknown'
        END AS role,
        CAST(REGEXP_EXTRACT(lesson_name, r'^LEC_(\\d+)_') AS INT64) AS lec_num,
        ANY_VALUE(lesson_name) AS lesson_name,
        MAX(date_started) AS started_at,
        MAX(date_finished) AS finished_at
      FROM {ELAB_ACTIVITY}
      {where}
      GROUP BY region, cu, mentor_id, gender, role, lec_num
    )
    """
    return sql, params


def _cu_roster_cte(user: UserAccess, term: str) -> tuple[str, list]:
    """Access-scoped, term-scoped active-mentor count per CU from gold_exp —
    the base so a CU with zero e-lab activity still appears at 0%."""
    where, params = build_where(level_clause("cu"), term_clause(term, param_name="roster_term"), access_clause(user))
    sql = f"""
    cu_roster AS (
      SELECT
        region,
        {_CU_NORMALIZE_EXPR.format(col="cu")} AS cu,
        SUM(total_active_mentors) AS active_mentors
      FROM {DASHBOARD_MODEL}
      {where}
      GROUP BY region, cu
    )
    """
    return sql, params


@router.get("/summary-by-cu")
def summary_by_cu(
    term: str = Query(default="term3", pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Region/CU e-lab completion rollup: active mentors (gold_exp), sessions
    completed/in-progress, overall completion %, per-session breakdown, and
    mentor-vs-co-mentor / gender slices (see module docstring for why those
    slices use a different, clearly-separate denominator)."""
    lec_nums = lecs_for_term(term)
    roster_sql, roster_params = _cu_roster_cte(user, term)
    sessions_sql, sessions_params = _elab_sessions_cte(user, term, lec_nums)
    sql = f"""
    WITH
    {roster_sql},
    {sessions_sql},
    cu_totals AS (
      SELECT
        region, cu,
        COUNT(DISTINCT mentor_id) AS mentors_with_activity,
        COUNTIF(finished_at IS NOT NULL) AS sessions_completed,
        COUNTIF(started_at IS NOT NULL AND finished_at IS NULL) AS sessions_in_progress
      FROM elab_sessions
      GROUP BY region, cu
    ),
    per_session AS (
      SELECT region, cu, lec_num, ANY_VALUE(lesson_name) AS lesson_name,
        COUNTIF(finished_at IS NOT NULL) AS completed_mentors
      FROM elab_sessions
      GROUP BY region, cu, lec_num
    ),
    per_session_agg AS (
      SELECT ps.region, ps.cu,
        ARRAY_AGG(STRUCT(
          ps.lec_num,
          ps.lesson_name,
          ps.completed_mentors,
          ROUND(SAFE_DIVIDE(ps.completed_mentors, r.active_mentors) * 100, 1) AS pct
        ) ORDER BY ps.lec_num) AS sessions
      FROM per_session ps
      JOIN cu_roster r ON r.region = ps.region AND r.cu = ps.cu
      GROUP BY ps.region, ps.cu
    ),
    by_slice AS (
      SELECT region, cu, 'role' AS dimension, role AS slice_value,
        COUNT(DISTINCT mentor_id) AS mentors_with_activity,
        COUNTIF(finished_at IS NOT NULL) AS sessions_completed,
        COUNTIF(started_at IS NOT NULL AND finished_at IS NULL) AS sessions_in_progress
      FROM elab_sessions
      GROUP BY region, cu, role
      UNION ALL
      SELECT region, cu, 'gender' AS dimension, gender AS slice_value,
        COUNT(DISTINCT mentor_id) AS mentors_with_activity,
        COUNTIF(finished_at IS NOT NULL) AS sessions_completed,
        COUNTIF(started_at IS NOT NULL AND finished_at IS NULL) AS sessions_in_progress
      FROM elab_sessions
      GROUP BY region, cu, gender
    ),
    by_slice_agg AS (
      SELECT region, cu,
        ARRAY_AGG(STRUCT(dimension, slice_value, mentors_with_activity, sessions_completed, sessions_in_progress)
          ORDER BY dimension, slice_value) AS breakdowns
      FROM by_slice
      GROUP BY region, cu
    )
    SELECT
      r.region,
      r.cu,
      r.active_mentors,
      COALESCE(t.mentors_with_activity, 0) AS mentors_with_activity,
      COALESCE(t.sessions_completed, 0) AS sessions_completed,
      COALESCE(t.sessions_in_progress, 0) AS sessions_in_progress,
      ROUND(SAFE_DIVIDE(COALESCE(t.sessions_completed, 0), r.active_mentors * {len(lec_nums)}) * 100, 1) AS overall_completion_pct,
      COALESCE(ps.sessions, []) AS sessions,
      COALESCE(bs.breakdowns, []) AS breakdowns
    FROM cu_roster r
    LEFT JOIN cu_totals t ON t.region = r.region AND t.cu = r.cu
    LEFT JOIN per_session_agg ps ON ps.region = r.region AND ps.cu = r.cu
    LEFT JOIN by_slice_agg bs ON bs.region = r.region AND bs.cu = r.cu
    ORDER BY r.region, r.cu
    """
    params = roster_params + sessions_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|elab-summary-by-cu|{term}")
    return {"status": "ok", "term": term, "expected_sessions": lec_nums, "data": rows}


@router.get("/mentors")
def mentors(
    cu: str = Query(...),
    term: str = Query(default="term3", pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-mentor e-lab completion for one CU — CU View's detail table."""
    lec_nums = lecs_for_term(term)
    sessions_sql, sessions_params = _elab_sessions_cte(user, term, lec_nums)
    sql = f"""
    WITH
    {sessions_sql}
    SELECT
      region,
      cu,
      mentor_id,
      mentor_name,
      gender,
      role,
      COUNTIF(finished_at IS NOT NULL) AS sessions_completed,
      COUNTIF(started_at IS NOT NULL AND finished_at IS NULL) AS sessions_in_progress,
      ROUND(SAFE_DIVIDE(COUNTIF(finished_at IS NOT NULL), {len(lec_nums)}) * 100, 1) AS completion_pct,
      ARRAY_AGG(STRUCT(
        lec_num,
        lesson_name,
        started_at,
        finished_at,
        CASE
          WHEN finished_at IS NOT NULL THEN 'completed'
          WHEN started_at IS NOT NULL THEN 'in_progress'
          ELSE 'not_started'
        END AS status
      ) ORDER BY lec_num) AS sessions
    FROM elab_sessions
    WHERE cu = {_CU_NORMALIZE_EXPR.format(col="@cu")}
    GROUP BY region, cu, mentor_id, mentor_name, gender, role
    ORDER BY mentor_name
    """
    params = sessions_params + [bigquery.ScalarQueryParameter("cu", "STRING", cu)]
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|elab-mentors|{cu}|{term}")
    return {"status": "ok", "term": term, "expected_sessions": lec_nums, "data": rows}
