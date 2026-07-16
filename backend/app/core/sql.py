"""SQL-building helpers — security-critical.

Rules (enforced by convention + review):
  * NEVER f-string user input into SQL. Every user-supplied value becomes a
    BigQuery ``ScalarQueryParameter`` / ``ArrayQueryParameter``.
  * Helpers return ``(clause, params)`` tuples so callers compose a WHERE from
    typed fragments.
  * Universal filters (level, valid term) are baked in once here and applied
    consistently by callers.
"""
from __future__ import annotations

from typing import Iterable

from google.cloud import bigquery

# Terms the model recognises. Anything else is rejected before it hits SQL.
VALID_TERMS = {"term1", "term2", "term3"}


def level_clause(level: str) -> tuple[str, list]:
    """Restrict to CU-level or school-level rows."""
    return "level = @level", [bigquery.ScalarQueryParameter("level", "STRING", level)]


def term_clause(term: str | None) -> tuple[str, list]:
    """Filter by term. ``None`` / 'all' means no term filter.

    Note: term is a tri-state-ish string column. We test ``= @term`` for a
    concrete term and skip the clause entirely for 'all'.
    """
    if not term or term == "all":
        return "", []
    if term not in VALID_TERMS:
        # Caller should have validated; be defensive rather than build bad SQL.
        raise ValueError(f"Unknown term: {term!r}")
    return "term = @term", [bigquery.ScalarQueryParameter("term", "STRING", term)]


def region_clause(regions: Iterable[str]) -> tuple[str, list]:
    """Restrict rows to a set of regions (used for regional access scoping)."""
    regions = [r for r in regions if r]
    if not regions:
        return "", []
    return (
        "region IN UNNEST(@regions)",
        [bigquery.ArrayQueryParameter("regions", "STRING", regions)],
    )


def cu_clause(cus: Iterable[str]) -> tuple[str, list]:
    """Restrict rows to a set of CUs (used for CU access scoping + drilldown)."""
    cus = [c for c in cus if c]
    if not cus:
        return "", []
    return (
        "LOWER(cu) IN UNNEST(@cus)",
        [bigquery.ArrayQueryParameter("cus", "STRING", [c.lower() for c in cus])],
    )


def access_clause(user) -> tuple[str, list]:
    """Row-level access filter for a resolved ``UserAccess``.

    * National users → no restriction ('' clause).
    * Otherwise → OR across their permitted regions and CUs, so a user scoped to
      a region AND a CU sees the union of both.
    """
    if getattr(user, "has_national", False):
        return "", []
    parts: list[str] = []
    params: list = []
    if user.regions:
        parts.append("region IN UNNEST(@acc_regions)")
        params.append(bigquery.ArrayQueryParameter("acc_regions", "STRING", list(user.regions)))
    if user.cus:
        parts.append("LOWER(cu) IN UNNEST(@acc_cus)")
        params.append(
            bigquery.ArrayQueryParameter("acc_cus", "STRING", [c.lower() for c in user.cus])
        )
    if not parts:
        # No access at all → match no rows (defensive; current_user already 403s).
        return "1 = 0", []
    return "(" + " OR ".join(parts) + ")", params


def build_where(*fragments: tuple[str, list]) -> tuple[str, list]:
    """Combine ``(clause, params)`` fragments into a single WHERE.

    Empty clauses are dropped. Returns ('', []) if nothing to filter (caller
    should then omit the WHERE keyword).
    """
    clauses: list[str] = []
    params: list = []
    for clause, frag_params in fragments:
        if clause:
            clauses.append(clause)
            params.extend(frag_params)
    if not clauses:
        return "", []
    return "WHERE " + " AND ".join(f"({c})" for c in clauses), params
