"""Every error response must carry CORS headers.

Starlette wraps the whole stack in ServerErrorMiddleware, outside every user
middleware, so a 500 generated there goes back without an
Access-Control-Allow-Origin header. The browser then discards the response and
fetch() rejects, leaving the UI with an opaque network failure and no status
code — that is how an upstream BigQuery schema break once surfaced as nothing
but "Failed to fetch". See docs/CONTEXT.md and main.py's middleware ordering
note.
"""
import pytest
from fastapi import APIRouter

from app.core import database

ORIGIN = "http://localhost:3000"


def test_cors_middleware_is_the_outermost_user_middleware():
    """The ordering this whole file depends on. add_middleware() inserts at
    the front and the first entry is outermost, so CORSMiddleware must be
    registered LAST to end up outside the error-catching layer."""
    from starlette.middleware.cors import CORSMiddleware

    from app.main import app

    assert app.user_middleware[0].cls is CORSMiddleware


def test_unhandled_exception_returns_500_with_cors_headers(client, client_headers, make_token, monkeypatch):
    """A router that lets an exception escape must still produce a response
    the browser will surface, rather than a CORS-less 500 it discards."""

    def boom(*a, **k):
        raise RuntimeError("BigQuery exploded")

    monkeypatch.setattr(database, "run_query", boom)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/overview/summary?term=term3",
        headers={**client_headers, "Authorization": f"Bearer {token}", "Origin": ORIGIN},
    )

    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == ORIGIN
    assert "detail" in r.json()


def test_unhandled_exception_detail_does_not_leak_internals(client, client_headers, make_token, monkeypatch):
    """An unexpected exception's message can carry table names, SQL or
    credentials paths — the client gets a generic string, the traceback goes
    to the server log."""

    def boom(*a, **k):
        raise RuntimeError("Unrecognized name: lesson_name at [36:58] in secret_dataset.tbl")

    monkeypatch.setattr(database, "run_query", boom)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/overview/summary?term=term3",
        headers={**client_headers, "Authorization": f"Bearer {token}", "Origin": ORIGIN},
    )

    assert r.status_code == 500
    body = r.text
    assert "lesson_name" not in body
    assert "secret_dataset" not in body


def test_client_header_guard_403_carries_cors_headers(client):
    """The guard builds its own JSONResponse. It used to sit outside
    CORSMiddleware, so its 403 reached the browser bare and showed up as a
    network error instead of a readable "invalid client header"."""
    r = client.get("/api/overview/summary", headers={"Origin": ORIGIN})

    assert r.status_code == 403
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_401_carries_cors_headers(client, client_headers):
    """The frontend branches on 401 to clear the stored token (lib/api.js), so
    this one has to reach it as a status rather than a rejected fetch."""
    r = client.get(
        "/api/overview/summary",
        headers={**client_headers, "Origin": ORIGIN},
    )

    assert r.status_code == 401
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_http_exception_detail_still_passes_through(client, client_headers, make_token, monkeypatch):
    """The catch-all must not swallow a deliberate HTTPException — routers use
    those to say something specific (e.g. elab.py's 504 on a slow query), and
    ExceptionMiddleware converts them before the catch-all ever sees them."""
    from fastapi import HTTPException

    from app.main import app

    router = APIRouter()

    @router.get("/api/_test/teapot")
    def teapot():
        raise HTTPException(status_code=418, detail="deliberate and specific")

    app.include_router(router)
    try:
        token = make_token("admin@experienceeducate.org")
        r = client.get(
            "/api/_test/teapot",
            headers={**client_headers, "Authorization": f"Bearer {token}", "Origin": ORIGIN},
        )
        assert r.status_code == 418
        assert r.json()["detail"] == "deliberate and specific"
        assert r.headers.get("access-control-allow-origin") == ORIGIN
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes
                                if getattr(rt, "path", None) != "/api/_test/teapot"]
