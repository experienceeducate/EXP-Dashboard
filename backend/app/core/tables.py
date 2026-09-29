"""All BigQuery table-reference constants live here.

Single source of truth for every table the dashboard reads. Routers and SQL
helpers import from this module — never hard-code a table name elsewhere.

Data layer note: the product is "EXP" everywhere user-facing, but the source of
truth is the curated gold model ``gold_exp.exp_ai_dashboard_model``. It is a wide
"one-big-table" with a ``level`` column distinguishing CU-level rows
(``level = 'cu'``) from school-level rows (``level = 'school'``).
"""
from __future__ import annotations

from app.core.config import settings

# The single dashboard source table.
DASHBOARD_MODEL = settings.table_ref

# Row-level granularity marker.
LEVEL_CU = "cu"
LEVEL_SCHOOL = "school"

# ── Mentor Quality (see docs/DECISION.md ADR-008) ───────────────────────────
# A second data source, deliberately separate from DASHBOARD_MODEL: mentor
# observation/roster data isn't (yet) folded into the gold_exp model.
MENTOR_OBSERVATIONS = f"`{settings.BQ_PROJECT_ID}.silver_exp.exp_2026_lec_observation_form`"
MENTOR_ROSTER = f"`{settings.BQ_PROJECT_ID}.bronze_exp.mentor_2026`"

# Third and fourth Mentor Quality sources — same roster, different observation
# forms (Skills Day, Group Mentoring). Neither carries a `cu` column directly;
# CU is resolved via a mentor_id join to MENTOR_ROSTER (see ADR-008 follow-up).
SKILLS_DAY_OBSERVATIONS = f"`{settings.BQ_PROJECT_ID}.silver_exp.exp_2026_skills_day_observation_form`"
GROUP_MENTORING_OBSERVATIONS = f"`{settings.BQ_PROJECT_ID}.silver_exp.exp_2026_group_mentoring__observation__form`"

# ── E-Lab (mentor digital-lesson activity) ──────────────────────────────────
# A third data source: one row per mentor x lesson attempt. No active/status
# column of its own — "active mentors" comes from DASHBOARD_MODEL's
# total_active_mentors (see routers/elab.py).
#
# This pointed at `silver_exp.exp_elab_mentor_activity_report` until that table
# was dropped and rebuilt on 2026-09-27 with an entirely different schema — it
# now carries mentor *activity report* columns (school visits, passbooks,
# recruitment) and none of the lesson-level ones this feature needs, so every
# E-Lab query failed with `400 Unrecognized name: lesson_name`. The
# lesson-level data lives here instead. Bronze rather than silver because
# there is currently no silver model over it; if data engineering builds one,
# move this back and drop the year suffix handling below.
#
# NOTE: year-suffixed. A new programme year needs this bumped (or generalised)
# — the 2024/2025 equivalents still exist alongside it.
ELAB_ACTIVITY = f"`{settings.BQ_PROJECT_ID}.bronze_exp.raw_exp_elab_mentor_learning_progress_2026`"
