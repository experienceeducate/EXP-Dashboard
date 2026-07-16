"""Test config: set required env BEFORE any app module is imported.

``core/config.py`` fails fast at import time, so we must populate the
environment before importing anything under ``app``.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("DASHBOARD_PASSWORD", "test-password")
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
    }
)

from app.main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def client_headers():
    return {"X-Exp-Client": "dashboard-v1"}


@pytest.fixture
def make_token():
    from app.auth import create_token
    from app.core.access import resolve_access

    def _make(email: str) -> str:
        return create_token(resolve_access(email))

    return _make
