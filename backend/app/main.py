"""App factory ONLY: middleware wiring + include_router(). No route handlers here.

New routes go in ``app/routers/<domain>.py`` and are included below.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app import auth
from app.core import access
from app.core.config import settings
from app.routers import access_admin, admin, analytics, cu, elab, ensight, health, mentor_quality, overview, tasks

logger = logging.getLogger(__name__)


async def _warm_access_cache() -> None:
    """Best-effort: warms the BigQuery client + the access-mapping cache
    shortly after boot, in the background, so the first real request's
    current_user() call is more likely to find it already warm. Scheduled
    as a fire-and-forget task (never awaited by the lifespan handler below)
    — regardless of how long this takes or whether it fails, it must never
    delay "startup complete".

    Incident note: an earlier version of this ran synchronously, awaited,
    inside the lifespan handler. Starlette/uvicorn won't serve ANY request —
    including /health — until lifespan startup completes, and the
    underlying BigQuery call had no timeout at the time. With a single k8s
    replica and default-timeout (1s) liveness probes, one slow call was
    enough to fail every liveness check before startup ever finished,
    causing kubelet to kill and restart the pod — which reran the same slow
    call, in a loop. That's what actually produced a ~60s "the page just
    hangs" symptom in production. get_live_config()'s underlying query now
    also carries an explicit timeout (see core/access.py,
    core/database.py's run_query) as a second, independent bound — but
    lifespan startup must never again be the thing that awaits it.
    """
    try:
        # get_live_config() is a blocking sync call (the BigQuery client has
        # no async API) — run it in a thread so it can never block the event
        # loop (and therefore every concurrent request, including /health)
        # for however long it takes, timeout or not.
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, access.get_live_config)
    except Exception:  # noqa: BLE001 — best-effort; the request path already degrades gracefully on its own.
        logger.warning("Background cache warm-up failed; will retry lazily on first request", exc_info=True)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    asyncio.create_task(_warm_access_cache())
    yield

# Paths that bypass the custom client-header guard. Browsers don't attach custom
# headers to cross-site OAuth redirects, and tooling needs the docs/health.
_HEADER_EXEMPT_PATHS = {
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/auth/google/login",
    "/api/auth/google/callback",
}


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.PRODUCT_NAME} Dashboard API",
        version="1.0.0",
        description="Read-only dashboard API over BigQuery (gold_exp.exp_ai_dashboard_model).",
        lifespan=_lifespan,
    )

    # CORS — locked to the app hostname + localhost dev origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", settings.CLIENT_HEADER_NAME],
    )

    # OAuth state storage. NOTE: JWT_SECRET doubles as the session key (v1 limitation).
    app.add_middleware(SessionMiddleware, secret_key=settings.JWT_SECRET)

    # Custom client-header guard: every /api/* request must carry the token.
    @app.middleware("http")
    async def client_header_guard(request: Request, call_next):
        path = request.url.path
        if (
            request.method == "OPTIONS"
            or path in _HEADER_EXEMPT_PATHS
            or not path.startswith("/api/")
        ):
            return await call_next(request)
        if request.headers.get(settings.CLIENT_HEADER_NAME) != settings.CLIENT_HEADER_TOKEN:
            return JSONResponse(status_code=403, content={"detail": "Missing or invalid client header"})
        return await call_next(request)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(overview.router)
    app.include_router(cu.router)
    app.include_router(mentor_quality.router)
    app.include_router(ensight.router)
    app.include_router(analytics.router)
    app.include_router(admin.router)
    app.include_router(access_admin.router)
    app.include_router(tasks.router)
    app.include_router(elab.router)
    return app


app = create_app()
