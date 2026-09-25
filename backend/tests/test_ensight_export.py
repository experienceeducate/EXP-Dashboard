"""E!nsight export: the pure text-processing helpers, and a build() smoke test.

The LLM expansion call and BigQuery re-run are monkeypatched — this doesn't
verify real PowerPoint/Word rendering fidelity, just that build() produces a
well-formed file (both formats are zip containers, so a `PK` magic-number
check plus a filename/media-type check is a meaningful smoke test) from
re-derived (not client-trusted) evidence.
"""
import pytest

from app.core import ensight_export as export
from app.core.access import UserAccess
from app.core.ensight_guardrails import GuardrailResult

SAMPLE_ANSWER = (
    "**Key finding** Mpigi had the lowest LEC delivery rate at 42%, against a "
    "national average of 78%.\n\n"
    "**Insight** Mpigi's rate lags because three of its five schools have no "
    "LEC6 delivery at all.\n\n"
    "**Conclusion** Mpigi is off track for Term 2.\n\n"
    "**Recommendation** Prioritise a mentor check-in with Mpigi's three "
    "undelivered schools this week."
)


def test_sections_splits_the_four_labels():
    sections = export._sections(SAMPLE_ANSWER)
    labels = [lbl for lbl, _ in sections]
    assert labels == ["Key finding", "Insight", "Conclusion", "Recommendation"]


def test_sections_falls_back_to_one_block_for_unlabelled_text():
    sections = export._sections("I couldn't build a safe answer for that.")
    assert sections == [("", "I couldn't build a safe answer for that.")]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Mpigi is off track for Term 2.", export._RED),
        ("Mpigi is on track for Term 2.", export._GREEN),
        ("It's too early to tell.", export._YELLOW),
        ("Some other neutral statement.", export._NAVY),
    ],
)
def test_rag_colour_matches_the_stated_verdict(text, expected):
    assert export._rag(text) == expected


def test_strip_md_removes_bold_and_unescapes_backslashes():
    assert export._strip_md("**bold** and `code` and acquired\\_at\\_site") == "bold and code and acquired_at_site"


def test_table_block_extracts_rows_from_a_markdown_table():
    text = "Some prose.\n\n| cu | rate |\n| --- | --- |\n| Mpigi | 42% |\n| Kabale | 81% |"
    prose, rows = export._table_block(text)
    assert prose == "Some prose."
    assert rows == [["cu", "rate"], ["Mpigi", "42%"], ["Kabale", "81%"]]


def _user():
    return UserAccess(email="admin@experienceeducate.org", has_national=True)


def test_build_pptx_produces_a_valid_zip_container(monkeypatch):
    monkeypatch.setattr(export, "call_endpoint", lambda app, path, args, user: {"status": "ok", "data": []})
    monkeypatch.setattr(
        export.ensight_guardrails, "run_guarded", lambda sql: (GuardrailResult(True, dry_run_bytes=10), [{"cu": "Mpigi", "rate": 42}])
    )
    monkeypatch.setattr(export, "chat_text", lambda *a, **k: SAMPLE_ANSWER)

    items = [{
        "question": "Which CU had the lowest LEC delivery rate?",
        "answer": SAMPLE_ANSWER,
        "sources": [{"kind": "sql", "sql": "SELECT cu, rate FROM x"}],
        "notes": ["The dashboard endpoints didn't cover this — queried the warehouse directly instead."],
    }]

    data, filename, media_type = export.build(items, "pptx", _user(), app=None, generated_on="2026-09-23")
    assert data[:2] == b"PK"  # .pptx is a zip container
    assert filename == "E!nsight-Report-2026-09-23.pptx"
    assert media_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def test_build_docx_produces_a_valid_zip_container(monkeypatch):
    monkeypatch.setattr(export, "call_endpoint", lambda app, path, args, user: {"status": "ok"})
    monkeypatch.setattr(export.ensight_guardrails, "run_guarded", lambda sql: (GuardrailResult(True, dry_run_bytes=5), [{"n": 1}]))
    monkeypatch.setattr(export, "chat_text", lambda *a, **k: SAMPLE_ANSWER)

    items = [{"question": "How many mentors never logged in?", "answer": SAMPLE_ANSWER, "sources": [], "notes": []}]
    data, filename, media_type = export.build(items, "docx", _user(), app=None, generated_on="2026-09-23")
    assert data[:2] == b"PK"
    assert filename == "E!nsight-Report-2026-09-23.docx"
    assert media_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_expand_falls_back_to_concise_answer_on_llm_error(monkeypatch):
    from app.core.ensight_llm import EnsightLLMError

    def raise_error(*a, **k):
        raise EnsightLLMError("boom")

    monkeypatch.setattr(export, "chat_text", raise_error)
    result = export._expand({"answer": "concise answer"}, "some evidence")
    assert result == "concise answer"


def test_expand_skips_the_model_call_with_no_evidence(monkeypatch):
    monkeypatch.setattr(export, "chat_text", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called")))
    result = export._expand({"answer": "concise answer"}, "")
    assert result == "concise answer"
