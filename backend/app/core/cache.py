"""In-memory TTL cache for query results.

Single-process / single-replica invariant: this cache lives in the process
heap. Do NOT run multiple uvicorn workers or scale the Deployment past one
replica without first moving this to a shared store (Redis) — cache hits would
otherwise land on a process that never saw the entry. See docs/CONTEXT.md.
"""
from __future__ import annotations

from cachetools import TTLCache

from app.core.config import settings

# Keyed by (role_scope_key, sql, params_repr).
query_cache: TTLCache = TTLCache(
    maxsize=settings.CACHE_MAXSIZE,
    ttl=settings.CACHE_TTL_SECONDS,
)


def make_key(scope_key: str, sql: str, params: object) -> tuple:
    """Build a stable cache key from the caller's scope, SQL, and params."""
    return (scope_key, sql, repr(params))
