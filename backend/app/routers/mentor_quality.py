"""Mentor Quality — LEC observation data, a second BigQuery source.

Distinct from ``DASHBOARD_MODEL``: sourced from ``silver_exp.exp_2026_lec_observation_form``
(per-observation ratings + free-text comments) and ``bronze_exp.mentor_2026``
(mentor roster, so CUs with zero observations still show up). See
docs/DECISION.md ADR-008 for why this is a second source and the CU-name /
term-format quirks it works around.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from google.cloud import bigquery

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.sql import VALID_TERMS, access_clause_fuzzy_cu, build_where, cu_clause_fuzzy
from app.core.tables import MENTOR_OBSERVATIONS, MENTOR_ROSTER
from app.core.theme_tags import summarize, tag_comment

router = APIRouter(prefix="/api/mentor-quality", tags=["mentor-quality"])

_TERM_PATTERN = "^(term1|term2|term3|all)$"

_SCORE_AVG_EXPR = (
    "(concept_clarity_score + visual_aids_score + participation_score + "
    "classroom_climate_score + entrepreneurship_examples_score + gender_inclusivity_score) / 6.0"
)
_SCORE_AVG_EXPR_O = (
    "(o.concept_clarity_score + o.visual_aids_score + o.participation_score + "
    "o.classroom_climate_score + o.entrepreneurship_examples_score + o.gender_inclusivity_score) / 6.0"
)


# The raw ``term`` source column is unreliable (bare "1"/"2", inconsistent with
# actual session dates in some rows) — the term is derived from the
# observation date instead, per the fixed 2026 programme calendar. Rows
# outside every window get NULL (excluded by a specific-term filter, still
# included under "all").
_TERM_DATE_RANGES = {
    "term1": ("2026-02-01", "2026-05-01"),
    "term2": ("2026-05-25", "2026-08-21"),
    "term3": ("2026-09-14", "2026-12-04"),
}

_TERM_CASE_EXPR = "CASE\n" + "\n".join(
    f"      WHEN DATE(date) BETWEEN DATE('{start}') AND DATE('{end}') THEN '{term}'"
    for term, (start, end) in _TERM_DATE_RANGES.items()
) + "\n      ELSE NULL\n    END"


def _term_filter_clause(term: str | None) -> tuple[str, list]:
    """Date-derived term filter — see ``_TERM_CASE_EXPR``."""
    if not term or term == "all":
        return "", []
    if term not in VALID_TERMS:
        raise ValueError(f"Unknown term: {term!r}")
    return (
        f"{_TERM_CASE_EXPR} = @term_val",
        [bigquery.ScalarQueryParameter("term_val", "STRING", term)],
    )


def _observation_base_cte(user: UserAccess, term: str | None) -> tuple[str, list]:
    """Shared, access + term scoped base: one row per mentor observation."""
    where, params = build_where(
        ("mentor_id IS NOT NULL", []),
        _term_filter_clause(term),
        access_clause_fuzzy_cu(user, param_prefix="obs"),
    )
    sql = rf"""
    observation_base AS (
      SELECT
        key AS observation_id,
        region,
        TRIM(INITCAP(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(cu, r'\s+', ' '), r'\s*-\s*|\s+', '-'))), '-') AS cu,
        {_TERM_CASE_EXPR} AS term,
        session_number,
        DATE(date) AS observation_date,
        CAST(mentor_id AS STRING) AS mentor_id,
        name AS observer_name,
        comments AS observer_comments,
        CAST(qn1 AS INT64) AS concept_clarity_score,
        CAST(qn1_1 AS INT64) AS visual_aids_score,
        CAST(qn2_0 AS INT64) AS participation_score,
        CAST(qn2_1 AS INT64) AS classroom_climate_score,
        CAST(qn4_0 AS INT64) AS entrepreneurship_examples_score,
        CAST(qn4_1 AS INT64) AS gender_inclusivity_score,
        CAST(qn3_0a AS INT64) AS attendance_o_level,
        CAST(qn3_0b AS INT64) AS attendance_a_level
      FROM {MENTOR_OBSERVATIONS}
      {where}
    )
    """
    return sql, params


def _mentor_roster_cte(user: UserAccess) -> tuple[str, list]:
    """Access-scoped mentor roster — the base so unobserved CUs still appear.

    "Active" = has ever logged in (``first_login_at``); the roster table has no
    explicit status/active column.
    """
    where, params = build_where(access_clause_fuzzy_cu(user, cu_col="COALESCE(cu, CU)", param_prefix="roster"))
    sql = rf"""
    mentor_roster AS (
      SELECT
        region,
        TRIM(INITCAP(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(cu, CU), r'\s+', ' '), r'\s*-\s*|\s+', '-'))), '-') AS cu_normalized,
        COUNT(DISTINCT CAST(mentor_ID AS STRING)) AS total_mentors_assigned,
        COUNT(DISTINCT IF(first_login_at IS NOT NULL, CAST(mentor_ID AS STRING), NULL)) AS active_mentors
      FROM {MENTOR_ROSTER}
      {where}
      GROUP BY region, cu_normalized
    )
    """
    return sql, params


@router.get("/summary")
def summary(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Region/CU/term mentor-quality rows — roster as base, so every CU appears.

    One row per (region, cu, term) — use for the per-term CU rankings table.
    For headline KPIs / region rollups (anything that sums across CUs), use
    ``/summary-by-cu`` instead so an "all terms" selection doesn't double-count
    mentors observed in more than one term.
    """
    roster_sql, roster_params = _mentor_roster_cte(user)
    obs_sql, obs_params = _observation_base_cte(user, term)
    sql = f"""
    WITH
    {roster_sql},
    {obs_sql},
    mentor_performance AS (
      SELECT region, cu, term, mentor_id,
        ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS mentor_quality_index
      FROM observation_base
      GROUP BY region, cu, term, mentor_id
    ),
    cu_overall_quality AS (
      SELECT
        region, cu, term,
        COUNT(DISTINCT observation_id) AS total_observations,
        COUNT(DISTINCT mentor_id) AS mentors_observed,
        COUNT(DISTINCT session_number) AS sessions_observed,
        MIN(observation_date) AS first_observation_date,
        MAX(observation_date) AS latest_observation_date,
        SUM(attendance_o_level + attendance_a_level) AS total_scholar_attendance,
        ROUND(AVG(attendance_o_level + attendance_a_level), 1) AS avg_attendance_per_session,
        ROUND(AVG(concept_clarity_score), 2) AS avg_concept_clarity,
        ROUND(AVG(visual_aids_score), 2) AS avg_visual_aids,
        ROUND(AVG((concept_clarity_score + visual_aids_score) / 2.0), 2) AS avg_section1_pedagogical_knowledge,
        ROUND(AVG(participation_score), 2) AS avg_participation,
        ROUND(AVG(classroom_climate_score), 2) AS avg_classroom_climate,
        ROUND(AVG((participation_score + classroom_climate_score) / 2.0), 2) AS avg_section2_facilitation_delivery,
        ROUND(AVG(entrepreneurship_examples_score), 2) AS avg_entrepreneurship_examples,
        ROUND(AVG(gender_inclusivity_score), 2) AS avg_gender_inclusivity,
        ROUND(AVG((entrepreneurship_examples_score + gender_inclusivity_score) / 2.0), 2) AS avg_section4_leadership_entrepreneurship,
        ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS overall_quality_index,
        ROUND(STDDEV(concept_clarity_score + visual_aids_score + participation_score +
                      classroom_climate_score + entrepreneurship_examples_score + gender_inclusivity_score), 2) AS quality_score_variability
      FROM observation_base
      GROUP BY region, cu, term
    ),
    mentor_categories AS (
      SELECT region, cu, term,
        COUNTIF(mentor_quality_index > 2.5) AS excellent,
        COUNTIF(mentor_quality_index >= 2.0 AND mentor_quality_index <= 2.5) AS meets,
        COUNTIF(mentor_quality_index < 2.0) AS below
      FROM mentor_performance
      GROUP BY region, cu, term
    )
    SELECT
      mr.region,
      mr.cu_normalized AS cu,
      c.term,
      mr.total_mentors_assigned,
      mr.active_mentors,
      COALESCE(c.mentors_observed, 0) AS mentors_observed,
      mr.total_mentors_assigned - COALESCE(c.mentors_observed, 0) AS mentors_not_observed,
      ROUND(SAFE_DIVIDE(c.mentors_observed, mr.total_mentors_assigned) * 100, 1) AS pct_mentors_observed,
      COALESCE(mc.excellent, 0) AS mentors_excellent,
      COALESCE(mc.meets, 0) AS mentors_meets,
      COALESCE(mc.below, 0) AS mentors_below,
      COALESCE(c.total_observations, 0) AS total_observations,
      COALESCE(c.sessions_observed, 0) AS sessions_observed,
      c.first_observation_date,
      c.latest_observation_date,
      COALESCE(c.total_scholar_attendance, 0) AS total_scholar_attendance,
      c.avg_attendance_per_session,
      c.avg_section1_pedagogical_knowledge,
      c.avg_section2_facilitation_delivery,
      c.avg_section4_leadership_entrepreneurship,
      c.overall_quality_index,
      CASE
        WHEN c.overall_quality_index > 2.5 THEN 'excellent'
        WHEN c.overall_quality_index >= 2.0 THEN 'meets'
        WHEN c.overall_quality_index < 2.0 THEN 'below'
        ELSE 'no_observations'
      END AS performance_rating,
      c.avg_concept_clarity,
      c.avg_visual_aids,
      c.avg_participation,
      c.avg_classroom_climate,
      c.avg_entrepreneurship_examples,
      c.avg_gender_inclusivity,
      c.quality_score_variability,
      CASE
        WHEN c.total_observations IS NULL THEN 'no_observations'
        WHEN c.total_observations < 3 THEN 'low_observation_count'
        WHEN c.quality_score_variability > 2.5 THEN 'high_variability'
        WHEN c.overall_quality_index < 1.5 THEN 'needs_urgent_support'
        WHEN c.mentors_observed < mr.total_mentors_assigned THEN 'not_all_mentors_observed'
        ELSE 'adequate_data'
      END AS data_quality_flag
    FROM mentor_roster mr
    LEFT JOIN cu_overall_quality c ON mr.region = c.region AND mr.cu_normalized = c.cu
    LEFT JOIN mentor_categories mc ON mr.region = mc.region AND mr.cu_normalized = mc.cu AND c.term = mc.term
    ORDER BY mr.region, mr.cu_normalized, c.term
    """
    params = roster_params + obs_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|mq-summary|{term}")
    return {"status": "ok", "data": rows}


@router.get("/summary-by-cu")
def summary_by_cu(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Region/CU mentor-quality rows collapsed across term (no per-term split).

    Use this — not ``/summary`` — for any rollup that sums across CUs (headline
    KPIs, region breakdown): ``/summary`` has one row per (region, cu, term), so
    naively summing its ``mentors_observed``/``total_observations`` under an
    "all terms" selection double-counts mentors observed in more than one term.
    Here ``observation_base`` is already scoped to the requested term (or left
    unfiltered for "all"), and grouping stops at (region, cu) so
    ``COUNT(DISTINCT mentor_id)`` etc. de-duplicate correctly either way.
    """
    roster_sql, roster_params = _mentor_roster_cte(user)
    obs_sql, obs_params = _observation_base_cte(user, term)
    sql = f"""
    WITH
    {roster_sql},
    {obs_sql},
    mentor_performance AS (
      SELECT region, cu, mentor_id,
        ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS mentor_quality_index
      FROM observation_base
      GROUP BY region, cu, mentor_id
    ),
    cu_overall_quality AS (
      SELECT
        region, cu,
        COUNT(DISTINCT observation_id) AS total_observations,
        COUNT(DISTINCT mentor_id) AS mentors_observed,
        COUNT(DISTINCT session_number) AS sessions_observed,
        ROUND(AVG(concept_clarity_score), 2) AS avg_concept_clarity,
        ROUND(AVG(visual_aids_score), 2) AS avg_visual_aids,
        ROUND(AVG(participation_score), 2) AS avg_participation,
        ROUND(AVG(classroom_climate_score), 2) AS avg_classroom_climate,
        ROUND(AVG(entrepreneurship_examples_score), 2) AS avg_entrepreneurship_examples,
        ROUND(AVG(gender_inclusivity_score), 2) AS avg_gender_inclusivity,
        ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS overall_quality_index,
        ROUND(STDDEV(concept_clarity_score + visual_aids_score + participation_score +
                      classroom_climate_score + entrepreneurship_examples_score + gender_inclusivity_score), 2) AS quality_score_variability
      FROM observation_base
      GROUP BY region, cu
    ),
    mentor_categories AS (
      SELECT region, cu,
        COUNTIF(mentor_quality_index > 2.5) AS excellent,
        COUNTIF(mentor_quality_index >= 2.0 AND mentor_quality_index <= 2.5) AS meets,
        COUNTIF(mentor_quality_index < 2.0) AS below
      FROM mentor_performance
      GROUP BY region, cu
    )
    SELECT
      mr.region,
      mr.cu_normalized AS cu,
      mr.total_mentors_assigned,
      mr.active_mentors,
      COALESCE(c.mentors_observed, 0) AS mentors_observed,
      mr.total_mentors_assigned - COALESCE(c.mentors_observed, 0) AS mentors_not_observed,
      ROUND(SAFE_DIVIDE(c.mentors_observed, mr.total_mentors_assigned) * 100, 1) AS pct_mentors_observed,
      COALESCE(mc.excellent, 0) AS mentors_excellent,
      COALESCE(mc.meets, 0) AS mentors_meets,
      COALESCE(mc.below, 0) AS mentors_below,
      COALESCE(c.total_observations, 0) AS total_observations,
      COALESCE(c.sessions_observed, 0) AS sessions_observed,
      c.avg_concept_clarity,
      c.avg_visual_aids,
      c.avg_participation,
      c.avg_classroom_climate,
      c.avg_entrepreneurship_examples,
      c.avg_gender_inclusivity,
      c.overall_quality_index,
      c.quality_score_variability,
      CASE
        WHEN c.total_observations IS NULL THEN 'no_observations'
        WHEN c.total_observations < 3 THEN 'low_observation_count'
        WHEN c.quality_score_variability > 2.5 THEN 'high_variability'
        WHEN c.overall_quality_index < 1.5 THEN 'needs_urgent_support'
        WHEN c.mentors_observed < mr.total_mentors_assigned THEN 'not_all_mentors_observed'
        ELSE 'adequate_data'
      END AS data_quality_flag
    FROM mentor_roster mr
    LEFT JOIN cu_overall_quality c ON mr.region = c.region AND mr.cu_normalized = c.cu
    LEFT JOIN mentor_categories mc ON mr.region = mc.region AND mr.cu_normalized = mc.cu
    ORDER BY mr.region, mr.cu_normalized
    """
    params = roster_params + obs_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|mq-summary-by-cu|{term}")
    return {"status": "ok", "data": rows}


@router.get("/sessions")
def sessions(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """National (access-scoped) session-level breakdown, e.g. LEC1..LEC14."""
    obs_sql, obs_params = _observation_base_cte(user, term)
    sql = rf"""
    WITH {obs_sql}
    SELECT
      term,
      session_number,
      COUNT(DISTINCT mentor_id) AS mentors_observed,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS avg_session_quality,
      ROUND(AVG((concept_clarity_score + visual_aids_score) / 2.0), 2) AS avg_section1_pedagogical,
      ROUND(AVG((participation_score + classroom_climate_score) / 2.0), 2) AS avg_section2_facilitation,
      ROUND(AVG((entrepreneurship_examples_score + gender_inclusivity_score) / 2.0), 2) AS avg_section4_leadership,
      COUNTIF(concept_clarity_score = 1) + COUNTIF(visual_aids_score = 1) +
        COUNTIF(participation_score = 1) + COUNTIF(classroom_climate_score = 1) +
        COUNTIF(entrepreneurship_examples_score = 1) + COUNTIF(gender_inclusivity_score = 1) AS total_low_ratings
    FROM observation_base
    GROUP BY term, session_number
    ORDER BY term, SAFE_CAST(REGEXP_EXTRACT(session_number, r'(\d+)') AS INT64)
    """
    rows = database.run_query(sql, obs_params, scope_key=f"{user.scope_key}|mq-sessions|{term}")
    return {"status": "ok", "data": rows}


@router.get("/questions")
def questions(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Access-scoped question-level (per rated dimension) performance."""
    obs_sql, obs_params = _observation_base_cte(user, term)
    sql = f"""
    WITH {obs_sql}
    SELECT
      term, q.question, q.section,
      ROUND(AVG(q.score), 2) AS avg_rating,
      COUNTIF(q.score = 3) AS rating3,
      COUNTIF(q.score = 2) AS rating2,
      COUNTIF(q.score = 1) AS rating1,
      COUNT(*) AS total_observations
    FROM observation_base,
    UNNEST([
      STRUCT('concept_clarity' AS question, 'Pedagogical Content Knowledge' AS section, concept_clarity_score AS score),
      STRUCT('visual_aids', 'Pedagogical Content Knowledge', visual_aids_score),
      STRUCT('participation', 'Facilitation & Delivery', participation_score),
      STRUCT('classroom_climate', 'Facilitation & Delivery', classroom_climate_score),
      STRUCT('entrepreneurship_examples', 'Leadership & Entrepreneurship', entrepreneurship_examples_score),
      STRUCT('gender_inclusivity', 'Leadership & Entrepreneurship', gender_inclusivity_score)
    ]) AS q
    GROUP BY term, q.question, q.section
    ORDER BY term, q.section, q.question
    """
    rows = database.run_query(sql, obs_params, scope_key=f"{user.scope_key}|mq-questions|{term}")
    return {"status": "ok", "data": rows}


@router.get("/mentors")
def mentors(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-mentor rows for one CU — the region → CU → mentor ID drill-down.

    Scoped the same way as every other endpoint here (access_clause_fuzzy_cu):
    a user without access to ``cu`` simply gets an empty list, no explicit 403
    — consistent with how the rest of this router handles out-of-scope CUs.
    """
    obs_sql, obs_params = _observation_base_cte(user, term)
    cu_filter, cu_params = cu_clause_fuzzy([cu], cu_col="cu", param_name="drill_cu_norm")
    where = f"WHERE {cu_filter}" if cu_filter else ""
    sql = f"""
    WITH {obs_sql}
    SELECT
      mentor_id,
      region,
      cu,
      COUNT(DISTINCT observation_id) AS total_observations,
      COUNT(DISTINCT session_number) AS sessions_observed,
      ROUND(AVG(concept_clarity_score), 2) AS avg_concept_clarity,
      ROUND(AVG(visual_aids_score), 2) AS avg_visual_aids,
      ROUND(AVG(participation_score), 2) AS avg_participation,
      ROUND(AVG(classroom_climate_score), 2) AS avg_classroom_climate,
      ROUND(AVG(entrepreneurship_examples_score), 2) AS avg_entrepreneurship_examples,
      ROUND(AVG(gender_inclusivity_score), 2) AS avg_gender_inclusivity,
      ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS mentor_quality_index
    FROM observation_base
    {where}
    GROUP BY mentor_id, region, cu
    ORDER BY mentor_quality_index DESC
    """
    params = obs_params + cu_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|mq-mentors|{cu.lower()}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/mentor-observations")
def mentor_observations(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    mentor_id: str = Query(..., min_length=1),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Every individual observation for one mentor — who observed them, when,
    the per-dimension scores, and the full comment. The mentor ID drill's leaf.
    """
    obs_sql, obs_params = _observation_base_cte(user, term)
    where, where_params = build_where(
        cu_clause_fuzzy([cu], cu_col="o.cu", param_name="detail_cu_norm"),
        ("o.mentor_id = @detail_mentor_id", [bigquery.ScalarQueryParameter("detail_mentor_id", "STRING", mentor_id)]),
    )
    sql = f"""
    WITH
    {obs_sql},
    mentor_name_lookup AS (
      SELECT CAST(mentor_ID AS STRING) AS mentor_id, ANY_VALUE(mentor_name) AS mentor_name
      FROM {MENTOR_ROSTER}
      WHERE CAST(mentor_ID AS STRING) = @detail_mentor_id
      GROUP BY mentor_id
    )
    SELECT
      o.observer_name,
      o.region,
      o.cu,
      o.term,
      o.session_number,
      o.observation_date,
      o.concept_clarity_score,
      o.visual_aids_score,
      o.participation_score,
      o.classroom_climate_score,
      o.entrepreneurship_examples_score,
      o.gender_inclusivity_score,
      ROUND({_SCORE_AVG_EXPR_O}, 2) AS observation_quality_index,
      o.observer_comments AS comment,
      mn.mentor_name
    FROM observation_base o
    LEFT JOIN mentor_name_lookup mn ON o.mentor_id = mn.mentor_id
    {where}
    ORDER BY o.observation_date
    """
    params = obs_params + where_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|mq-mentor-obs|{cu.lower()}|{mentor_id}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/comments")
def comments(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-observation comments, rules-based theme tagged (see core/theme_tags.py)."""
    obs_sql, obs_params = _observation_base_cte(user, term)
    sql = f"""
    WITH {obs_sql}
    SELECT region, cu, term, session_number, mentor_id, observation_date, observer_comments AS comment
    FROM observation_base
    WHERE observer_comments IS NOT NULL AND TRIM(observer_comments) != ''
    ORDER BY region, cu, term
    """
    rows = database.run_query(sql, obs_params, scope_key=f"{user.scope_key}|mq-comments|{term}")

    tagged = []
    for row in rows:
        themes = sorted({(m.key, m.label, m.sentiment) for m in tag_comment(row.get("comment") or "")})
        tagged.append({**row, "themes": [{"key": k, "label": lbl, "sentiment": sent} for k, lbl, sent in themes]})

    return {
        "status": "ok",
        "data": tagged,
        "theme_summary": summarize(rows, comment_field="comment"),
    }
