"""E!nsight router: gating and the request/response shape.

The pipeline itself (LLM calls, BigQuery dry runs) needs live credentials and
isn't exercised here — these tests monkeypatch ``ensight_pipeline.ask`` at the
module the router imported it into, mirroring the ``database.run_query``
monkeypatch seam pattern used elsewhere in this suite.
"""
import pytest

from app.core.config import settings
from app.core.ensight_llm import EnsightLLMError
from app.core.ensight_pipeline import AskResult, RateLimitError
from app.routers import ensight as ensight_router


@pytest.fixture(autouse=True)
def _openrouter_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key")


def test_availability_true_for_listed_national_user(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/ensight/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["available"] is True


def test_availability_false_for_national_only_user(client, client_headers, make_token):
    # Any other @experienceeducate.org address resolves to national_only —
    # full dashboard access, but explicitly excluded from E!nsight.
    token = make_token("someone-else@experienceeducate.org")
    r = client.get("/api/ensight/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_availability_false_for_regional_and_cu_users(client, client_headers, make_token):
    for email in ("central@experienceeducate.org", "cu@experienceeducate.org"):
        token = make_token(email)
        r = client.get("/api/ensight/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
        assert r.json()["available"] is False, email


def test_availability_false_when_key_unset(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "")
    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/ensight/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.json()["available"] is False


def test_ask_rejects_national_only_user(client, client_headers, make_token):
    token = make_token("someone-else@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "How many CUs are there?"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_ask_503_when_key_unset(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "")
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "How many CUs are there?"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 503


def test_ask_success_shape_dashboard_route(client, client_headers, make_token, monkeypatch):
    def fake_ask(app, user, question, history, filters, force_refresh=False):
        return AskResult(
            answer="Key finding: ...",
            route="dashboard",
            cached=False,
            sources=[{"kind": "endpoint", "path": "/api/overview/summary", "params": {"term": "term1"}}],
        )

    monkeypatch.setattr(ensight_router, "ask", fake_ask)
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "Which CU has the lowest LEC delivery rate?"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["route"] == "dashboard"
    assert body["cached"] is False
    assert body["sources"] == [{"kind": "endpoint", "path": "/api/overview/summary", "params": {"term": "term1"}}]
    assert body["rows"] is None
    assert body["notes"] == []


def test_ask_success_shape_sql_route_carries_rows_and_notes(client, client_headers, make_token, monkeypatch):
    def fake_ask(app, user, question, history, filters, force_refresh=False):
        return AskResult(
            answer="Key finding: ...",
            route="sql",
            cached=True,
            cached_minutes_ago=4,
            sources=[{"kind": "sql", "sql": "SELECT 1 AS one", "bytes_processed": 100, "row_count": 1}],
            rows=[{"one": 1}],
            row_count=1,
            notes=["The dashboard endpoints didn't cover this — queried the warehouse directly instead."],
        )

    monkeypatch.setattr(ensight_router, "ask", fake_ask)
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "Anything warehouse-only"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["route"] == "sql"
    assert body["cached"] is True
    assert body["cached_minutes_ago"] == 4
    assert body["sources"][0]["kind"] == "sql"
    assert body["rows"] == [{"one": 1}]
    assert body["row_count"] == 1
    assert len(body["notes"]) == 1


def test_ask_rate_limited_returns_429(client, client_headers, make_token, monkeypatch):
    def fake_ask(app, user, question, history, filters, force_refresh=False):
        raise RateLimitError("slow down")

    monkeypatch.setattr(ensight_router, "ask", fake_ask)
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "Anything"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 429


def test_ask_llm_error_returns_502(client, client_headers, make_token, monkeypatch):
    def fake_ask(app, user, question, history, filters, force_refresh=False):
        raise EnsightLLMError("model unavailable")

    monkeypatch.setattr(ensight_router, "ask", fake_ask)
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/ask",
        json={"question": "Anything"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 502


def test_ask_requires_auth(client, client_headers):
    r = client.post("/api/ensight/ask", json={"question": "Anything"}, headers=client_headers)
    assert r.status_code in (401, 403)


_EXPORT_BODY = {
    "format": "pptx",
    "items": [{"question": "Which CU?", "answer": "Key finding: ...", "sources": [], "notes": []}],
}


def test_export_rejects_national_only_user(client, client_headers, make_token):
    token = make_token("someone-else@experienceeducate.org")
    r = client.post(
        "/api/ensight/export",
        json=_EXPORT_BODY,
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_export_503_when_key_unset(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "")
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/export",
        json=_EXPORT_BODY,
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 503


def test_export_success_returns_the_built_file(client, client_headers, make_token, monkeypatch):
    from app.core import ensight_export

    monkeypatch.setattr(
        ensight_export, "build",
        lambda items, fmt, user, app, generated_on=None: (b"PKfake", "E!nsight-Report-2026-09-23.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    )
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/export",
        json=_EXPORT_BODY,
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.content == b"PKfake"
    assert 'filename="E!nsight-Report-2026-09-23.pptx"' in r.headers["content-disposition"]
    assert r.headers["cache-control"] == "no-store"


def test_export_build_failure_returns_502(client, client_headers, make_token, monkeypatch):
    from app.core import ensight_export

    def boom(items, fmt, user, app, generated_on=None):
        raise RuntimeError("something broke")

    monkeypatch.setattr(ensight_export, "build", boom)
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/export",
        json=_EXPORT_BODY,
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 502


def test_export_validates_format(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/ensight/export",
        json={**_EXPORT_BODY, "format": "pdf"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_export_requires_auth(client, client_headers):
    r = client.post("/api/ensight/export", json=_EXPORT_BODY, headers=client_headers)
    assert r.status_code in (401, 403)
