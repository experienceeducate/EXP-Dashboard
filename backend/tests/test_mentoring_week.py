"""Mentoring Week router tests — per-school Trip 1 / Trip 2 reporting (silver)."""
from app.core import database


def _capture(monkeypatch, rows=None):
    seen = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen.append({"sql": sql, "params": params or [], "use_cache": use_cache})
        return rows or []

    monkeypatch.setattr(database, "run_query", fake_run_query)
    return seen


def _auth(client_headers, make_token, email="admin@experienceeducate.org"):
    return {**client_headers, "Authorization": f"Bearer {make_token(email)}"}


def test_schools_requires_auth(client, client_headers):
    r = client.get("/api/mentoring-week/schools", headers=client_headers)
    assert r.status_code in (401, 403)


def test_schools_national_user_has_no_access_filter(client, client_headers, monkeypatch, make_token):
    seen = _capture(monkeypatch, [{"school_id": "1306", "trip1": True, "trip2": True}])
    r = client.get("/api/mentoring-week/schools", headers=_auth(client_headers, make_token))
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "data": [{"school_id": "1306", "trip1": True, "trip2": True}]}
    sql = seen[0]["sql"]
    assert "exp_common_mentor_activity_report`" in sql
    assert "mw_regions" not in sql and "mw_cus_norm" not in sql
    # Trip comes from mentoring_week_category (not session_number).
    assert "mentoring_week_category" in sql and "session_number" not in sql
    assert "'mentoring week - trip 1'" in sql and "'mentoring week - trip 2'" in sql
    assert "LOWER(TRIM(report_type)) = 'mentoring_week'" in sql
    # One row per school — duplicates in the source must not inflate counts.
    assert "GROUP BY school_id, year, term" in sql
    assert "LOGICAL_OR(trip = 1)" in sql and "LOGICAL_OR(trip = 2)" in sql


def test_schools_always_reads_live(client, client_headers, monkeypatch, make_token):
    seen = _capture(monkeypatch)
    client.get("/api/mentoring-week/schools?term=term3", headers=_auth(client_headers, make_token))
    assert seen[0]["use_cache"] is False


def test_schools_cu_scoped_user_adds_fuzzy_access_filter(client, client_headers, monkeypatch, make_token):
    seen = _capture(monkeypatch)
    r = client.get("/api/mentoring-week/schools", headers=_auth(client_headers, make_token, "cu@experienceeducate.org"))
    assert r.status_code == 200
    assert "mw_cus_norm" in seen[0]["sql"]
    assert any(p.name == "mw_cus_norm" for p in seen[0]["params"])


def test_schools_term_is_parameterised_and_rows_keep_year_and_term(client, client_headers, monkeypatch, make_token):
    seen = _capture(monkeypatch)
    r = client.get("/api/mentoring-week/schools?term=term3", headers=_auth(client_headers, make_token))
    assert r.status_code == 200
    sql, params = seen[0]["sql"], seen[0]["params"]
    assert "LOWER(TRIM(term)) = @mw_term" in sql
    assert any(p.name == "mw_term" and p.value == "term3" for p in params)
    # No year or term is hard-coded; each row keeps its own year and term.
    assert "GROUP BY school_id, year, term" in sql
    assert "@mw_year" not in sql and "2026" not in sql


def test_schools_all_terms_has_no_term_filter(client, client_headers, monkeypatch, make_token):
    seen = _capture(monkeypatch)
    client.get("/api/mentoring-week/schools?term=all", headers=_auth(client_headers, make_token))
    assert "@mw_term" not in seen[0]["sql"]


def test_schools_rejects_bad_params(client, client_headers, make_token):
    h = _auth(client_headers, make_token)
    assert client.get("/api/mentoring-week/schools?term=term9", headers=h).status_code == 422
