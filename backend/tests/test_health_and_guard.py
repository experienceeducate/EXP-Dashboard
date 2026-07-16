def test_health_no_header_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_api_requires_client_header(client):
    # No X-Exp-Client header → 403 before auth even runs.
    r = client.get("/api/overview/summary")
    assert r.status_code == 403
    assert "client header" in r.json()["detail"].lower()


def test_api_bad_client_header(client):
    r = client.get("/api/overview/summary", headers={"X-Exp-Client": "wrong"})
    assert r.status_code == 403
