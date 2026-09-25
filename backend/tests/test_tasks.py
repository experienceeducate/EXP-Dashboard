"""Issue-tracking router: access-scoped read, gated write, notes combining."""
from app.core import database as database_mod


def test_list_task_status_empty_when_table_missing(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None: [])
    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/tasks", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["tasks"] == {}


def test_list_task_status_derives_latest_and_builds_timeline(client, client_headers, make_token, monkeypatch):
    fake_rows = [
        {
            "issue_key": "mpigi_lec_behind_pace_x",
            "status": "open",
            "reason": None,
            "notes": None,
            "user_email": "cu@experienceeducate.org",
            "action_timestamp": "2026-09-01T10:00:00+00:00",
        },
        {
            "issue_key": "mpigi_lec_behind_pace_x",
            "status": "resolved",
            "reason": "Already addressed with FOA/mentor",
            "notes": "caught up this week",
            "user_email": "cu@experienceeducate.org",
            "action_timestamp": "2026-09-05T10:00:00+00:00",
        },
    ]
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None: fake_rows)

    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/tasks", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    entry = r.json()["tasks"]["mpigi_lec_behind_pace_x"]
    assert entry["status"] == "resolved"
    assert len(entry["timeline"]) == 2
    assert entry["timeline"][1]["notes"] == "Already addressed with FOA/mentor — caught up this week"


def test_update_rejects_cu_user_acting_outside_their_cu(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(database_mod, "insert_rows", lambda table_ref, rows: [])
    token = make_token("cu@experienceeducate.org")  # scoped to "mpigi" (see conftest)
    r = client.post(
        "/api/tasks",
        json={
            "issue_key": "someothercu_x_y",
            "region": "",
            "cu": "someothercu",
            "issue_type": "LEC Behind Pace",
            "issue_detail": "x",
            "status": "resolved",
        },
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_update_allows_cu_user_acting_on_their_own_cu(client, client_headers, make_token, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        database_mod, "insert_rows", lambda table_ref, rows: captured.setdefault("rows", rows) and []
    )
    token = make_token("cu@experienceeducate.org")
    r = client.post(
        "/api/tasks",
        json={
            "issue_key": "mpigi_lec_behind_pace_x",
            "region": "",
            "cu": "mpigi",
            "issue_type": "LEC Behind Pace",
            "issue_detail": "x",
            "severity": "high",
            "status": "resolved",
            "reason": "Already addressed with FOA/mentor",
            "notes": "caught up this week",
        },
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["notes"] == "Already addressed with FOA/mentor — caught up this week"
    assert body["user_email"] == "cu@experienceeducate.org"
    row = captured["rows"][0]
    assert row["issue_key"] == "mpigi_lec_behind_pace_x"
    assert row["status"] == "resolved"
    assert row["user_email"] == "cu@experienceeducate.org"


def test_update_allows_regional_user_acting_on_cu_in_their_region(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(database_mod, "insert_rows", lambda table_ref, rows: [])
    token = make_token("central@experienceeducate.org")  # scoped to region "Central"
    r = client.post(
        "/api/tasks",
        json={
            "issue_key": "somecu_x_y",
            "region": "Central",
            "cu": "somecu",
            "status": "in-progress",
        },
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


def test_update_allows_national_user_on_anything(client, client_headers, make_token, monkeypatch):
    monkeypatch.setattr(database_mod, "insert_rows", lambda table_ref, rows: [])
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/tasks",
        json={"issue_key": "anycu_x_y", "region": "West", "cu": "anycu", "status": "open"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


def test_update_rejects_unknown_status(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.post(
        "/api/tasks",
        json={"issue_key": "x", "status": "done"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
