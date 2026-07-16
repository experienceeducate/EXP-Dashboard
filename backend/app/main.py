"""App factory ONLY: middleware wiring + include_router(). No route handlers here.

New routes go in ``app/routers/<domain>.py`` and are included below.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app import auth
from app.core.config import settings
from app.routers import cu, health, overview

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
    return app


app = create_app()
