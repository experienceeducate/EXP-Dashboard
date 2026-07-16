"""Router tests that exercise the ``database.run_query`` test seam via monkeypatch."""
from app.core import database


def test_summary_scopes_and_returns_data(client, client_headers, monkeypatch, make_token):
    captured = {}

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        captured.setdefault("calls", []).append((sql, params, scope_key))
        if "level = @level" in sql and any(p.value == "cu" for p in params):
            return [{"level": "cu", "cu": "mpigi", "region": "Central"}]
        return [{"level": "school", "cu": "mpigi", "school_name": "X"}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/overview/summary?term=term1",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert len(body["cu"]) == 1
    assert len(body["schools"]) == 1
    # National user → access clause must NOT restrict region/cu.
    for sql, _params, _scope in captured["calls"]:
        assert "acc_regions" not in sql


def test_summary_regional_user_adds_access_filter(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return []

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("central@experienceeducate.org")
    r = client.get(
        "/api/overview/summary",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert any("region IN UNNEST(@acc_regions)" in s for s in seen_sql)


def test_summary_requires_auth(client, client_headers):
    r = client.get("/api/overview/summary", headers=client_headers)
    assert r.status_code in (401, 403)
