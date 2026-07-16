"""CU drilldown router tests via the ``database.run_query`` seam."""
from app.core import database


def test_cu_national_can_access_any_cu(client, client_headers, monkeypatch, make_token):
    seen = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen.append((sql, params))
        return [{"level": "school", "cu": "entebbe", "school_name": "A"}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/cu?cu=entebbe&term=term1",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["data"][0]["cu"] == "entebbe"
    # Query must always constrain to school level + the requested CU.
    sql, _ = seen[0]
    assert "level = @level" in sql
    assert "LOWER(cu) IN UNNEST" in sql


def test_cu_scoped_user_denied_outside_scope(client, client_headers, monkeypatch, make_token):
    def fake_run_query(*a, **k):
        return []

    monkeypatch.setattr(database, "run_query", fake_run_query)

    # FOA scoped to 'mpigi' only → asking for 'entebbe' is denied.
    token = make_token("cu@experienceeducate.org")
    r = client.get(
        "/api/cu?cu=entebbe",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_cu_scoped_user_allowed_in_scope(client, client_headers, monkeypatch, make_token):
    monkeypatch.setattr(database, "run_query", lambda *a, **k: [])
    token = make_token("cu@experienceeducate.org")
    r = client.get(
        "/api/cu?cu=mpigi",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


def test_cu_requires_cu_param(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/cu",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    # Missing required query param → 422 (typed param), not 500.
    assert r.status_code == 422
