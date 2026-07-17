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
from app.core.tables import (
    GROUP_MENTORING_OBSERVATIONS,
    MENTOR_OBSERVATIONS,
    MENTOR_ROSTER,
    SKILLS_DAY_OBSERVATIONS,
)
from app.core.theme_tags import SKILLS_DAY_THEMES, merge_summaries, summarize, tag_comment

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


def _term_filter_clause(
    term: str | None, case_expr: str = _TERM_CASE_EXPR, param_name: str = "term_val"
) -> tuple[str, list]:
    """Date-derived term filter — see ``_TERM_CASE_EXPR``.

    ``case_expr``/``param_name`` let other date-derived sources (e.g. Skills
    Day, which has no reliable ``term`` column of its own) reuse this against
    their own date column without colliding on parameter names.
    """
    if not term or term == "all":
        return "", []
    if term not in VALID_TERMS:
        raise ValueError(f"Unknown term: {term!r}")
    return (
        f"{case_expr} = @{param_name}",
        [bigquery.ScalarQueryParameter(param_name, "STRING", term)],
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


def _col(existing_cols: set[str], alias: str, name: str) -> str:
    """Reference a column only if the live table schema currently has it.

    Skills Day and Group Mentoring are both mid-term forms whose exported
    schema can drop a rating column entirely while it has zero populated
    rows (observed directly: Group Mentoring's ``t2_q*`` Term 2 columns
    disappeared from the live schema between two schema checks minutes
    apart, even though Term 2 rows already existed). Referencing a column
    BigQuery doesn't currently have is a hard query error, not a NULL — this
    degrades to SQL ``NULL`` instead. See docs/DECISION.md ADR-008 follow-up.
    """
    return f"{alias}.{name}" if name in existing_cols else "NULL"


def _mentor_cu_lookup_cte() -> str:
    """Resolve ``mentor_id -> (cu, mentor_name)`` via the roster.

    Neither Skills Day nor Group Mentoring carries a ``cu`` column directly
    (only ``region`` + ``school_name``) — this is the join every base CTE in
    those two sections uses to recover it. Unscoped by design: access control
    is applied afterward, against the resolved ``cu``/the source row's own
    ``region``, not here.
    """
    return rf"""
    mentor_cu_lookup AS (
      SELECT
        CAST(mentor_ID AS STRING) AS mentor_id,
        ANY_VALUE(TRIM(INITCAP(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(cu, CU), r'\s+', ' '), r'\s*-\s*|\s+', '-'))), '-')) AS cu,
        ANY_VALUE(mentor_name) AS mentor_name
      FROM {MENTOR_ROSTER}
      GROUP BY mentor_id
    )
    """


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


# ── Group Mentoring observation (4th source — silver_exp.exp_2026_group_mentoring__observation__form) ──
# Term 1 and Term 2 sessions are rated on genuinely different rubrics (Term 1:
# a single generic "Beginning Inquiries" form; Term 2: GM2 "Create a Product"
# vs GM3 "Launch and Make a Sale", each with their own bespoke option labels).
# `overall_score`/`guidance_score`/`action_plan_score` normalize the closest
# equivalent question from whichever rubric applies so quality_index is
# comparable across terms; `engagement_score`/`passbook_referenced`/
# `session_opened_with_milestone` only exist on the Term 2 rubric and are NULL
# for Term 1 rows. See docs/DECISION.md ADR-008 follow-up.

_GM_QUALITY_AVG_EXPR = "(overall_score + guidance_score + action_plan_score) / 3.0"
_GM_QUALITY_AVG_EXPR_O = _GM_QUALITY_AVG_EXPR.replace("overall_score", "o.overall_score").replace(
    "guidance_score", "o.guidance_score"
).replace("action_plan_score", "o.action_plan_score")


def _gm_term_filter_clause(term: str | None) -> tuple[str, list]:
    """Group Mentoring has its own reliable ``term`` column ('1'/'2') — no
    date-derivation needed, unlike LEC/Skills Day."""
    if not term or term == "all":
        return "", []
    if term not in VALID_TERMS:
        raise ValueError(f"Unknown term: {term!r}")
    term_num = {"term1": "1", "term2": "2", "term3": "3"}[term]
    return "g.term = @gm_term_val", [bigquery.ScalarQueryParameter("gm_term_val", "STRING", term_num)]


def _group_mentoring_base_cte(user: UserAccess, term: str | None) -> tuple[str, list]:
    existing = database.get_table_columns(GROUP_MENTORING_OBSERVATIONS)

    def c(name: str) -> str:
        return _col(existing, "g", name)

    where, params = build_where(
        ("g.mentor_id IS NOT NULL", []),
        _gm_term_filter_clause(term),
        access_clause_fuzzy_cu(user, region_col="g.region", cu_col="mcl.cu", param_prefix="gm"),
    )
    sql = rf"""
    group_mentoring_base AS (
      SELECT
        g.key AS observation_id,
        g.region,
        mcl.cu AS cu,
        CASE g.term WHEN '1' THEN 'term1' WHEN '2' THEN 'term2' WHEN '3' THEN 'term3' ELSE NULL END AS term,
        g.session_type,
        SAFE_CAST(g.date AS DATE) AS observation_date,
        CAST(g.mentor_id AS STRING) AS mentor_id,
        g.name AS observer_name,
        CASE
          WHEN g.term = '1' THEN SAFE_CAST({c('qn7')} AS INT64)
          WHEN g.session_type = 'GM3' THEN SAFE_CAST({c('t2_q7_gm3')} AS INT64)
          ELSE SAFE_CAST({c('t2_q7_gm2')} AS INT64)
        END AS overall_score,
        CASE
          WHEN g.term = '1' THEN SAFE_CAST({c('qn3')} AS INT64)
          WHEN g.session_type = 'GM3' THEN SAFE_CAST({c('t2_q4_gm3')} AS INT64)
          ELSE SAFE_CAST({c('t2_q4_gm2')} AS INT64)
        END AS guidance_score,
        CASE
          WHEN g.term = '1' THEN SAFE_CAST({c('qn5')} AS INT64)
          WHEN g.session_type = 'GM3' THEN SAFE_CAST({c('t2_q5_gm3')} AS INT64)
          ELSE SAFE_CAST({c('t2_q5_gm2')} AS INT64)
        END AS action_plan_score,
        CASE
          WHEN g.term = '2' AND g.session_type = 'GM3' THEN SAFE_CAST({c('t2_q8_gm3')} AS INT64)
          WHEN g.term = '2' THEN SAFE_CAST({c('t2_q8_gm2')} AS INT64)
          ELSE NULL
        END AS engagement_score,
        CASE
          WHEN g.term = '2' AND g.session_type = 'GM3' THEN CAST({c('t2_q6_gm3')} AS STRING)
          WHEN g.term = '2' THEN CAST({c('t2_q6_gm2')} AS STRING)
          ELSE NULL
        END AS passbook_referenced,
        CASE
          WHEN g.term = '2' AND g.session_type = 'GM3' THEN CAST({c('t2_q1_gm3')} AS STRING)
          WHEN g.term = '2' THEN CAST({c('t2_q1_gm2')} AS STRING)
          ELSE NULL
        END AS session_opened_with_milestone,
        SAFE_CAST({c('q1')} AS INT64) AS duration_mins,
        SAFE_CAST({c('female')} AS INT64) AS female,
        SAFE_CAST({c('male')} AS INT64) AS male,
        SAFE_CAST({c('total_scholars')} AS INT64) AS total_scholars,
        IF(g.term = '1', {c('qn4')}, NULL) AS comment
      FROM {GROUP_MENTORING_OBSERVATIONS} g
      LEFT JOIN mentor_cu_lookup mcl ON CAST(g.mentor_id AS STRING) = mcl.mentor_id
      {where}
    )
    """
    return sql, params


@router.get("/group-mentoring/summary-by-cu")
def group_mentoring_summary_by_cu(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Region/CU Group Mentoring rows — roster as base, so every CU appears."""
    roster_sql, roster_params = _mentor_roster_cte(user)
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _group_mentoring_base_cte(user, term)
    sql = f"""
    WITH
    {roster_sql},
    {lookup_sql},
    {base_sql},
    cu_agg AS (
      SELECT
        region, cu,
        COUNT(DISTINCT observation_id) AS total_observations,
        COUNT(DISTINCT mentor_id) AS mentors_observed,
        ROUND(AVG({_GM_QUALITY_AVG_EXPR}), 2) AS quality_index,
        ROUND(AVG(overall_score), 2) AS avg_overall_performance,
        ROUND(AVG(guidance_score), 2) AS avg_guidance_quality,
        ROUND(AVG(action_plan_score), 2) AS avg_action_plan,
        ROUND(AVG(engagement_score), 2) AS avg_scholar_engagement,
        ROUND(SAFE_DIVIDE(COUNTIF(passbook_referenced = 'yes'), COUNTIF(passbook_referenced IS NOT NULL)) * 100, 1) AS pct_passbook_referenced,
        ROUND(SAFE_DIVIDE(COUNTIF(session_opened_with_milestone = 'yes'), COUNTIF(session_opened_with_milestone IS NOT NULL)) * 100, 1) AS pct_opened_with_milestone,
        ROUND(AVG(duration_mins), 1) AS avg_duration_mins,
        SUM(total_scholars) AS total_scholar_attendance
      FROM group_mentoring_base
      GROUP BY region, cu
    )
    SELECT
      mr.region,
      mr.cu_normalized AS cu,
      mr.total_mentors_assigned,
      COALESCE(c.mentors_observed, 0) AS mentors_observed,
      COALESCE(c.total_observations, 0) AS total_observations,
      c.quality_index,
      c.avg_overall_performance,
      c.avg_guidance_quality,
      c.avg_action_plan,
      c.avg_scholar_engagement,
      c.pct_passbook_referenced,
      c.pct_opened_with_milestone,
      c.avg_duration_mins,
      COALESCE(c.total_scholar_attendance, 0) AS total_scholar_attendance,
      CASE
        WHEN c.total_observations IS NULL THEN 'no_observations'
        WHEN c.quality_index IS NULL THEN 'unrated'
        WHEN c.quality_index < 2.0 THEN 'needs_urgent_support'
        ELSE 'adequate_data'
      END AS data_quality_flag
    FROM mentor_roster mr
    LEFT JOIN cu_agg c ON mr.region = c.region AND mr.cu_normalized = c.cu
    ORDER BY mr.region, mr.cu_normalized
    """
    params = roster_params + base_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|gm-summary-by-cu|{term}")
    return {"status": "ok", "data": rows}


@router.get("/group-mentoring/mentors")
def group_mentoring_mentors(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-mentor rows for one CU — the region → CU → mentor ID drill-down."""
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _group_mentoring_base_cte(user, term)
    cu_filter, cu_params = cu_clause_fuzzy([cu], cu_col="cu", param_name="gm_drill_cu_norm")
    where = f"WHERE {cu_filter}" if cu_filter else ""
    sql = f"""
    WITH {lookup_sql}, {base_sql}
    SELECT
      mentor_id,
      region,
      cu,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG(overall_score), 2) AS avg_overall_performance,
      ROUND(AVG(guidance_score), 2) AS avg_guidance_quality,
      ROUND(AVG(action_plan_score), 2) AS avg_action_plan,
      ROUND(AVG({_GM_QUALITY_AVG_EXPR}), 2) AS quality_index
    FROM group_mentoring_base
    {where}
    GROUP BY mentor_id, region, cu
    ORDER BY quality_index DESC
    """
    params = base_params + cu_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|gm-mentors|{cu.lower()}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/group-mentoring/mentor-observations")
def group_mentoring_mentor_observations(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    mentor_id: str = Query(..., min_length=1),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Every individual Group Mentoring observation for one mentor."""
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _group_mentoring_base_cte(user, term)
    where, where_params = build_where(
        cu_clause_fuzzy([cu], cu_col="o.cu", param_name="gm_detail_cu_norm"),
        ("o.mentor_id = @gm_detail_mentor_id", [bigquery.ScalarQueryParameter("gm_detail_mentor_id", "STRING", mentor_id)]),
    )
    sql = f"""
    WITH
    {lookup_sql},
    {base_sql},
    mentor_name_lookup AS (
      SELECT mentor_id, mentor_name FROM mentor_cu_lookup WHERE mentor_id = @gm_detail_mentor_id
    )
    SELECT
      o.observer_name,
      o.region,
      o.cu,
      o.term,
      o.session_type,
      o.observation_date,
      o.overall_score,
      o.guidance_score,
      o.action_plan_score,
      o.engagement_score,
      o.passbook_referenced,
      o.session_opened_with_milestone,
      ROUND({_GM_QUALITY_AVG_EXPR_O}, 2) AS observation_quality_index,
      o.duration_mins,
      o.female,
      o.male,
      o.total_scholars,
      o.comment,
      mn.mentor_name
    FROM group_mentoring_base o
    LEFT JOIN mentor_name_lookup mn ON o.mentor_id = mn.mentor_id
    {where}
    ORDER BY o.observation_date
    """
    params = base_params + where_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|gm-mentor-obs|{cu.lower()}|{mentor_id}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/group-mentoring/comments")
def group_mentoring_comments(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Group Mentoring free-text comments, rules-based theme tagged.

    Only Term 1 rows carry a comment field (QN4 — "share feedback on how the
    mentor identified the right problem/challenge"); Term 2's GM2/GM3 rubrics
    have no equivalent free-text question.
    """
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _group_mentoring_base_cte(user, term)
    sql = f"""
    WITH {lookup_sql}, {base_sql}
    SELECT region, cu, term, session_type, mentor_id, observation_date, comment
    FROM group_mentoring_base
    WHERE comment IS NOT NULL AND TRIM(comment) != ''
    ORDER BY region, cu, term
    """
    rows = database.run_query(sql, base_params, scope_key=f"{user.scope_key}|gm-comments|{term}")

    tagged = []
    for row in rows:
        themes = sorted({(m.key, m.label, m.sentiment) for m in tag_comment(row.get("comment") or "")})
        tagged.append({**row, "themes": [{"key": k, "label": lbl, "sentiment": sent} for k, lbl, sent in themes]})

    return {
        "status": "ok",
        "data": tagged,
        "theme_summary": summarize(rows, comment_field="comment"),
    }


# ── Skills Day observation (3rd source — silver_exp.exp_2026_skills_day_observation_form) ──
# Rated 1-3 (3 = best) via the form's own bespoke per-question option labels;
# see docs/DECISION.md ADR-008 follow-up for the choice-list decode.

_SD_TERM_CASE_EXPR = "CASE\n" + "\n".join(
    f"      WHEN s.observation_date BETWEEN DATE('{start}') AND DATE('{end}') THEN '{term}'"
    for term, (start, end) in _TERM_DATE_RANGES.items()
) + "\n      ELSE NULL\n    END"

_SD_QUALITY_AVG_EXPR = "(objective_score + participation_score + tin_quality_score + overall_score) / 4.0"
_SD_QUALITY_AVG_EXPR_O = _SD_QUALITY_AVG_EXPR.replace("objective_score", "o.objective_score").replace(
    "participation_score", "o.participation_score"
).replace("tin_quality_score", "o.tin_quality_score").replace("overall_score", "o.overall_score")


def _skills_day_base_cte(user: UserAccess, term: str | None) -> tuple[str, list]:
    existing = database.get_table_columns(SKILLS_DAY_OBSERVATIONS)

    def c(name: str) -> str:
        return _col(existing, "s", name)

    where, params = build_where(
        ("s.mentor_id IS NOT NULL", []),
        _term_filter_clause(term, case_expr=_SD_TERM_CASE_EXPR, param_name="sd_term_val"),
        access_clause_fuzzy_cu(user, region_col="s.region", cu_col="mcl.cu", param_prefix="sd"),
    )
    sql = rf"""
    skills_day_base AS (
      SELECT
        s.key AS observation_id,
        s.region,
        mcl.cu AS cu,
        {_SD_TERM_CASE_EXPR} AS term,
        s.observation_date,
        CAST(s.mentor_id AS STRING) AS mentor_id,
        s.observer_name,
        SAFE_CAST({c('sd_q3_objective')} AS INT64) AS objective_score,
        SAFE_CAST({c('sd_q4_participation')} AS INT64) AS participation_score,
        SAFE_CAST({c('sd_g1_tin_quality')} AS INT64) AS tin_quality_score,
        SAFE_CAST({c('sd_g2_mentor_perf')} AS INT64) AS overall_score,
        CAST({c('sd_q1_led_by_mentor')} AS STRING) AS led_by_mentor,
        SAFE_CAST({c('sd_q6_tins')} AS INT64) AS tins_bucket,
        SAFE_CAST({c('sd_q7_duration')} AS INT64) AS duration_mins,
        SAFE_CAST({c('female')} AS INT64) AS female,
        SAFE_CAST({c('male')} AS INT64) AS male,
        SAFE_CAST({c('total_scholars')} AS INT64) AS total_scholars,
        {c('sd_g1_quality_notes')} AS comment_tin_quality,
        {c('sd_g3_disruptions')} AS comment_disruptions,
        {c('sd_g4_other_observations')} AS comment_other,
        {c('sd_q5_comments')} AS comment_participation
      FROM {SKILLS_DAY_OBSERVATIONS} s
      LEFT JOIN mentor_cu_lookup mcl ON CAST(s.mentor_id AS STRING) = mcl.mentor_id
      {where}
    )
    """
    return sql, params


@router.get("/skills-day/summary-by-cu")
def skills_day_summary_by_cu(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Region/CU Skills Day rows — roster as base, so every CU appears."""
    roster_sql, roster_params = _mentor_roster_cte(user)
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _skills_day_base_cte(user, term)
    sql = f"""
    WITH
    {roster_sql},
    {lookup_sql},
    {base_sql},
    cu_agg AS (
      SELECT
        region, cu,
        COUNT(DISTINCT observation_id) AS total_observations,
        COUNT(DISTINCT mentor_id) AS mentors_observed,
        ROUND(AVG({_SD_QUALITY_AVG_EXPR}), 2) AS quality_index,
        ROUND(AVG(objective_score), 2) AS avg_objective_clarity,
        ROUND(AVG(participation_score), 2) AS avg_participation,
        ROUND(AVG(tin_quality_score), 2) AS avg_tin_quality,
        ROUND(AVG(overall_score), 2) AS avg_overall_performance,
        ROUND(SAFE_DIVIDE(COUNTIF(led_by_mentor = 'Yes'), COUNT(*)) * 100, 1) AS pct_led_by_mentor,
        ROUND(SAFE_DIVIDE(COUNTIF(tins_bucket = 3), COUNT(*)) * 100, 1) AS pct_high_tin_output,
        ROUND(AVG(duration_mins), 1) AS avg_duration_mins,
        SUM(total_scholars) AS total_scholar_attendance
      FROM skills_day_base
      GROUP BY region, cu
    )
    SELECT
      mr.region,
      mr.cu_normalized AS cu,
      mr.total_mentors_assigned,
      COALESCE(c.mentors_observed, 0) AS mentors_observed,
      COALESCE(c.total_observations, 0) AS total_observations,
      c.quality_index,
      c.avg_objective_clarity,
      c.avg_participation,
      c.avg_tin_quality,
      c.avg_overall_performance,
      c.pct_led_by_mentor,
      c.pct_high_tin_output,
      c.avg_duration_mins,
      COALESCE(c.total_scholar_attendance, 0) AS total_scholar_attendance,
      CASE
        WHEN c.total_observations IS NULL THEN 'no_observations'
        WHEN c.quality_index IS NULL THEN 'unrated'
        WHEN c.quality_index < 2.0 THEN 'needs_urgent_support'
        ELSE 'adequate_data'
      END AS data_quality_flag
    FROM mentor_roster mr
    LEFT JOIN cu_agg c ON mr.region = c.region AND mr.cu_normalized = c.cu
    ORDER BY mr.region, mr.cu_normalized
    """
    params = roster_params + base_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|sd-summary-by-cu|{term}")
    return {"status": "ok", "data": rows}


@router.get("/skills-day/mentors")
def skills_day_mentors(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Per-mentor rows for one CU — the region → CU → mentor ID drill-down."""
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _skills_day_base_cte(user, term)
    cu_filter, cu_params = cu_clause_fuzzy([cu], cu_col="cu", param_name="sd_drill_cu_norm")
    where = f"WHERE {cu_filter}" if cu_filter else ""
    sql = f"""
    WITH {lookup_sql}, {base_sql}
    SELECT
      mentor_id,
      region,
      cu,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG(objective_score), 2) AS avg_objective_clarity,
      ROUND(AVG(participation_score), 2) AS avg_participation,
      ROUND(AVG(tin_quality_score), 2) AS avg_tin_quality,
      ROUND(AVG(overall_score), 2) AS avg_overall_performance,
      ROUND(AVG({_SD_QUALITY_AVG_EXPR}), 2) AS quality_index
    FROM skills_day_base
    {where}
    GROUP BY mentor_id, region, cu
    ORDER BY quality_index DESC
    """
    params = base_params + cu_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|sd-mentors|{cu.lower()}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/skills-day/mentor-observations")
def skills_day_mentor_observations(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    mentor_id: str = Query(..., min_length=1),
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Every individual Skills Day observation for one mentor."""
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _skills_day_base_cte(user, term)
    where, where_params = build_where(
        cu_clause_fuzzy([cu], cu_col="o.cu", param_name="sd_detail_cu_norm"),
        ("o.mentor_id = @sd_detail_mentor_id", [bigquery.ScalarQueryParameter("sd_detail_mentor_id", "STRING", mentor_id)]),
    )
    sql = f"""
    WITH
    {lookup_sql},
    {base_sql},
    mentor_name_lookup AS (
      SELECT mentor_id, mentor_name FROM mentor_cu_lookup WHERE mentor_id = @sd_detail_mentor_id
    )
    SELECT
      o.observer_name,
      o.region,
      o.cu,
      o.term,
      o.observation_date,
      o.objective_score,
      o.participation_score,
      o.tin_quality_score,
      o.overall_score,
      ROUND({_SD_QUALITY_AVG_EXPR_O}, 2) AS observation_quality_index,
      o.led_by_mentor,
      o.tins_bucket,
      o.duration_mins,
      o.female,
      o.male,
      o.total_scholars,
      o.comment_tin_quality,
      o.comment_disruptions,
      o.comment_other,
      o.comment_participation,
      mn.mentor_name
    FROM skills_day_base o
    LEFT JOIN mentor_name_lookup mn ON o.mentor_id = mn.mentor_id
    {where}
    ORDER BY o.observation_date
    """
    params = base_params + where_params
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|sd-mentor-obs|{cu.lower()}|{mentor_id}|{term}")
    return {"status": "ok", "data": rows}


@router.get("/skills-day/comments")
def skills_day_comments(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """Skills Day free-text fields, rules-based theme tagged.

    Four distinct comment fields per observation (tin quality notes,
    disruptions, other observations, participation comments) — unnested into
    one tagged row per non-empty field, labelled by ``field``.
    """
    lookup_sql = _mentor_cu_lookup_cte()
    base_sql, base_params = _skills_day_base_cte(user, term)
    sql = f"""
    WITH {lookup_sql}, {base_sql}
    SELECT region, cu, term, mentor_id, observation_date, c.field, c.comment
    FROM skills_day_base,
    UNNEST([
      STRUCT('Tin quality notes' AS field, comment_tin_quality AS comment),
      STRUCT('Disruptions' AS field, comment_disruptions AS comment),
      STRUCT('Other observations' AS field, comment_other AS comment),
      STRUCT('Participation comments' AS field, comment_participation AS comment)
    ]) AS c
    WHERE c.comment IS NOT NULL AND TRIM(c.comment) != ''
    ORDER BY region, cu, term
    """
    rows = database.run_query(sql, base_params, scope_key=f"{user.scope_key}|sd-comments|{term}")

    tagged = []
    for row in rows:
        themes = sorted({(m.key, m.label, m.sentiment) for m in tag_comment(row.get("comment") or "", themes=SKILLS_DAY_THEMES)})
        tagged.append({**row, "themes": [{"key": k, "label": lbl, "sentiment": sent} for k, lbl, sent in themes]})

    return {
        "status": "ok",
        "data": tagged,
        "theme_summary": summarize(rows, comment_field="comment", themes=SKILLS_DAY_THEMES),
    }


# ── Highlights (draws from all 3 observation sources) ───────────────────────


@router.get("/highlights")
def highlights(
    term: str | None = Query(default=None, pattern=_TERM_PATTERN),
    user: UserAccess = Depends(current_user),
):
    """National top-line rollup across LEC, Skills Day, and Group Mentoring —
    the Highlights sub-tab. Per-region/CU detail still lives on each source's
    own ``summary-by-cu``; this is deliberately just the three headline
    numbers plus one theme summary merged across all three comment sources.
    """
    roster_sql, roster_params = _mentor_roster_cte(user)
    lookup_sql = _mentor_cu_lookup_cte()

    obs_sql, obs_params = _observation_base_cte(user, term)
    # National LEC rollup: mentors observed / assigned comes from the roster
    # (access-scoped), quality index + comments from observation_base.
    # NOTE: total_mentors_assigned comes from an independent scalar subquery,
    # not a JOIN against observation_base — a CU with N observations would
    # otherwise fan out its roster row N times, inflating SUM(total_mentors_assigned)
    # (caught live: term2 gave 2323 assigned mentors here vs. the true 358 every
    # other Mentor Quality endpoint reports for the same roster).
    lec_rollup_sql = f"""
    WITH {roster_sql}, {obs_sql}
    SELECT
      (SELECT SUM(total_mentors_assigned) FROM mentor_roster) AS total_mentors_assigned,
      COUNT(DISTINCT mentor_id) AS mentors_observed,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG({_SCORE_AVG_EXPR}), 2) AS quality_index
    FROM observation_base
    """
    lec_comments_sql = f"""
    WITH {obs_sql}
    SELECT observer_comments AS comment
    FROM observation_base
    WHERE observer_comments IS NOT NULL AND TRIM(observer_comments) != ''
    """

    sd_base_sql, sd_params = _skills_day_base_cte(user, term)
    sd_rollup_sql = f"""
    WITH {lookup_sql}, {sd_base_sql}
    SELECT
      COUNT(DISTINCT mentor_id) AS mentors_observed,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG({_SD_QUALITY_AVG_EXPR}), 2) AS quality_index,
      ROUND(SAFE_DIVIDE(COUNTIF(led_by_mentor = 'Yes'), COUNT(*)) * 100, 1) AS pct_led_by_mentor
    FROM skills_day_base
    """
    sd_comments_sql = f"""
    WITH {lookup_sql}, {sd_base_sql}
    SELECT c.comment
    FROM skills_day_base,
    UNNEST([
      STRUCT(comment_tin_quality AS comment), STRUCT(comment_disruptions AS comment),
      STRUCT(comment_other AS comment), STRUCT(comment_participation AS comment)
    ]) AS c
    WHERE c.comment IS NOT NULL AND TRIM(c.comment) != ''
    """

    gm_base_sql, gm_params = _group_mentoring_base_cte(user, term)
    gm_rollup_sql = f"""
    WITH {lookup_sql}, {gm_base_sql}
    SELECT
      COUNT(DISTINCT mentor_id) AS mentors_observed,
      COUNT(DISTINCT observation_id) AS total_observations,
      ROUND(AVG({_GM_QUALITY_AVG_EXPR}), 2) AS quality_index,
      ROUND(SAFE_DIVIDE(COUNTIF(passbook_referenced = 'yes'), COUNTIF(passbook_referenced IS NOT NULL)) * 100, 1) AS pct_passbook_referenced
    FROM group_mentoring_base
    """
    gm_comments_sql = f"""
    WITH {lookup_sql}, {gm_base_sql}
    SELECT comment
    FROM group_mentoring_base
    WHERE comment IS NOT NULL AND TRIM(comment) != ''
    """

    lec_rollup = database.run_query(
        lec_rollup_sql, roster_params + obs_params, scope_key=f"{user.scope_key}|hl-lec-rollup|{term}"
    )
    sd_rollup = database.run_query(sd_rollup_sql, sd_params, scope_key=f"{user.scope_key}|hl-sd-rollup|{term}")
    gm_rollup = database.run_query(gm_rollup_sql, gm_params, scope_key=f"{user.scope_key}|hl-gm-rollup|{term}")

    lec_comments = database.run_query(lec_comments_sql, obs_params, scope_key=f"{user.scope_key}|hl-lec-comments|{term}")
    sd_comments = database.run_query(sd_comments_sql, sd_params, scope_key=f"{user.scope_key}|hl-sd-comments|{term}")
    gm_comments = database.run_query(gm_comments_sql, gm_params, scope_key=f"{user.scope_key}|hl-gm-comments|{term}")

    # LEC and Group Mentoring comments are both mentor-facilitation observations
    # (LEC's THEMES fits both reasonably); Skills Day is hands-on product-making
    # and needs its own rule set (see ADR-008 follow-up) — summarized separately
    # then merged so a shared key like "participation" isn't double-listed.
    lec_gm_theme_summary = summarize(list(lec_comments) + list(gm_comments), comment_field="comment")
    sd_theme_summary = summarize(sd_comments, comment_field="comment", themes=SKILLS_DAY_THEMES)

    return {
        "status": "ok",
        "lec": lec_rollup[0] if lec_rollup else {},
        "skills_day": sd_rollup[0] if sd_rollup else {},
        "group_mentoring": gm_rollup[0] if gm_rollup else {},
        "combined_theme_summary": merge_summaries(lec_gm_theme_summary, sd_theme_summary),
    }
