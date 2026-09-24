"""Call one of E!nsight's catalog endpoints in-process.

Same authenticated user, same access scope, zero network hop, zero re-auth:
the caller already has the resolved ``UserAccess`` from the incoming
``/api/ensight/ask`` request, so this resolves each endpoint's
``Query(...)``/``Depends(current_user)`` parameters by hand instead of going
through FastAPI's routing layer, then calls the plain Python function
directly. Paired with the catalog built in ``ensight_catalog.py``.
"""
from __future__ import annotations

import inspect
from typing import Any

from fastapi import params as fastapi_params
from fastapi.routing import APIRoute
from pydantic_core import PydanticUndefined

from app.auth import current_user
from app.core.access import UserAccess
from app.core.ensight_catalog import CATALOG_ROUTE_PREFIXES, iter_api_routes


class EndpointCallError(Exception):
    """A planned endpoint call couldn't be resolved or raised — a planning
    mistake for the pipeline to work around, never a 500 to the end user."""


def _find_route(app, path: str) -> APIRoute:
    if not path or not path.startswith(CATALOG_ROUTE_PREFIXES):
        raise EndpointCallError(f"Not a cataloged endpoint: {path!r}")
    for route in iter_api_routes(app.routes):
        if route.path == path and "GET" in route.methods:
            return route
    raise EndpointCallError(f"Unknown endpoint: GET {path}")


def call_endpoint(app, path: str, args: dict[str, Any], user: UserAccess) -> Any:
    """Call a cataloged GET endpoint's function directly.

    ``args`` are the plan's requested query params (strings, from the model).
    A missing required param or an unsupported dependency raises
    ``EndpointCallError`` rather than crashing the pipeline.
    """
    route = _find_route(app, path)
    sig = inspect.signature(route.endpoint)
    call_kwargs: dict[str, Any] = {}

    for name, p in sig.parameters.items():
        default = p.default
        if isinstance(default, fastapi_params.Depends):
            if default.dependency is current_user:
                call_kwargs[name] = user
                continue
            raise EndpointCallError(f"{path} has an unsupported dependency on {name!r}")
        if isinstance(default, fastapi_params.Query):
            value = args.get(name)
            if value is not None:
                call_kwargs[name] = value
            elif default.default is not PydanticUndefined:
                call_kwargs[name] = default.default
            else:
                raise EndpointCallError(f"{path} requires {name!r}")
            continue
        raise EndpointCallError(f"{path} has an unsupported parameter {name!r}")

    try:
        return route.endpoint(**call_kwargs)
    except Exception as exc:  # noqa: BLE001 — surfaced to the planner as a failed call
        raise EndpointCallError(f"{path} raised: {exc}") from exc
