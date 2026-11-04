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
import typing
from typing import Annotated, Any

from fastapi import params as fastapi_params
from fastapi.routing import APIRoute
from pydantic import TypeAdapter, ValidationError
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


def _validate_query_value(path: str, name: str, annotation: Any, query: fastapi_params.Query, value: Any) -> Any:
    """Apply the param's declared type and Query constraints (pattern,
    min/max_length, ge/le, ...) the way FastAPI would for a real request.

    Calling the function directly skips FastAPI's request validation, and
    these values come from the model (and, on export, from the client) — so
    a ``term`` must still match its pattern, a ``days`` its bounds."""
    try:
        adapter = TypeAdapter(Annotated[annotation, *query.metadata])
        return adapter.validate_python(value)
    except ValidationError as exc:
        raise EndpointCallError(f"{path}: invalid value for {name!r}") from exc
    except Exception as exc:  # noqa: BLE001 — an unvalidatable param fails closed
        raise EndpointCallError(f"{path}: cannot validate {name!r}") from exc


def call_endpoint(app, path: str, args: dict[str, Any], user: UserAccess) -> Any:
    """Call a cataloged GET endpoint's function directly.

    ``args`` are the plan's requested query params (strings, from the model).
    A missing required param or an unsupported dependency raises
    ``EndpointCallError`` rather than crashing the pipeline.
    """
    route = _find_route(app, path)
    if not isinstance(args, dict):
        raise EndpointCallError(f"{path}: params must be an object")
    sig = inspect.signature(route.endpoint)
    try:
        hints = typing.get_type_hints(route.endpoint, include_extras=True)
    except Exception as exc:  # noqa: BLE001 — can't validate, so don't call
        raise EndpointCallError(f"{path} has unresolvable parameter types") from exc
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
                call_kwargs[name] = _validate_query_value(path, name, hints.get(name, str), default, value)
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
