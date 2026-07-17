"""Authentication: email login + Google SSO, one JWT scheme.

Two sign-in paths, both resolve the user's email to an access scope
(see ``core/access.py``) which is embedded in the JWT:

  * Email + shared password  → POST /api/auth/login
  * Google SSO (staff)       → GET  /api/auth/google/login → callback

JWT: HS256, configurable expiry, carried as ``Authorization: Bearer <jwt>``.
The OAuth callback redirects to ``FRONTEND_URL/#token=<jwt>``; the SPA reads the
fragment, stores it in sessionStorage, and strips the hash.

Accepted v1 limitations (see docs/DECISION.md): shared password path, JWT in
sessionStorage (not an httpOnly cookie), JWT_SECRET doubles as the OAuth session
key. Fine for an internal pilot.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.access import UserAccess, resolve_access
from app.core.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=True)

# ── OAuth registration (only wired if creds are present) ─────────────────────
oauth = OAuth()
if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


# ── JWT helpers ──────────────────────────────────────────────────────────────
def create_token(access: UserAccess) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": access.email,
        "access": access.to_dict(),
        "iat": now,
        "exp": now + timedelta(hours=settings.JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> UserAccess:
    """FastAPI dependency injected on every /api/* data route."""
    payload = _decode(creds.credentials)
    acc = payload.get("access", {})
    user = UserAccess(
        email=payload.get("sub", ""),
        has_national=bool(acc.get("hasNational")),
        regions=list(acc.get("regions", [])),
        cus=list(acc.get("cus", [])),
    )
    if not user.has_any_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has no dashboard access configured. Contact an admin.",
        )
    return user


# ── Email + password login ───────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginRequest):
    if body.password != settings.DASHBOARD_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access = resolve_access(body.email)
    if not access.has_any_access:
        raise HTTPException(
            status_code=403,
            detail="No dashboard access configured for this email.",
        )
    return {"status": "ok", "token": create_token(access), "user": access.to_dict()}


# ── Google SSO ───────────────────────────────────────────────────────────────
def _google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


@router.get("/google/login")
async def google_login(request: Request):
    if not _google_configured():
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    redirect_uri = request.url_for("google_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


def _sso_error(code: str) -> RedirectResponse:
    """Send the browser back into the SPA with an error fragment it can render,
    rather than returning a bare JSON error page mid-redirect."""
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/#error={code}")


@router.get("/google/callback", name="google_callback")
async def google_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:  # noqa: BLE001 — bad state, expired code, user-denied consent, etc.
        return _sso_error("oauth_failed")

    userinfo = token.get("userinfo") or {}
    email = (userinfo.get("email") or "").strip().lower()
    domain = email.split("@")[-1] if "@" in email else ""
    if domain != settings.OAUTH_ALLOWED_DOMAIN:
        return _sso_error("domain_not_allowed")

    access = resolve_access(email)
    if not access.has_any_access:  # parity with the password path
        return _sso_error("no_access")

    jwt_token = create_token(access)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/#token={jwt_token}")


@router.get("/me")
def me(user: UserAccess = Depends(current_user)):
    return {"status": "ok", "user": user.to_dict()}
