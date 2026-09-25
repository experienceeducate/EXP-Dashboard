"""Correctness-critical metric computation for E!nsight's five headline
metrics (LEC delivery, retention, recruitment, passbook quality, mentor
coverage) — reuses ``app.core.metric_rollup.compute_rollup``, the same validated,
NULL-safe, cross-term-aware formulas the weekly digest already runs in
production, instead of asking an LLM to re-derive the arithmetic in freehand
SQL from prose table notes on every question.

This exists because that freehand-SQL path kept reintroducing bugs
``compute_rollup`` had already fixed once: bare ``col_a + col_b`` propagating
NULL through a sum, and reading retention/recruitment's term1-only fields off
whichever term the question happened to ask about (compute_rollup's own
docstring records the exact live incident — a 30,000%+ retention rate from
dividing real term2 attendance by a near-zero term2 "activation base"). Doing
the arithmetic once, in tested Python, closes that whole bug class for these
five metrics; a generated SQL query remains the fallback for anything outside
them (see ``ensight_pipeline._sql_system``).
"""
from __future__ import annotations

from app.core import database
from app.core.access import UserAccess
from app.core.sql import access_clause, build_where, level_clause
from app.core.tables import DASHBOARD_MODEL
from app.core.metric_rollup import compute_rollup

# Every raw column compute_rollup (and the LEC-range helpers it calls) reads.
_RAW_COLUMNS = (
    ("cu", "region", "term", "total_target_schools", "total_scholars_recruited", "lec2_scholars")
    + tuple(f"schools_with_lec{n}" for n in range(1, 21))
    + tuple(f"lec{n}_scholars" for n in range(1, 21))
    + ("total_active_mentors", "total_observed_mentors")
    + tuple(f"m{n}_quality_rated" for n in (1, 2, 3, 4))
    + tuple(f"m{n}_total_rated" for n in (1, 2, 3, 4))
)

VALID_DIMENSIONS = {"cu", "region", "national"}


def fetch_cu_rows(user: UserAccess) -> list[dict]:
    """Every CU-level row (all terms), scoped to the caller's access — the
    same row-level scoping every other data query in this app applies."""
    where, params = build_where(level_clause("cu"), access_clause(user))
    cols = ", ".join(_RAW_COLUMNS)
    sql = f"SELECT {cols} FROM {DASHBOARD_MODEL} {where}"
    return database.run_query(sql, params, scope_key=user.scope_key)


def _normalize(name: str) -> str:
    return " ".join((name or "").upper().split())


def compute(
    user: UserAccess,
    dimension: str,
    terms: list[str],
    filter_names: list[str] | None = None,
) -> list[dict]:
    """One row per (group, term) with all five headline metrics, each
    computed by ``compute_rollup``'s already-validated formulas.

    ``dimension`` is "cu", "region", or "national". ``terms`` are the terms to
    include as separate rows (usually one; more when the question is about
    change over time). ``filter_names`` restricts to specific CU/region names
    (case/whitespace-insensitive) — ignored for "national", which is always
    the whole programme.
    """
    if dimension not in VALID_DIMENSIONS:
        raise ValueError(f"Unknown dimension: {dimension!r}")

    rows = fetch_cu_rows(user)
    filter_set = {_normalize(n) for n in (filter_names or []) if n}

    # Group every row into group_key -> term -> [rows]. term1 rows are kept
    # under every group so compute_rollup always gets that group's OWN term1
    # base, never another group's or another term's (see its docstring for
    # why that mix-up is exactly the bug this module exists to prevent).
    grouped: dict[str, dict[str, list[dict]]] = {}
    for r in rows:
        if dimension == "national":
            key = "National"
        elif dimension == "region":
            key = (r.get("region") or "Unknown").strip()
        else:
            key = _normalize(r.get("cu"))
        if dimension != "national" and filter_set and _normalize(key) not in filter_set:
            continue
        grouped.setdefault(key, {}).setdefault(r.get("term"), []).append(r)

    out: list[dict] = []
    for key in sorted(grouped):
        term_rows = grouped[key]
        t1_rows = term_rows.get("term1", [])
        for term in terms:
            group_rows = term_rows.get(term, [])
            if not group_rows:
                continue  # no row for this group/term — "not reported", not zero
            out.append({"group": key, "term": term, **compute_rollup(group_rows, t1_rows, term)})
    return out
