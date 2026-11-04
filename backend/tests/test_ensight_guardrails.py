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
        # COUNT(DISTINCT ...) — a bare `mentor_id AS n` is now rejected as a
        # rename of a person ID (see test_pii_alias_*).
        "SELECT COUNT(DISTINCT mentor_id) AS n FROM `educate-data-warehouse-test.bronze_exp."
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


# ── Lexer-based validation: comment-in-string bypasses (security finding 1) ──
import pytest  # noqa: E402

from app.core import ensight_guardrails as guardrails  # noqa: E402

ROSTER = "`educate-data-warehouse-test.bronze_exp.mentor_2026`"
SKILLS = "`educate-data-warehouse-test.silver_exp.exp_2026_skills_day_observation_form`"


@pytest.mark.parametrize("sql", [
    # A '/*' inside a string used to open a "comment" for the regex stripper,
    # hiding the out-of-allowlist read between it and the closing '*/'.
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE '/*'='/*' UNION ALL SELECT x AS c "
    "FROM `educate-data-warehouse-test.other_ds.t` WHERE '*/'='*/'",
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE '/*'='/*'; DELETE FROM {GOLD_MODEL} WHERE '*/'='*/'",
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE '/*'='/*' UNION ALL SELECT x AS c FROM other_ds.t WHERE '*/'='*/'",
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE \"--\" = '--' UNION ALL SELECT x AS c FROM other_ds.t",
])
def test_comment_markers_inside_strings_cannot_hide_sql(sql):
    assert not check_static(sql).ok


@pytest.mark.parametrize("sql", [
    "SELECT cu AS c FROM `educate-data-warehouse-test`.`gold_exp`.`exp_ai_dashboard_model`",
    f"SELECT a.cu AS c FROM {GOLD_MODEL} a JOIN gold_exp.exp_ai_dashboard_model b ON a.cu = b.cu",
    f"SELECT a.cu AS c FROM {GOLD_MODEL} a, other_ds.t",
    f"SELECT a.cu AS c FROM {GOLD_MODEL} a JOIN `gold_exp.exp_ai_dashboard_model` b ON a.cu = b.cu",
    f"SELECT a.cu AS c FROM {GOLD_MODEL} a JOIN `x.educate-data-warehouse-test.gold_exp.t` b ON a.cu = b.cu",
])
def test_table_refs_must_be_one_backticked_three_part_name(sql):
    assert not check_static(sql).ok


@pytest.mark.parametrize("sql", [
    "SELECT column_name AS c FROM `educate-data-warehouse-test.gold_exp.INFORMATION_SCHEMA`",
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE cu IN (SELECT table_name FROM gold_exp.INFORMATION_SCHEMA.TABLES)",
    f"SELECT t.* FROM {GOLD_MODEL} t",
    f"SELECT DISTINCT * FROM {GOLD_MODEL}",
    f"SELECT cu, * EXCEPT (cu) FROM {GOLD_MODEL}",
    f"DECLARE x INT64; SELECT cu AS c FROM {GOLD_MODEL}",
    f"WITH t AS (SELECT cu FROM {GOLD_MODEL}) SELECT cu FROM t; SET x = 1",
    f"SELECT cu AS c FROM {GOLD_MODEL} |> WHERE cu = 'x'",
    f"(SELECT cu AS c FROM {GOLD_MODEL})",
    f"SELECT 'unterminated AS c FROM {GOLD_MODEL}",
    f"SELECT cu AS c FROM {GOLD_MODEL} /* unterminated",
])
def test_other_static_rejections(sql):
    assert not check_static(sql).ok


def test_single_trailing_semicolon_allowed():
    r = check_static(f"SELECT cu AS c FROM {GOLD_MODEL} WHERE EXISTS (SELECT 1 FROM {GOLD_MODEL}) ; ")
    assert r.ok, r.reason


def test_string_with_comment_markers_passes_and_normalizes():
    sql = (
        f"-- leading note\nSELECT cu AS c, '--' AS d, \"/* not a comment */\" AS e, '''it's # fine''' AS f,\n"
        f"  r'\\'' AS g FROM {GOLD_MODEL} # hash comment\nWHERE level = 'cu' /* block */;"
    )
    r = check_static(sql)
    assert r.ok, r.reason
    assert "leading note" not in r.sql
    assert "hash comment" not in r.sql
    assert "block" not in r.sql
    assert "'--' AS d" in r.sql and '"/* not a comment */"' in r.sql and "'''it's # fine'''" in r.sql
    assert not r.sql.rstrip().endswith(";")


@pytest.mark.parametrize("sql", [
    f"SELECT COUNT(DISTINCT mentor_id) AS mentors FROM {ROSTER}",
    # mentor_id as a join key and a pass-through CTE column (documented join to the roster).
    f"WITH r AS (SELECT mentor_id, COALESCE(cu, CU) AS cu FROM {ROSTER}) "
    f"SELECT r.cu AS cu, COUNT(*) AS n FROM {SKILLS} s JOIN r ON s.mentor_id = r.mentor_id GROUP BY r.cu",
    f"SELECT cu AS c FROM {GOLD_MODEL} WHERE cu IN (SELECT cu FROM {ROSTER} WHERE mentor_id IS NOT NULL)",
    f"SELECT cu AS c, COUNT(*) OVER (PARTITION BY mentor_id) AS n FROM {ROSTER}",
    f"SELECT EXTRACT(YEAR FROM date) AS y, COUNT(*) AS n FROM {SKILLS} GROUP BY y",
    f"SELECT x AS v, cu FROM {GOLD_MODEL}, UNNEST(GENERATE_ARRAY(1, 3)) AS x",
    f"SELECT s.cu AS cu FROM (SELECT cu FROM {GOLD_MODEL} WHERE level = 'cu') AS s",
])
def test_legitimate_queries_still_pass(sql):
    r = check_static(sql)
    assert r.ok, r.reason


# ── PII identifiers: aliasing no longer bypasses the gate (finding 3) ───────

@pytest.mark.parametrize("sql", [
    f"SELECT phone AS x FROM {ROSTER}",
    f"SELECT COUNT(DISTINCT email) AS n FROM {ROSTER}",
    f"SELECT r.`guardian_contact` AS g FROM {ROSTER} r",
    f"SELECT AVG(latitude) AS a FROM {SKILLS}",
    f"SELECT cu AS c FROM {ROSTER} WHERE date_of_birth IS NOT NULL",
    f"SELECT surname AS s FROM {ROSTER}",
    f"SELECT mentor_id AS x FROM {ROSTER}",
    f"SELECT mentor_id x FROM {ROSTER}",
    f"SELECT CONCAT(mentor_id, '') AS x FROM {ROSTER}",
    f"SELECT STRUCT(mentor_id AS m) AS s FROM {ROSTER}",
    f"SELECT (SELECT mentor_id FROM {ROSTER} LIMIT 1) AS x FROM {GOLD_MODEL}",
    f"SELECT mentor_name AS n FROM {ROSTER}",
    f"SELECT cu AS c FROM {GOLD_MODEL} UNION ALL SELECT scholar_id AS c FROM {ROSTER}",
    # A whole row as a value carries every column out under one name.
    f"WITH r AS (SELECT mentor_id, cu FROM {ROSTER}) SELECT TO_JSON_STRING(r) AS j FROM r",
    f"SELECT t AS row_value FROM {ROSTER} AS t",
])
def test_pii_alias_and_wrapping_rejected(sql):
    r = check_static(sql)
    assert not r.ok, sql


# ── Dry run / run_guarded with a fake BigQuery client (findings 1, 2, 8) ────

class _Field:
    def __init__(self, name, fields=()):
        self.name, self.fields = name, list(fields)


class _Ref:
    def __init__(self, ref):
        self.project, self.dataset_id, self.table_id = ref.split(".")


class _Job:
    def __init__(self, columns=("c",), refs=("educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model",),
                 statement_type="SELECT", bytes_=10, rows=(), schema=None, omit=()):
        self.schema = schema if schema is not None else [_Field(c) for c in columns]
        self.total_bytes_processed = bytes_
        if "statement_type" not in omit:
            self.statement_type = statement_type
        if "referenced_tables" not in omit:
            self.referenced_tables = [_Ref(r) for r in refs]
        self._rows = list(rows)

    def result(self):
        return self._rows


class _FakeClient:
    def __init__(self, job):
        self.job = job
        self.calls = []

    def query(self, sql, job_config=None):
        self.calls.append((sql, job_config))
        return self.job


@pytest.fixture
def fake_bq(monkeypatch):
    monkeypatch.delenv("ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY", raising=False)

    def install(job):
        client = _FakeClient(job)
        monkeypatch.setattr(guardrails.database, "get_client", lambda: client)
        return client

    return install


def test_run_guarded_executes_the_normalized_sql_not_the_original(fake_bq):
    client = fake_bq(_Job(columns=("c", "d"), rows=[{"c": "x", "d": "--"}]))
    original = f"/* hello */ SELECT cu AS c, '--' AS d FROM {GOLD_MODEL} -- bye\n;"
    result, rows = guardrails.run_guarded(original)
    assert result.ok, result.reason
    assert rows == [{"c": "x", "d": "--"}]
    sent = [sql for sql, _ in client.calls]
    assert len(sent) == 2  # dry run + execution
    assert sent[0] == sent[1] == result.sql
    assert "hello" not in result.sql and "bye" not in result.sql and "'--' AS d" in result.sql
    assert client.calls[0][1].dry_run is True
    assert client.calls[1][1].maximum_bytes_billed == guardrails.MAX_BYTES_BILLED


def test_run_guarded_never_reaches_bigquery_for_a_bypass(fake_bq):
    client = fake_bq(_Job())
    result, rows = guardrails.run_guarded(
        f"SELECT cu AS c FROM {GOLD_MODEL} WHERE '/*'='/*' UNION ALL SELECT x AS c "
        "FROM `educate-data-warehouse-test.other_ds.t` WHERE '*/'='*/'"
    )
    assert not result.ok and rows == []
    assert client.calls == []


def test_dry_run_rejects_non_select_statement_type(fake_bq):
    fake_bq(_Job(statement_type="INSERT"))
    r = guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert not r.ok and "SELECT" in r.reason


def test_dry_run_rejects_referenced_table_outside_allowlist(fake_bq):
    fake_bq(_Job(refs=("educate-data-warehouse-test.gold_exp.ok", "educate-data-warehouse-test.secret_ds.t")))
    r = guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert not r.ok and "secret_ds" in r.reason


def test_dry_run_rejects_other_project(fake_bq):
    fake_bq(_Job(refs=("other-project.gold_exp.t",)))
    assert not guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}").ok


def test_dry_run_fails_closed_without_referenced_tables(fake_bq):
    fake_bq(_Job(omit=("referenced_tables",)))
    assert not guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}").ok
    fake_bq(_Job(refs=()))
    assert not guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}").ok


def test_dry_run_tolerates_missing_statement_type_attribute(fake_bq):
    fake_bq(_Job(omit=("statement_type",)))
    assert guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}").ok


def test_dry_run_keeps_byte_budget(fake_bq):
    fake_bq(_Job(bytes_=guardrails.MAX_BYTES_BILLED + 1))
    r = guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert not r.ok and "budget" in r.reason


def test_dry_run_pii_gate_inspects_nested_fields(fake_bq):
    fake_bq(_Job(schema=[_Field("s", fields=[_Field("phone")])]))
    r = guardrails.dry_run(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert not r.ok and "phone" in r.reason


def test_dry_run_output_schema_gate_still_applies(fake_bq):
    fake_bq(_Job(columns=("mentor_id",)))
    assert not guardrails.dry_run(f"SELECT mentor_id FROM {ROSTER}").ok


# ── Optional read-only identity (finding 8) ──────────────────────────────────

def test_separate_service_account_used_when_configured(monkeypatch):
    job = _Job(rows=[{"c": 1}])
    ensight_client = _FakeClient(job)
    main_client = _FakeClient(job)
    built = []

    def fake_build(path):
        built.append(path)
        return ensight_client

    monkeypatch.setattr(guardrails, "_ensight_client", None)
    monkeypatch.setattr(guardrails, "_ensight_client_key", None)
    monkeypatch.setattr(guardrails, "_build_ensight_client", fake_build)
    monkeypatch.setattr(guardrails.database, "get_client", lambda: main_client)
    monkeypatch.setenv("ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY", "/secrets/ensight-ro.json")

    result, _ = guardrails.run_guarded(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert result.ok, result.reason
    guardrails.run_guarded(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert len(ensight_client.calls) == 4 and main_client.calls == []
    assert built == ["/secrets/ensight-ro.json"]  # built lazily, once


def test_main_client_used_when_not_configured(monkeypatch):
    main_client = _FakeClient(_Job())
    monkeypatch.delenv("ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY", raising=False)
    monkeypatch.setattr(guardrails.database, "get_client", lambda: main_client)
    monkeypatch.setattr(guardrails, "_build_ensight_client", lambda p: (_ for _ in ()).throw(AssertionError("built")))
    result, _ = guardrails.run_guarded(f"SELECT cu AS c FROM {GOLD_MODEL}")
    assert result.ok and len(main_client.calls) == 2
