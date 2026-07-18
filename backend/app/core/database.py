"""BigQuery client and the single query seam.

``run_query`` is THE test seam. Routers must call it as
``database.run_query(...)`` via the module object — never
``from app.core.database import run_query`` — so the test suite's monkeypatch
reaches every caller. Keep this discipline.
"""
from __future__ import annotations

from typing import Any, Sequence

from google.cloud import bigquery
from google.oauth2 import service_account

from cachetools import TTLCache

from app.core.cache import make_key, query_cache
from app.core.config import settings

# Full scope (not .readonly): submitting a query job requires write-capable
# scope even though we only ever read.
_SCOPES = ["https://www.googleapis.com/auth/bigquery"]

_client: bigquery.Client | None = None

# Some silver_exp survey sources are mid-term forms whose exported schema
# grows/shrinks as submissions land (a column with zero populated rows so far
# can vanish from the table entirely — see docs/DECISION.md ADR-008
# follow-up). A short-TTL cache lets column-existence checks pick up a schema
# change without a full pod restart, without hitting the metadata API per request.
_schema_cache: TTLCache = TTLCache(maxsize=32, ttl=600)


def get_client() -> bigquery.Client:
    """Lazily build and memoise a single BigQuery client."""
    global _client
    if _client is None:
        credentials = service_account.Credentials.from_service_account_file(
            settings.GOOGLE_SERVICE_ACCOUNT_KEY,
            scopes=_SCOPES,
        )
        _client = bigquery.Client(
            project=settings.BQ_PROJECT_ID,
            credentials=credentials,
        )
    return _client


def run_query(
    sql: str,
    params: Sequence[bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter] | None = None,
    *,
    scope_key: str = "public",
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """Execute a parameterised query and return rows as dicts.

    Results are cached in a process-local TTLCache keyed by
    (scope_key, sql, params). ``scope_key`` MUST encode anything that changes
    which rows a caller may see (e.g. their access scope) so two users with
    different scopes never share a cache entry.
    """
    params = list(params or [])
    key = make_key(scope_key, sql, [(_param_repr(p)) for p in params])

    if use_cache and key in query_cache:
        return query_cache[key]

    job_config = bigquery.QueryJobConfig(query_parameters=params)
    rows = [dict(row) for row in get_client().query(sql, job_config=job_config).result()]

    if use_cache:
        query_cache[key] = rows
    return rows


def get_table_columns(table_ref: str) -> set[str]:
    """Column names currently present on ``table_ref`` (backtick-quoted or bare).

    See the ``_schema_cache`` note above for why this is needed and re-checked
    periodically rather than assumed stable for the process lifetime.
    """
    bare_ref = table_ref.strip("`")
    if bare_ref not in _schema_cache:
        table = get_client().get_table(bare_ref)
        _schema_cache[bare_ref] = {f.name for f in table.schema}
    return _schema_cache[bare_ref]


def _param_repr(p: Any) -> tuple:
    """Stable, hashable representation of a query parameter for cache keys."""
    name = getattr(p, "name", None)
    value = getattr(p, "value", None) or getattr(p, "values", None)
    type_ = getattr(p, "type_", None)
    return (name, type_, repr(value))
