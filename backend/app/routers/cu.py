"""CU drilldown — school-level rows for a single community unit.

Mirrors the legacy ``?view=cu&cu=NAME``. The requested CU is validated against
the caller's access scope: national users may drill into any CU; scoped users
only into CUs their access permits.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import current_user
from app.core import database
from app.core.access import UserAccess
from app.core.sql import build_where, cu_clause, level_clause, term_clause
from app.core.tables import DASHBOARD_MODEL, LEVEL_SCHOOL

router = APIRouter(prefix="/api/cu", tags=["cu"])


def _may_access_cu(user: UserAccess, cu: str) -> bool:
    if user.has_national:
        return True
    if cu.lower() in {c.lower() for c in user.cus}:
        return True
    # Regional users can drill into CUs in their regions — enforced by the query
    # (region filter) rather than a name check, so allow through here.
    return bool(user.regions)


@router.get("")
def cu_schools(
    cu: str = Query(..., min_length=1, description="Community unit name"),
    term: str | None = Query(default=None),
    user: UserAccess = Depends(current_user),
):
    if not _may_access_cu(user, cu):
        raise HTTPException(status_code=403, detail="Not permitted to view this CU")

    fragments = [level_clause(LEVEL_SCHOOL), cu_clause([cu]), term_clause(term)]
    # Regional users: additionally constrain to their regions so they can't pull
    # a CU outside their scope by name.
    if not user.has_national and user.regions and cu.lower() not in {c.lower() for c in user.cus}:
        from app.core.sql import region_clause

        fragments.append(region_clause(user.regions))

    where, params = build_where(*fragments)
    sql = f"SELECT * FROM {DASHBOARD_MODEL} {where}"
    rows = database.run_query(sql, params, scope_key=f"{user.scope_key}|cu:{cu.lower()}|{term}")
    return {"status": "ok", "data": rows}
