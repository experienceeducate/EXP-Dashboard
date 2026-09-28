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


def test_analytics_summary_weekly_role_usability(client, client_headers, make_token, monkeypatch):
    """role_totals is the fixed roster size per category (from conftest's
    ACCESS_CONFIG: 1 national, 1 regional, 1 cu). by_week_role buckets active
    users by ISO week (Monday start) and role, computing active/total. A
    domain-fallback login (any @experienceeducate.org email not explicitly
    listed — analytics-admin@ here) must classify as "other", never silently
    counted as "national"."""
    fake_rows = [
        {"event_type": "page_view", "view": "national", "user_email": "admin@experienceeducate.org", "session_id": "s1", "duration_seconds": None, "event_timestamp": "2026-09-01T10:00:00+00:00"},  # week of 2026-08-31
        {"event_type": "page_view", "view": "regional", "user_email": "central@experienceeducate.org", "session_id": "s2", "duration_seconds": None, "event_timestamp": "2026-09-02T10:00:00+00:00"},  # same week
        {"event_type": "page_view", "view": "cu", "user_email": "cu@experienceeducate.org", "session_id": "s3", "duration_seconds": None, "event_timestamp": "2026-09-08T10:00:00+00:00"},  # week of 2026-09-07
        {"event_type": "page_view", "view": "national", "user_email": "central@experienceeducate.org", "session_id": "s4", "duration_seconds": None, "event_timestamp": "2026-09-09T10:00:00+00:00"},  # week of 2026-09-07 too
        {"event_type": "page_view", "view": "national", "user_email": "analytics-admin@experienceeducate.org", "session_id": "s5", "duration_seconds": None, "event_timestamp": "2026-09-01T10:00:00+00:00"},
    ]
    monkeypatch.setattr(database_mod, "query_rows_ignore_missing_table", lambda sql, params=None, timeout=None: fake_rows)

    token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/analytics-summary", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()

    assert body["role_totals"] == {"national": 1, "regional": 1, "cu": 1}

    by_week = {w["week_start"]: w for w in body["by_week_role"]}
    assert set(by_week.keys()) == {"2026-08-31", "2026-09-07"}

    week1 = by_week["2026-08-31"]
    assert week1["national"] == {"active_users": 1, "total_users": 1, "usability_pct": 100.0}
    assert week1["regional"] == {"active_users": 1, "total_users": 1, "usability_pct": 100.0}
    assert week1["cu"] == {"active_users": 0, "total_users": 1, "usability_pct": 0.0}

    week2 = by_week["2026-09-07"]
    assert week2["cu"] == {"active_users": 1, "total_users": 1, "usability_pct": 100.0}
    assert week2["regional"] == {"active_users": 1, "total_users": 1, "usability_pct": 100.0}
    assert week2["national"] == {"active_users": 0, "total_users": 1, "usability_pct": 0.0}

    by_user = {u["user_email"]: u for u in body["by_user"]}
    assert by_user["analytics-admin@experienceeducate.org"]["role"] == "other"
    assert by_user["admin@experienceeducate.org"]["role"] == "national"
    assert by_user["central@experienceeducate.org"]["role"] == "regional"
    assert by_user["cu@experienceeducate.org"]["role"] == "cu"


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
