"""The E!nsight pipeline's orchestration logic — plan/dashboard/sql routing,
caching (incl. the dashboard→SQL escalation note), and rate limiting.

The LLM and BigQuery calls are monkeypatched at the names ``ensight_pipeline``
imported them under, mirroring the ``database.run_query`` seam pattern.
"""
from datetime import date

import pytest

from app.core import ensight_pipeline as pipeline
from app.core.access import UserAccess
from app.core.ensight_guardrails import GuardrailResult
from app.main import app as real_app


@pytest.fixture(autouse=True)
def _clear_state():
    pipeline._answer_cache.clear()
    pipeline._rate_state.clear()
    yield
    pipeline._answer_cache.clear()
    pipeline._rate_state.clear()


def _user():
    return UserAccess(email="admin@experienceeducate.org", has_national=True)


def test_current_and_last_term_mid_term3():
    # 2026-09-23 falls inside Term 3's window (Sep 14 - Dec 4).
    assert pipeline._current_and_last_term(date(2026, 9, 23)) == ("term3", "term2")


def test_current_and_last_term_mid_term1_has_no_prior_term():
    assert pipeline._current_and_last_term(date(2026, 3, 1)) == ("term1", None)


def test_current_and_last_term_in_a_gap_uses_the_concluded_term():
    # Between Term 1 ending (May 1) and Term 2 starting (May 25).
    assert pipeline._current_and_last_term(date(2026, 5, 10)) == ("term1", None)


def test_filters_line_resolves_last_term_concretely(monkeypatch):
    # Not coupled to the real wall-clock date, which would otherwise break
    # this test once the calendar window it exercises has passed.
    monkeypatch.setattr(pipeline, "_current_and_last_term", lambda today=None: ("term3", "term2"))
    line = pipeline._filters_line({"term": "all"})
    assert '"last/previous term" means term2' in line
    assert '"this/current term" means term3' in line


def test_shrink_caps_list_length_with_a_marker():
    rows = [{"cu": f"CU{i}"} for i in range(20)]
    shrunk = pipeline._shrink(rows)
    assert len(shrunk) == pipeline._MAX_LIST_ITEMS + 1  # kept rows + the marker
    assert shrunk[-1] == "...8 more rows not shown"


def test_shrink_leaves_short_lists_untouched():
    rows = [{"cu": "Mpigi"}, {"cu": "Kabale"}]
    assert pipeline._shrink(rows) == rows


def test_shrink_recurses_into_nested_dashboard_payload_shape():
    payload = {"status": "ok", "cu": [{"cu": f"CU{i}"} for i in range(20)], "schools": []}
    shrunk = pipeline._shrink(payload)
    assert len(shrunk["cu"]) == pipeline._MAX_LIST_ITEMS + 1
    assert shrunk["schools"] == []


def test_capped_json_marks_truncation_rather_than_cutting_silently():
    text = pipeline._capped_json({"a": "x" * 100}, max_chars=20)
    assert len(text) == 20 + len(" ...(truncated)")
    assert text.endswith(" ...(truncated)")


def test_capped_json_leaves_small_payloads_untouched():
    text = pipeline._capped_json({"a": 1}, max_chars=9000)
    assert "truncated" not in text


def test_evidence_for_endpoints_shrinks_each_payload_independently():
    fetched = {
        "/api/overview/summary": {"cu": [{"cu": f"CU{i}"} for i in range(20)]},
        "/api/cu": {"data": [{"school": "X"}]},
    }
    text = pipeline._evidence_for_endpoints(fetched)
    assert "/api/overview/summary:" in text
    assert "/api/cu:" in text
    assert "more rows not shown" in text


def test_refuse_route_is_cached_and_reused(monkeypatch):
    monkeypatch.setattr(pipeline, "chat_json", lambda *a, **k: {"route": "refuse", "refusal_reason": "not EXP data"})
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    r1 = pipeline.ask(app=real_app, user=_user(), question="What's the weather?", history=[], filters={})
    assert r1.route == "refuse"
    assert r1.cached is False
    assert "not EXP data" in r1.answer

    # Second identical question should be served from cache without another
    # chat_json call — break chat_json to prove it isn't invoked again.
    monkeypatch.setattr(pipeline, "chat_json", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not call the model again")))
    r2 = pipeline.ask(app=real_app, user=_user(), question="What's the weather?", history=[], filters={})
    assert r2.cached is True
    assert r2.route == "refuse"
    assert r2.cached_minutes_ago == 0


def test_dashboard_sufficient_answer_has_endpoint_sources(monkeypatch):
    calls = {"n": 0}

    def fake_chat_json(system, user_msg, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"route": "dashboard", "calls": [{"path": "/api/overview/summary", "params": {"term": "term1"}}]}
        return {"sufficient": True, "answer": "Key finding: 42."}

    monkeypatch.setattr(pipeline, "chat_json", fake_chat_json)
    monkeypatch.setattr(pipeline, "call_endpoint", lambda app, path, args, user: {"status": "ok", "data": []})
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    result = pipeline.ask(app=real_app, user=_user(), question="How many CUs?", history=[], filters={})
    assert result.route == "dashboard"
    assert result.sources == [{"kind": "endpoint", "path": "/api/overview/summary", "params": {"term": "term1"}}]
    assert result.rows is None
    assert result.notes == []


def test_dashboard_insufficient_escalates_to_sql_with_a_note(monkeypatch):
    steps = {"n": 0}

    def fake_chat_json(system, user_msg, **kwargs):
        steps["n"] += 1
        if steps["n"] == 1:
            return {"route": "dashboard", "calls": [{"path": "/api/overview/summary", "params": {}}]}
        if steps["n"] == 2:
            return {"sufficient": False, "reason": "no login data on this endpoint"}
        if steps["n"] == 3:
            return {"sql": "SELECT COUNT(*) AS n FROM `x.y.z` WHERE first_login_at IS NULL"}
        return {"answer": "Key finding: 3 mentors."}

    monkeypatch.setattr(pipeline, "chat_json", fake_chat_json)
    monkeypatch.setattr(pipeline, "call_endpoint", lambda app, path, args, user: {"status": "ok"})
    monkeypatch.setattr(
        pipeline.ensight_guardrails,
        "run_guarded",
        lambda sql: (GuardrailResult(True, dry_run_bytes=10), [{"n": 3}]),
    )
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    result = pipeline.ask(app=real_app, user=_user(), question="How many mentors never logged in?", history=[], filters={})
    assert result.route == "sql"
    assert result.rows == [{"n": 3}]
    assert result.row_count == 1
    assert any("didn't cover this" in n for n in result.notes)
    assert result.sources[0]["kind"] == "sql"


def test_metric_route_uses_validated_computation_not_generated_sql(monkeypatch):
    steps = {"n": 0}

    def fake_chat_json(system, user_msg, **kwargs):
        steps["n"] += 1
        if steps["n"] == 1:
            return {"route": "metric"}
        if steps["n"] == 2:
            return {"dimension": "cu", "terms": ["term2"], "filter_names": []}
        return {"answer": "Key finding: Nakawa leads at 92% LEC delivery."}

    computed_rows = [{"group": "NAKAWA", "term": "term2", "lec_delivery_pct": 92.0}]

    monkeypatch.setattr(pipeline, "chat_json", fake_chat_json)
    monkeypatch.setattr(pipeline.ensight_metrics, "compute", lambda user, dimension, terms, filter_names: computed_rows)
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    result = pipeline.ask(app=real_app, user=_user(), question="Which CU had the best LEC delivery last term?", history=[], filters={})
    assert result.route == "metric"
    assert result.rows == computed_rows
    assert result.row_count == 1
    assert result.sources[0]["kind"] == "metric"
    assert result.sources[0]["dimension"] == "cu"
    assert result.sources[0]["terms"] == ["term2"]


def test_metric_route_passes_filter_names_and_terms_through(monkeypatch):
    captured = {}

    def fake_chat_json(system, user_msg, **kwargs):
        if "dimension" not in captured:
            captured["dimension"] = True
            return {"route": "metric"}
        if "terms" not in captured:
            captured["terms"] = True
            return {"dimension": "national", "terms": ["term1", "term2", "term3"], "filter_names": ["Nakawa"]}
        return {"answer": "Key finding: trend shown."}

    def fake_compute(user, dimension, terms, filter_names):
        captured["call"] = (dimension, terms, filter_names)
        return []

    monkeypatch.setattr(pipeline, "chat_json", fake_chat_json)
    monkeypatch.setattr(pipeline.ensight_metrics, "compute", fake_compute)
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    pipeline.ask(app=real_app, user=_user(), question="How has Nakawa's funnel changed across all terms?", history=[], filters={})
    assert captured["call"] == ("national", ["term1", "term2", "term3"], ["Nakawa"])


def test_sql_repair_succeeds_and_notes_it(monkeypatch):
    steps = {"n": 0}

    def fake_chat_json(system, user_msg, **kwargs):
        steps["n"] += 1
        if steps["n"] == 1:
            return {"route": "sql"}
        if steps["n"] == 2:
            return {"sql": "BAD SQL"}
        if steps["n"] == 3:
            return {"sql": "SELECT 1 AS one FROM `x.y.z`"}
        return {"answer": "Key finding: 1."}

    guard_calls = {"n": 0}

    def fake_run_guarded(sql):
        guard_calls["n"] += 1
        if guard_calls["n"] == 1:
            return GuardrailResult(False, "syntax error"), []
        return GuardrailResult(True, dry_run_bytes=5), [{"one": 1}]

    monkeypatch.setattr(pipeline, "chat_json", fake_chat_json)
    monkeypatch.setattr(pipeline.ensight_guardrails, "run_guarded", fake_run_guarded)
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    result = pipeline.ask(app=real_app, user=_user(), question="Some warehouse-only question", history=[], filters={})
    assert result.route == "sql"
    assert any("needed one repair" in n for n in result.notes)


def test_rate_limit_raises_after_per_minute_threshold(monkeypatch):
    monkeypatch.setattr(pipeline, "chat_json", lambda *a, **k: {"route": "refuse", "refusal_reason": "x"})
    monkeypatch.setattr(pipeline.database, "insert_rows", lambda *a, **k: [])

    for i in range(pipeline.RATE_LIMIT_PER_MINUTE):
        pipeline.ask(app=real_app, user=_user(), question=f"question {i}", history=[], filters={})

    with pytest.raises(pipeline.RateLimitError):
        pipeline.ask(app=real_app, user=_user(), question="one too many", history=[], filters={})
