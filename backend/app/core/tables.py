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
