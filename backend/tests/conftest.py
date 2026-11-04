"""Test config: set required env BEFORE any app module is imported.

``core/config.py`` fails fast at import time, so we must populate the
environment before importing anything under ``app``.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("ACCESS_EVENTS_IN_MEMORY", "true")
os.environ.setdefault("ENABLE_API_DOCS", "false")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_KEY", "/nonexistent/key.json")
os.environ.setdefault("BQ_PROJECT_ID", "educate-data-warehouse-test")
os.environ.setdefault("BQ_DATASET", "gold_exp")
os.environ.setdefault("BQ_TABLE", "exp_ai_dashboard_model")
os.environ.setdefault("CLIENT_HEADER_NAME", "X-Exp-Client")
os.environ.setdefault("CLIENT_HEADER_TOKEN", "dashboard-v1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Seed an access config so a known email has national access.
from app.core import access as access_mod  # noqa: E402

access_mod.ACCESS_CONFIG = access_mod._normalise(
    {
        "national": ["admin@experienceeducate.org"],
        "regional": {"Central": ["central@experienceeducate.org"]},
        "cu": {"mpigi": ["cu@experienceeducate.org"]},
        "admin": ["analytics-admin@experienceeducate.org", "access-manager@experienceeducate.org"],
        "access_managers": ["access-manager@experienceeducate.org"],
    }
)

from app.main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def client_headers():
    return {"X-Exp-Client": "dashboard-v1"}


@pytest.fixture(autouse=True)
def _fresh_access_store():
    """Every test gets an empty in-memory access event log, inline mail jobs
    and cleared rate limiters (app/core/access_runtime.py)."""
    from app.core import access_runtime

    access_runtime.reset_for_tests()
    yield
    access_runtime.reset_for_tests()


@pytest.fixture
def make_token():
    """Signs in as a staff member (a real server-side session, as the Google
    callback + /session/exchange would create) and returns the access token."""
    from app.auth import create_token
    from app.core import access_runtime
    from app.core.access import resolve_access

    def _make(email: str) -> str:
        grant = access_runtime.store.create_staff_session(email.strip().lower(), "google")
        return create_token(resolve_access(email), grant.sid)

    return _make


@pytest.fixture
def make_guest_token():
    """Approves + whitelists a guest with one scope and signs them in by magic link."""
    from app.auth import create_token, guest_access
    from app.core import access_runtime

    def _make(email: str, scope_type: str = "regional", scope_key: str = "Central") -> str:
        store = access_runtime.store
        store.invite(email, "access-manager@experienceeducate.org",
                     {"scope_type": scope_type, "scope_key": scope_key})
        token = store.issue_magic_link(email)
        grant = store.redeem_magic_link(token)
        return create_token(guest_access(email, store.guests[email].grant), grant.sid, "guest", "magic_link")

    return _make
