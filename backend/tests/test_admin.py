"""Admin usage-analytics router: gating + summary aggregation."""
from app.core import database as database_mod


def test_availability_true_for_admin_listed_user(client, client_headers, make_token):
    token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["available"] is True


def test_availability_false_for_national_user_not_in_admin_list(client, client_headers, make_token):
    # Full dashboard access, but "admin" is an independent allowlist.
    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/admin/availability", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_analytics_summary_rejects_non_admin(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get("/api/admin/analytics-summary", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_analytics_summary_aggregates_events(client, client_headers, make_token, monkeypatch):
    fake_rows = [
        {"event_type": "page_view", "view": "national", "user_email": "a@experienceeducate.org", "duration_seconds": None},
        {"event_type": "page_view", "view": "national", "user_email": "b@experienceeducate.org", "duration_seconds": None},
        {"event_type": "page_view", "view": "regional", "user_email": "a@experienceeducate.org", "duration_seconds": None},
        {"event_type": "session_end", "view": "national", "user_email": "a@experienceeducate.org", "duration_seconds": 100},
        {"event_type": "session_end", "view": "regional", "user_email": "b@experienceeducate.org", "duration_seconds": 50},
    ]
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None: fake_rows)

    token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/analytics-summary", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["active_users"] == 2
    assert body["total_sessions"] == 2
    assert body["avg_session_seconds"] == 75.0
    by_view = {row["view"]: row["count"] for row in body["page_views_by_tab"]}
    assert by_view == {"national": 2, "regional": 1}


def test_analytics_summary_by_user_breakdown(client, client_headers, make_token, monkeypatch):
    fake_rows = [
        {"event_type": "page_view", "view": "national", "user_email": "a@experienceeducate.org", "session_id": "s1", "duration_seconds": None, "event_timestamp": "2026-09-01T10:00:00+00:00"},
        {"event_type": "page_view", "view": "regional", "user_email": "a@experienceeducate.org", "session_id": "s1", "duration_seconds": None, "event_timestamp": "2026-09-01T10:05:00+00:00"},
        {"event_type": "session_end", "view": "regional", "user_email": "a@experienceeducate.org", "session_id": "s1", "duration_seconds": 120, "event_timestamp": "2026-09-01T10:10:00+00:00"},
        {"event_type": "page_view", "view": "national", "user_email": "b@experienceeducate.org", "session_id": "s2", "duration_seconds": None, "event_timestamp": "2026-09-02T09:00:00+00:00"},
        {"event_type": "session_end", "view": "national", "user_email": "b@experienceeducate.org", "session_id": "s2", "duration_seconds": 30, "event_timestamp": "2026-09-02T09:02:00+00:00"},
    ]
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None: fake_rows)

    token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/analytics-summary", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    by_user = {row["user_email"]: row for row in r.json()["by_user"]}

    a = by_user["a@experienceeducate.org"]
    assert a["page_views"] == 2
    assert a["sessions"] == 1
    assert a["distinct_tabs"] == 2
    assert a["active_seconds"] == 120
    assert a["first_seen"] == "2026-09-01T10:00:00+00:00"
    assert a["last_seen"] == "2026-09-01T10:10:00+00:00"

    b = by_user["b@experienceeducate.org"]
    assert b["active_seconds"] == 30

    # Sorted by active_seconds descending — a (120s) before b (30s).
    ordered = [row["user_email"] for row in r.json()["by_user"]]
    assert ordered == ["a@experienceeducate.org", "b@experienceeducate.org"]


def test_analytics_summary_no_op_when_table_missing(client, client_headers, make_token, monkeypatch):
    # query_rows_ignore_missing_table already returns [] rather than raising —
    # the summary should render as all-zero, not error.
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None: [])

    token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/analytics-summary", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["active_users"] == 0
    assert body["page_views_by_tab"] == []
    assert body["avg_session_seconds"] == 0
