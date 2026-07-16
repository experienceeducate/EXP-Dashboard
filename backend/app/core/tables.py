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
