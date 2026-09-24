"""POST /api/analytics/event: any signed-in user records their own activity."""
from app.core import database as database_mod


def test_track_page_view_any_signed_in_user(client, client_headers, make_token, monkeypatch):
    captured = {}

    def fake_insert_rows(table_ref, rows):
        captured["table_ref"] = table_ref
        captured["rows"] = rows
        return []

    monkeypatch.setattr(database_mod, "insert_rows", fake_insert_rows)

    token = make_token("central@experienceeducate.org")  # regional user — not admin
    r = client.post(
        "/api/analytics/event",
        json={"event": "page_view", "view": "regional", "session_id": "sess-1"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert captured["rows"][0]["event_type"] == "page_view"
    assert captured["rows"][0]["view"] == "regional"
    assert captured["rows"][0]["user_email"] == "central@experienceeducate.org"


def test_track_session_end_with_duration(client, client_headers, make_token, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        database_mod, "insert_rows", lambda table_ref, rows: captured.setdefault("rows", rows) and []
    )

    token = make_token("cu@experienceeducate.org")
    r = client.post(
        "/api/analytics/event",
        json={"event": "session_end", "view": "cu", "session_id": "sess-2", "duration_seconds": 42},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert captured["rows"][0]["duration_seconds"] == 42


def test_track_event_rejects_unknown_event_type(client, client_headers, make_token):
    token = make_token("central@experienceeducate.org")
    r = client.post(
        "/api/analytics/event",
        json={"event": "not_a_real_event", "view": "regional", "session_id": "sess-3"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_track_event_degrades_gracefully_when_write_fails(client, client_headers, make_token, monkeypatch):
    # insert_rows never raises (see its docstring) — a missing table or bad
    # row surfaces as a non-empty error list, which the route logs and still
    # returns 200 for, since a tracking hiccup shouldn't be user-visible.
    monkeypatch.setattr(
        database_mod, "insert_rows", lambda table_ref, rows: [{"error": "table not found"}]
    )
    token = make_token("central@experienceeducate.org")
    r = client.post(
        "/api/analytics/event",
        json={"event": "page_view", "view": "regional", "session_id": "sess-4"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
