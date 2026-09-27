"""E-Lab router tests — third BigQuery source (mentor digital-lesson activity)."""
from app.core import database


def test_summary_by_cu_requires_auth(client, client_headers):
    r = client.get("/api/elab/summary-by-cu", headers=client_headers)
    assert r.status_code in (401, 403)


def test_summary_by_cu_national_user_has_no_access_filter(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return [{"region": "Central", "cu": "Mpigi", "active_mentors": 10, "sessions_completed": 5}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/summary-by-cu?term=term3",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["expected_sessions"] == [15, 16, 17, 18, 19, 20]
    for sql in seen_sql:
        assert "acc_regions" not in sql
        assert "elab_cus_norm" not in sql


def test_summary_by_cu_cu_scoped_user_adds_fuzzy_access_filter(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return []

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("cu@experienceeducate.org")  # scoped to cu "mpigi" per conftest ACCESS_CONFIG
    r = client.get(
        "/api/elab/summary-by-cu",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert any("REGEXP_REPLACE(LOWER(CU)" in s for s in seen_sql)
    assert any("elab_cus_norm" in s for s in seen_sql)


def test_summary_by_cu_distinguishes_session_from_mentor_completion(client, client_headers, monkeypatch, make_token):
    """Regression: sessions_completed/session_completion_pct count individual
    mentor x session instances (can exceed active_mentors); mentors_fully_completed/
    mentor_completion_pct count mentors who finished ALL expected sessions —
    a distinct, stricter metric. Both must be present and separately named,
    never conflated into one "completed" field."""
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return [{
            "region": "Central", "cu": "Mpigi", "active_mentors": 5,
            "sessions_completed": 8, "session_completion_pct": 26.7,
            "mentors_fully_completed": 1, "mentor_completion_pct": 20.0,
        }]

    monkeypatch.setattr(database, "run_query", fake_run_query)
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/summary-by-cu?term=term3",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert row["sessions_completed"] != row["mentors_fully_completed"]
    assert "session_completion_pct" in row and "mentor_completion_pct" in row
    assert "overall_completion_pct" not in row  # renamed — no longer ambiguous
    # The query itself must actually compute mentors_fully_completed from a
    # per-mentor session count, not just alias sessions_completed.
    assert any("mentor_sessions_completed" in sql for sql in seen_sql)
    assert any("mentors_fully_completed" in sql for sql in seen_sql)


def test_summary_by_cu_has_no_duplicate_term_params(client, client_headers, monkeypatch, make_token):
    """Regression: the roster CTE (gold_exp) and the sessions CTE (e-lab) each
    filter by term — they must use distinct BigQuery parameter names, or the
    combined query would carry two ScalarQueryParameters both named "term"."""
    seen_params = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_params.append(list(params or []))
        return []

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/summary-by-cu?term=term2",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    names = [p.name for p in seen_params[0]]
    assert names.count("roster_term") == 1
    assert names.count("elab_term") == 1
    assert len(names) == len(set(names))  # no duplicate parameter names at all


def test_summary_by_cu_rejects_invalid_term(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/summary-by-cu?term=all",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422  # "all" isn't supported — v1 targets a specific term


def test_mentors_requires_cu_param(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/mentors",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_mentors_filters_by_cu_and_returns_expected_sessions(client, client_headers, monkeypatch, make_token):
    seen = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen.append((sql, params))
        return [{"mentor_id": "1", "mentor_name": "Jane", "gender": "female", "role": "mentor", "sessions_completed": 3}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/elab/mentors?cu=Mpigi&term=term3",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["expected_sessions"] == [15, 16, 17, 18, 19, 20]
    assert body["data"][0]["mentor_name"] == "Jane"
    sql, params = seen[0]
    assert any(p.name == "cu" and p.value == "Mpigi" for p in params)
