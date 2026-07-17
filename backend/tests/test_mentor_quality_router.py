"""Mentor Quality router tests — second BigQuery source (see docs/DECISION.md ADR-008)."""
from app.core import database


def test_summary_requires_auth(client, client_headers):
    r = client.get("/api/mentor-quality/summary", headers=client_headers)
    assert r.status_code in (401, 403)


def test_summary_national_user_has_no_access_filter(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return [{"region": "Central", "cu": "Mpigi", "term": "term1", "overall_quality_index": 2.5}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/summary?term=term1",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    for sql in seen_sql:
        assert "acc_regions" not in sql
        assert "cus_norm" not in sql


def test_summary_cu_scoped_user_adds_fuzzy_access_filter(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return []

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("cu@experienceeducate.org")  # scoped to cu "mpigi" per conftest ACCESS_CONFIG
    r = client.get(
        "/api/mentor-quality/summary",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    # The fuzzy cu clause (not the plain gold_exp cu_clause) must be used, with
    # distinct param names for the roster CTE vs the observation_base CTE.
    assert any("REGEXP_REPLACE(LOWER(cu)" in s for s in seen_sql)
    assert any("obs_cus_norm" in s for s in seen_sql)
    assert any("roster_cus_norm" in s for s in seen_sql)


def test_summary_by_cu_has_no_term_column_and_no_duplicate_params(client, client_headers, monkeypatch, make_token):
    """Regression: /summary sums per (region,cu,term) rows — double-counts mentors
    observed in multiple terms under "All Terms". /summary-by-cu groups by
    (region, cu) only so callers can sum safely regardless of term selection."""
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append(sql)
        return [{"region": "Central", "cu": "Mpigi", "mentors_observed": 5, "total_mentors_assigned": 6}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/summary-by-cu",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["data"][0]["cu"] == "Mpigi"
    assert "term" not in body["data"][0]
    for sql in seen_sql:
        assert "GROUP BY region, cu\n" in sql or "GROUP BY region, cu_normalized" in sql


def test_summary_rejects_invalid_term(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/summary?term=bogus",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_mentors_endpoint_requires_cu_param(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/mentors",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_mentors_endpoint_filters_by_cu(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append((sql, params))
        return [{"mentor_id": "1", "region": "Central", "cu": "Mpigi", "mentor_quality_index": 2.8}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/mentors?cu=mpigi&term=term1",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["data"][0]["mentor_id"] == "1"
    sql, params = seen_sql[0]
    assert "drill_cu_norm" in sql
    assert any(p.name == "drill_cu_norm" and p.values == ["mpigi"] for p in params)


def test_mentor_observations_requires_cu_and_mentor_id(client, client_headers, make_token):
    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/mentor-observations?cu=mpigi",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_mentor_observations_filters_by_cu_and_mentor(client, client_headers, monkeypatch, make_token):
    seen_sql = []

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        seen_sql.append((sql, params))
        return [{"observer_name": "Eu385", "mentor_name": "Kyomugisha Barbra", "comment": "Good session."}]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/mentor-observations?cu=mpigi&mentor_id=124899&term=term1",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["data"][0]["observer_name"] == "Eu385"
    assert body["data"][0]["mentor_name"] == "Kyomugisha Barbra"
    sql, params = seen_sql[0]
    assert "detail_cu_norm" in sql and "detail_mentor_id" in sql
    assert any(p.name == "detail_mentor_id" and p.value == "124899" for p in params)


def test_comments_endpoint_tags_themes(client, client_headers, monkeypatch, make_token):
    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        return [
            {
                "region": "Central",
                "cu": "Mpigi",
                "term": "term1",
                "session_number": "LEC1",
                "mentor_id": "1",
                "observation_date": "2026-03-01",
                "comment": "The mentor checked for understanding well. However, he struggled with time management.",
            }
        ]

    monkeypatch.setattr(database, "run_query", fake_run_query)

    token = make_token("admin@experienceeducate.org")
    r = client.get(
        "/api/mentor-quality/comments",
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    themes = {t["key"] for t in body["data"][0]["themes"]}
    assert "time_management" in themes
    assert "checking_understanding" in themes

    summary_by_key = {t["theme"]: t for t in body["theme_summary"]}
    assert summary_by_key["time_management"]["growth_count"] == 1
    assert summary_by_key["checking_understanding"]["strength_count"] == 1
