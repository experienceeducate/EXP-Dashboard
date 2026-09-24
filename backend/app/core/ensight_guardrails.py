"""Guardrails on E!nsight's generated SQL — security-critical.

Every check fails closed. Order matches docs/ENSIGHT.md's guardrails table:
each is cheaper than the next, so a free syntactic rejection never pays for a
dry run, and a dry run never pays for a real query.

Underneath all of it the service account has NO write access anywhere in the
warehouse (verified: every ``create_table`` attempt 403s — see
DATA_ENG_BIGQUERY_TABLES_REQUEST.md). These checks are not the security
boundary; they catch an honest mistake early and keep the audit log readable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from google.cloud import bigquery

from app.core import database
from app.core.config import settings
from app.core.tables import (
    DASHBOARD_MODEL,
    GROUP_MENTORING_OBSERVATIONS,
    MENTOR_OBSERVATIONS,
    MENTOR_ROSTER,
    SKILLS_DAY_OBSERVATIONS,
)

# The five sources originally surveyed for E!nsight (docs/ENSIGHT.md's Phase 0)
# — their table cards are hand-written and trustworthy, so the SQL prompt
# still steers the model toward these first. Bare (no backticks) so they
# compare directly against a parsed `a.b.c` reference.
ALLOWED_TABLES = {
    ref.strip("`")
    for ref in (
        DASHBOARD_MODEL,
        MENTOR_OBSERVATIONS,
        MENTOR_ROSTER,
        SKILLS_DAY_OBSERVATIONS,
        GROUP_MENTORING_OBSERVATIONS,
    )
}

# The three datasets E!nsight may read from — everything in gold_exp,
# silver_exp and bronze_exp, not just the five hand-surveyed tables above.
# This is deliberately dataset-scoped rather than an exact table list: the
# warehouse has ~140 tables across these three datasets (many gaining/dropping
# columns as live exports land — see TABLE_CARDS), and a per-table allowlist
# would either go stale or block legitimate tables no one had gotten around to
# adding yet. The PII output-schema gate below is what actually protects a
# question against an unsurveyed table's PII, not this list — this list only
# keeps the query inside the EXP programme's own project data.
ALLOWED_DATASETS = {"gold_exp", "silver_exp", "bronze_exp"}


def _table_in_allowed_dataset(table_ref: str) -> bool:
    """True if a bare `project.dataset.table` reference is both inside the
    warehouse project (never some other project the service account can
    reach) and inside one of the three allowed datasets."""
    parts = table_ref.split(".")
    if len(parts) != 3:
        return False
    project, dataset, _ = parts
    return project == settings.BQ_PROJECT_ID and dataset in ALLOWED_DATASETS


# Person-role prefixes seen across the warehouse's ~140 tables (mined from a
# live INFORMATION_SCHEMA survey of gold_exp/silver_exp/bronze_exp — naming is
# wildly inconsistent: "mentor_name", "YlName", "MM_name", "Recruiter_name",
# "foa_name", "staff_name", "scholar_name", "patron_first_name" all exist).
# Used to block `<role>_id` as a raw output column the same way `<role>_name`
# already is below — an opaque ID for a specific mentor/scholar/etc. is still
# a personal identifier, unlike `cu_id`/`school_id`/`term_id`/`lesson_id`.
_PERSON_ROLES = (
    "mentor", "scholar", "student", "guardian", "patron", "recruiter",
    "admin", "staff", "observer", "facilitator", "reporter", "teacher",
    "parent", "youth", "respondent", "informant", "foa", "mm", "headteacher",
    "recipient", "beneficiary", "participant", "user",
)

# Entity-name fields verified safe (they name a CU/school/term/etc., not a
# person) — exempted from the generic "contains 'name'" block below. Anything
# NOT on this short, deliberately reviewed list is blocked by default: with
# ~140 unsurveyed tables using "name" for everything from a lesson's title to
# a scholar's guardian, failing closed on an unrecognised "*name*" column is
# far safer than trying to enumerate every safe case. If a query's own source
# column is a safe variant not listed here (`school_name_other`,
# `correct_school_name`, a lookup table's bare `name`), alias it to one of
# these on the way out — the gate only inspects the final output alias.
_SAFE_NAME_COLUMNS = {
    "school_name", "cu_name", "region_name", "lesson_name", "term_name",
    "instance_name", "activity_type_name", "session_name",
}

_PII_PATTERNS = (
    re.compile(r"phone|contact|mobile|\btel\b", re.IGNORECASE),
    re.compile(r"email", re.IGNORECASE),
    re.compile(r"national_id|passport|\bnin\b|\bssn\b|id[_ ]?number", re.IGNORECASE),
    re.compile(r"\bdob\b|date_of_birth|birth_date", re.IGNORECASE),
    re.compile(r"latitude|longitude|\bgps\b|coordinat", re.IGNORECASE),
    re.compile(r"^(first|last|middle|given)_?name$|surname|othername|other_name|full_name|username", re.IGNORECASE),
    re.compile(r"(" + "|".join(_PERSON_ROLES) + r")_?id$", re.IGNORECASE),
)


def _is_pii_output_column(name: str) -> bool:
    lname = name.lower().strip()
    if "name" in lname and lname not in _SAFE_NAME_COLUMNS:
        return True
    return any(p.search(lname) for p in _PII_PATTERNS)


# Generous for aggregate queries over these tables; a runaway scan across the
# widest source (the gold model) still fails well under this.
MAX_BYTES_BILLED = 200 * 1024 * 1024

_DML_DDL = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|EXECUTE)\b",
    re.IGNORECASE,
)
_TABLE_REF = re.compile(r"`([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)`")
_SELECT_STAR = re.compile(r"select\s+(\w+\.)?\*", re.IGNORECASE)


@dataclass
class GuardrailResult:
    ok: bool
    reason: str = ""
    dry_run_bytes: int = 0
    output_columns: list[str] | None = None


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return sql


def check_static(sql: str) -> GuardrailResult:
    """Comments/multi-statement/SELECT-or-WITH/DML-DDL/SELECT-*/table-allowlist.

    All free — no BigQuery call — so a malformed or out-of-bounds query never
    reaches the dry run.
    """
    stripped = _strip_comments(sql or "").strip()
    if not stripped:
        return GuardrailResult(False, "Empty query after stripping comments.")

    body = stripped[:-1] if stripped.endswith(";") else stripped
    if ";" in body:
        return GuardrailResult(False, "Multiple statements are not allowed.")

    first_word = re.match(r"\s*(\w+)", body)
    if not first_word or first_word.group(1).upper() not in ("SELECT", "WITH"):
        return GuardrailResult(False, "Query must start with SELECT or WITH.")

    if _DML_DDL.search(body):
        return GuardrailResult(False, "Query contains a write/DDL keyword.")

    if _SELECT_STAR.search(body):
        return GuardrailResult(False, "SELECT * is not allowed — name output columns explicitly.")

    tables = set(_TABLE_REF.findall(body))
    if not tables:
        return GuardrailResult(False, "No fully-qualified `project.dataset.table` reference found.")
    unresolvable = {t for t in tables if not _table_in_allowed_dataset(t)}
    if unresolvable:
        return GuardrailResult(False, f"Reads outside the allowed datasets: {', '.join(sorted(unresolvable))}")

    return GuardrailResult(True)


def dry_run(sql: str) -> GuardrailResult:
    """Free syntax/schema check + byte estimate + the PII gate, via BigQuery's
    dry-run mode — no bytes billed, catches an unknown column before a cent is
    spent, and its resulting output schema is what the PII gate inspects."""
    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
    try:
        job = database.get_client().query(sql, job_config=job_config)
    except Exception as exc:  # noqa: BLE001 — fed back verbatim for the one repair attempt
        return GuardrailResult(False, f"Dry run failed: {exc}")

    columns = [f.name for f in job.schema] if job.schema else []
    scanned = job.total_bytes_processed or 0

    if scanned > MAX_BYTES_BILLED:
        return GuardrailResult(
            False,
            f"Estimated scan ({scanned:,} bytes) exceeds the {MAX_BYTES_BILLED:,}-byte budget.",
            dry_run_bytes=scanned,
            output_columns=columns,
        )

    pii_hits = sorted(c for c in columns if _is_pii_output_column(c))
    if pii_hits:
        return GuardrailResult(
            False,
            f"Output would include raw personal-data column(s): {', '.join(pii_hits)}. "
            "Aggregate or COUNT(DISTINCT ...) them instead of selecting the raw value.",
            dry_run_bytes=scanned,
            output_columns=columns,
        )

    return GuardrailResult(True, dry_run_bytes=scanned, output_columns=columns)


def run_guarded(sql: str) -> tuple[GuardrailResult, list[dict]]:
    """Static checks, then dry run, then — only if both pass — the real,
    byte-capped query. Returns ``(result, rows)``; ``rows`` is ``[]`` unless
    ``result.ok``."""
    static = check_static(sql)
    if not static.ok:
        return static, []

    dr = dry_run(sql)
    if not dr.ok:
        return dr, []

    job_config = bigquery.QueryJobConfig(maximum_bytes_billed=MAX_BYTES_BILLED)
    try:
        rows = [dict(r) for r in database.get_client().query(sql, job_config=job_config).result()]
    except Exception as exc:  # noqa: BLE001 — the estimate was wrong or the real job hit the byte cap
        return GuardrailResult(False, f"Query execution failed: {exc}"), []
    return GuardrailResult(True, dry_run_bytes=dr.dry_run_bytes, output_columns=dr.output_columns), rows
