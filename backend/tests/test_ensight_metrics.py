"""ensight_metrics — the validated-Python metric computation path.

The whole point of this module is that it CANNOT reproduce the live bugs a
freehand-generated SQL query kept introducing (NULL propagation through a
bare `+`, reading retention/recruitment's term1-only fields off whichever
term the question happened to ask about). ``compute_rollup`` itself is a
shared, independently-tested helper (``app/core/metric_rollup.py``) — this
file tests the grouping/filtering/access-scoping layer around it.
"""
from app.core import ensight_metrics as metrics
from app.core.access import UserAccess


def _national_user():
    return UserAccess(email="admin@experienceeducate.org", has_national=True)


def _regional_user():
    return UserAccess(email="regional@experienceeducate.org", regions=["Central"])


def _row(cu, region, term, **overrides):
    base = {
        "cu": cu, "region": region, "term": term,
        "total_target_schools": 10, "total_scholars_recruited": 0, "lec2_scholars": 0,
        "total_active_mentors": 0, "total_observed_mentors": 0,
        "m1_quality_rated": 0, "m1_total_rated": 0, "m2_quality_rated": 0, "m2_total_rated": 0,
        "m3_quality_rated": 0, "m3_total_rated": 0, "m4_quality_rated": 0, "m4_total_rated": 0,
    }
    for n in range(1, 21):
        base[f"schools_with_lec{n}"] = 0
        base[f"lec{n}_scholars"] = 0
    base.update(overrides)
    return base


def test_fetch_cu_rows_filters_to_cu_level(monkeypatch):
    captured = {}

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(metrics.database, "run_query", fake_run_query)
    metrics.fetch_cu_rows(_national_user())
    assert "level = @level" in captured["sql"]


def test_fetch_cu_rows_applies_access_clause_for_scoped_user(monkeypatch):
    captured = {}

    def fake_run_query(sql, params=None, *, scope_key="public", use_cache=True):
        captured["sql"] = sql
        return []

    monkeypatch.setattr(metrics.database, "run_query", fake_run_query)
    metrics.fetch_cu_rows(_regional_user())
    assert "region IN UNNEST" in captured["sql"]


def test_compute_national_dimension_aggregates_across_cus(monkeypatch):
    rows = [
        _row("Nakawa", "Kampala", "term2", total_target_schools=10, schools_with_lec6=10),
        _row("Mpigi", "Central", "term2", total_target_schools=5, schools_with_lec6=5),
    ]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "national", ["term2"])
    assert len(out) == 1
    assert out[0]["group"] == "National"
    assert out[0]["term"] == "term2"


def test_compute_cu_dimension_returns_one_row_per_cu(monkeypatch):
    rows = [
        _row("Nakawa", "Kampala", "term2"),
        _row("Mpigi", "Central", "term2"),
    ]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "cu", ["term2"])
    groups = {r["group"] for r in out}
    assert groups == {"NAKAWA", "MPIGI"}


def test_compute_region_dimension_groups_cus_by_region(monkeypatch):
    rows = [
        _row("Nakawa", "Kampala", "term2"),
        _row("Kawempe", "Kampala", "term2"),
        _row("Mpigi", "Central", "term2"),
    ]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "region", ["term2"])
    groups = {r["group"] for r in out}
    assert groups == {"Kampala", "Central"}


def test_compute_filter_names_restricts_to_named_cu(monkeypatch):
    rows = [
        _row("Nakawa", "Kampala", "term2"),
        _row("Mpigi", "Central", "term2"),
    ]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "cu", ["term2"], filter_names=["nakawa"])
    assert len(out) == 1
    assert out[0]["group"] == "NAKAWA"


def test_compute_skips_group_term_with_no_row_instead_of_reporting_zero(monkeypatch):
    # This CU has no term3 row at all — asking about term3 should omit it,
    # not report a fabricated 0% (a null means "not reported", not zero).
    rows = [_row("Nakawa", "Kampala", "term1"), _row("Nakawa", "Kampala", "term2")]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "cu", ["term3"])
    assert out == []


def test_compute_retention_sources_activation_base_from_term1_not_the_asked_term(monkeypatch):
    # The exact live bug this module exists to prevent: term2's OWN lec2_scholars
    # is a near-zero stray value (LEC2 is a T1 event), while term1's is the real
    # activation base. Retention must divide term2's lec14_scholars by TERM1's
    # lec2_scholars, never term2's own near-zero copy of that field.
    rows = [
        _row("Nakawa", "Kampala", "term1", lec2_scholars=100),
        _row("Nakawa", "Kampala", "term2", lec2_scholars=3, lec14_scholars=90, schools_with_lec14=10, total_target_schools=10),
    ]
    monkeypatch.setattr(metrics, "fetch_cu_rows", lambda user: rows)

    out = metrics.compute(_national_user(), "cu", ["term2"])
    assert len(out) == 1
    # 90 / 100 (term1's base), not 90 / 3 (which would be a >1000% impossibility).
    assert out[0]["retention_pct"] == 90.0
