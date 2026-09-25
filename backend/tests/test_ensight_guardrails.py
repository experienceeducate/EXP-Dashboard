"""Static guardrail checks — the free, no-BigQuery-call layer.

Dry-run/execution (``dry_run``/``run_guarded``) need a live BigQuery client
and aren't covered here; ``check_static`` is the part that's pure logic and
must fail closed on its own.
"""
from app.core.ensight_guardrails import ALLOWED_TABLES, _is_pii_output_column, check_static

GOLD_MODEL = "`educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model`"


def test_valid_select_passes():
    r = check_static(f"SELECT cu, COUNT(*) AS n FROM {GOLD_MODEL} WHERE level = 'cu' GROUP BY cu")
    assert r.ok


def test_valid_with_cte_passes():
    r = check_static(f"WITH t AS (SELECT cu FROM {GOLD_MODEL} WHERE level = 'cu') SELECT cu FROM t")
    assert r.ok


def test_leading_comment_is_stripped_and_still_valid():
    sql = f"-- a note\nSELECT cu AS c FROM {GOLD_MODEL} WHERE level = 'cu'"
    assert check_static(sql).ok


def test_select_star_rejected():
    r = check_static(f"SELECT * FROM {GOLD_MODEL}")
    assert not r.ok
    assert "SELECT *" in r.reason


def test_second_statement_rejected():
    r = check_static(f"SELECT cu AS c FROM {GOLD_MODEL}; DROP TABLE foo")
    assert not r.ok
    assert "Multiple statements" in r.reason


def test_dml_rejected():
    r = check_static(f"DELETE FROM {GOLD_MODEL} WHERE level = 'cu'")
    assert not r.ok


def test_ddl_hidden_in_cte_rejected():
    r = check_static(f"WITH t AS (SELECT cu FROM {GOLD_MODEL}) DROP TABLE t")
    assert not r.ok


def test_table_outside_allowed_datasets_rejected():
    r = check_static("SELECT x AS c FROM `educate-data-warehouse-test.some_other.table`")
    assert not r.ok
    assert "allowed datasets" in r.reason


def test_table_outside_project_rejected_even_if_dataset_name_matches():
    r = check_static("SELECT x AS c FROM `some-other-project.gold_exp.table`")
    assert not r.ok
    assert "allowed datasets" in r.reason


def test_table_in_newly_opened_dataset_passes():
    # bronze_exp/silver_exp were never in the original five-table allowlist,
    # but the dataset-scoped check now covers all of gold_exp/silver_exp/bronze_exp.
    r = check_static(
        "SELECT mentor_id AS n FROM `educate-data-warehouse-test.bronze_exp."
        "raw_exp_elab_mentor_learning_progress_2026`"
    )
    assert r.ok


def test_no_table_reference_rejected():
    r = check_static("SELECT 1 AS one")
    assert not r.ok


def test_empty_query_rejected():
    assert not check_static("").ok
    assert not check_static("   ").ok
    assert not check_static("-- just a comment").ok


def test_allowed_tables_matches_the_five_known_sources():
    assert len(ALLOWED_TABLES) == 5
    assert "educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model" in ALLOWED_TABLES


# ── PII output-column gate — pattern-based, must hold across unsurveyed
# tables too (opened alongside gold_exp/silver_exp/bronze_exp, not just the
# five originally-vetted sources) ───────────────────────────────────────────

def test_person_name_columns_blocked():
    for col in ("mentor_name", "scholar_name", "recruiter_Name", "YlName", "MM_name", "foa_name", "surname", "othername", "full_name", "first_name"):
        assert _is_pii_output_column(col), col


def test_entity_name_columns_allowed():
    for col in ("school_name", "cu_name", "region_name", "term_name", "lesson_name", "instance_name"):
        assert not _is_pii_output_column(col), col


def test_contact_columns_blocked():
    for col in ("phone", "phone_number", "device_phone_num", "mentor_email", "scholar_primary_contact", "guardian_secondary_contact", "alt-phone"):
        assert _is_pii_output_column(col), col


def test_person_id_columns_blocked_but_entity_ids_allowed():
    assert _is_pii_output_column("mentor_id")
    assert _is_pii_output_column("scholar_id")
    assert not _is_pii_output_column("school_id")
    assert not _is_pii_output_column("cu_id")
    assert not _is_pii_output_column("term_id")


def test_geo_and_gov_id_columns_blocked():
    for col in ("latitude", "longitude", "activity_latitude", "national_id", "School_ID_number".lower()):
        assert _is_pii_output_column(col), col


def test_aggregate_alias_not_blocked():
    # COUNT(DISTINCT mentor_id) AS mentor_count — the alias is what the gate
    # sees, and a sensibly-named aggregate alias should never collide.
    assert not _is_pii_output_column("mentor_count")
    assert not _is_pii_output_column("total_scholars_recruited")
