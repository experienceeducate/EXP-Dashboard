"""E!nsight exports: turn selected answers into a PowerPoint deck or a Word report.

Two formats, two different jobs:

  * **.pptx** — what gets presented. The answer stays at its on-screen length,
    because a slide someone reads aloud from should be short. The expanded
    narrative goes in the **speaker notes**, where detail belongs.
  * **.docx** — what gets read and circulated. Here the expanded narrative is
    the body: a fuller Insight, the full evidence table, the query that
    produced it, and any caveats.

**Evidence is re-derived, never trusted from the client.** The browser sends
the questions and which sources each answer used — not the numbers. This
module re-calls the endpoints (``ensight_calling.call_endpoint``, which
re-runs under the caller's own access scope) and re-runs the SQL
(``ensight_guardrails.run_guarded``, which re-validates, dry-runs and
byte-caps it same as a live question). So a figure in an exported document
has passed the same guardrails as one on screen, and a tampered payload
cannot put invented numbers into an Educate!-branded document.

Styling follows Educate!'s house style (see the perfm-report-format-style
skill / `docs/DECISION.md`): Avenir headings, Century Gothic body, the E!
primary palette for text and the Graphics Variation for fills — the same
hex values as `frontend/src/lib/config.js`'s `TOKENS`/`RAG`.
"""
from __future__ import annotations

import io
import re
from datetime import date

from app.core import ensight_guardrails
from app.core.access import UserAccess
from app.core.ensight_calling import EndpointCallError, call_endpoint
from app.core.ensight_llm import EnsightLLMError, chat_text

# ─── Educate! house palette (frontend/src/lib/config.js::TOKENS/RAG) ───────────
_NAVY = (0x0E, 0x31, 0x3E)
_BLUE = (0x0F, 0x6A, 0x8C)
_GREY = (0x66, 0x66, 0x66)
_BLACK = (0x00, 0x00, 0x00)
_YELLOW = (0xF1, 0xA0, 0x1B)
_GREEN = (0x00, 0x81, 0x48)
_RED = (0x87, 0x01, 0x01)
_WHITE = (0xFF, 0xFF, 0xFF)

_HEADING_FONT = "Avenir"
_BODY_FONT = "Century Gothic"

_COVER_LABEL = "EXP PROGRAMME DASHBOARD"
_FOOTER = "EDUCATE! UGANDA • EXP PROGRAMME"

MAX_ITEMS = 10  # bounds both the model spend and the wait
MAX_TABLE_ROWS = 12  # per answer, in either format

# The four labels ensight_pipeline's answering prompts emit.
_SECTION_LABELS = ("Key finding", "Insight", "Conclusion", "Recommendation")


def _sections(answer: str) -> list[tuple[str, str]]:
    """Split an answer into its (label, body) pairs.

    Falls back to one unlabelled block: a refusal, or an answer that doesn't
    follow the four-label structure, still has to export rather than come out
    empty.
    """
    text = (answer or "").strip()
    pattern = r"\*\*(" + "|".join(re.escape(lbl) for lbl in _SECTION_LABELS) + r")\*\*\s*[—\-–:]*\s*"
    parts = re.split(pattern, text)
    if len(parts) < 3:
        return [("", text)]
    out = []
    # parts == [pre, label, body, label, body, ...]
    for i in range(1, len(parts) - 1, 2):
        out.append((parts[i].strip(), parts[i + 1].strip()))
    return out


def _rag(conclusion: str) -> tuple:
    """RAG colour for a Conclusion, by the verdict it states.

    Status only — per house style, these three colours must never be reused
    decoratively in the same document, so nothing else here is red/amber/green.
    """
    low = (conclusion or "").lower()
    if "off track" in low or "off-track" in low or "behind" in low:
        return _RED
    if "on track" in low or "on-track" in low:
        return _GREEN
    if "near" in low or "too early" in low or "early to tell" in low:
        return _YELLOW
    return _NAVY


def _strip_md(text: str) -> str:
    """Flatten inline markdown for a document run: no ** or backticks, and
    markdown's backslash escapes resolved (the model escapes underscores in
    column names, which would otherwise print literally)."""
    text = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|~])", r"\1", text or "")
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    return text.replace("`", "")


def _table_block(text: str) -> tuple[str, list[list[str]]]:
    """Pull a markdown table out of a section body.

    The model puts comparisons in tables, and a table rendered as
    pipe-delimited text in a Word document is unreadable. Returns
    (prose, rows).
    """
    lines = (text or "").split("\n")
    prose, rows = [], []
    for line in lines:
        if re.match(r"^\s*\|", line):
            if re.match(r"^\s*\|[\s:|\-]+\|\s*$", line):
                continue  # the --- separator row
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            rows.append([_strip_md(c) for c in cells])
        else:
            prose.append(line)
    return "\n".join(prose).strip(), rows


# ─── Evidence + expansion ───────────────────────────────────────────────────


def _as_text(payload) -> str:
    import json

    return json.dumps(payload, default=str, ensure_ascii=False)[:9000]


def _refetch(app, sources: list, user: UserAccess) -> tuple[str, dict | None]:
    """Re-derive an answer's evidence from its sources.

    Returns ``(evidence_text_for_the_prompt, table)`` where ``table`` is
    ``{"columns", "rows"}`` when the answer came from SQL. Failures are
    tolerated: a table or endpoint that's since gone missing should downgrade
    the write-up, not fail the whole export.
    """
    chunks: list[str] = []
    table: dict | None = None
    for source in sources or []:
        kind = (source or {}).get("kind")
        try:
            if kind == "endpoint":
                payload = call_endpoint(app, str(source.get("path") or ""), source.get("params") or {}, user)
                chunks.append(f"{source.get('path')}:\n{_as_text(payload)}")
            elif kind == "sql":
                sql = str(source.get("sql") or "")
                result, rows = ensight_guardrails.run_guarded(sql)
                if not result.ok:
                    chunks.append(f"(sql source could no longer be re-run: {result.reason})")
                    continue
                columns = list(rows[0].keys()) if rows else []
                table = {"columns": columns, "rows": rows}
                chunks.append(f"Query:\n{sql}\n\nRows ({len(rows)}):\n{_as_text(rows)}")
        except EndpointCallError as exc:
            chunks.append(f"(endpoint source could not be re-read: {exc})")
    return "\n\n".join(chunks), table


_EXPAND_SYSTEM = """You are expanding a short dashboard answer into the written version for an
Educate! report on the EXP programme. You are given the question, the concise
answer as it appeared on screen, and the evidence behind it.

Answer in exactly four labelled sections, in this order: Key finding,
Insight, Conclusion, Recommendation.

For this written version specifically:
- The Insight carries the weight. Two or three paragraphs: what the numbers
  show, how the segments compare, which differences are large enough to
  matter, and what the data cannot settle.
- Keep every figure and every conclusion from the concise answer. You are
  expanding it, not re-deciding it. If the concise answer called something a
  data-quality problem, so does this one.
- Introduce no number that is not in the evidence.
- Write continuous prose, not bullets, for Insight and Conclusion. Key
  finding may keep its table.
- No preamble. Start at **Key finding**."""


def _expand(item: dict, evidence: str) -> str:
    """One model call: the fuller write-up. Falls back to the concise answer —
    a failed expansion must not fail the download."""
    if not evidence.strip():
        return item.get("answer") or ""
    try:
        return chat_text(
            _EXPAND_SYSTEM,
            f"Question: {item.get('question')}\n\nConcise answer:\n{item.get('answer')}\n\nEvidence:\n{evidence}",
            temperature=0.2,
        )
    except EnsightLLMError:
        return item.get("answer") or ""


def _prepare(items: list, user: UserAccess, app) -> list[dict]:
    prepared = []
    for item in items[:MAX_ITEMS]:
        evidence, table = _refetch(app, item.get("sources") or [], user)
        answer = _expand(item, evidence)
        prepared.append({
            "question": item.get("question") or "",
            "answer": answer,
            "concise": item.get("answer") or "",
            "table": table,
            "sql": next((s.get("sql") for s in (item.get("sources") or []) if s.get("kind") == "sql"), None),
            "paths": [s.get("path") for s in (item.get("sources") or []) if s.get("kind") == "endpoint"],
            "notes": item.get("notes") or [],
        })
    return prepared


def _rows_from_table(table: dict | None) -> list[list[str]]:
    if not table or not table.get("rows"):
        return []
    columns = table["columns"]
    rows = [[c.replace("_", " ") for c in columns]]
    for row in table["rows"][:MAX_TABLE_ROWS]:
        rows.append(["" if row.get(c) is None else str(row.get(c)) for c in columns])
    return rows


# ─── PowerPoint ──────────────────────────────────────────────────────────────


def _build_pptx(prepared: list, generated_on: str) -> bytes:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]

    def textbox(slide, left, top, width, height):
        box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
        box.text_frame.word_wrap = True
        return box.text_frame

    def write(frame, text, size, colour, bold=False, font=_BODY_FONT, first=False):
        para = frame.paragraphs[0] if first else frame.add_paragraph()
        para.text = text
        para.font.size, para.font.bold = Pt(size), bold
        para.font.name = font
        para.font.color.rgb = RGBColor(*colour)
        para.space_after = Pt(8)
        return para

    # Cover: solid navy, white title, yellow small-caps label above it.
    cover = prs.slides.add_slide(blank)
    bg = cover.shapes.add_shape(1, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = RGBColor(*_NAVY)
    bg.line.fill.background()
    frame = textbox(cover, 0.9, 2.5, 11.5, 2.6)
    write(frame, _COVER_LABEL, 12, _YELLOW, bold=True, font=_HEADING_FONT, first=True)
    write(frame, "E!nsight Report", 38, _WHITE, bold=True, font=_HEADING_FONT)
    write(frame, f"Generated {generated_on} · {len(prepared)} question(s)", 13, _WHITE)

    for index, item in enumerate(prepared, start=1):
        slide = prs.slides.add_slide(blank)

        head = textbox(slide, 0.5, 0.35, 12.3, 0.9)
        write(head, _strip_md(item["question"]), 20, _NAVY, bold=True, font=_HEADING_FONT, first=True)

        body = textbox(slide, 0.5, 1.35, 12.3, 4.9)
        first = True
        table_rows: list[list[str]] = []
        for label, text in _sections(item["concise"]):
            prose, rows = _table_block(text)
            table_rows = table_rows or rows
            colour = _rag(prose) if label == "Conclusion" else _BLUE
            if label:
                write(body, label.upper(), 12, colour, bold=True, font=_HEADING_FONT, first=first)
                first = False
            para = write(body, _strip_md(prose), 12, _BLACK, first=first)
            para.space_after = Pt(12)
            first = False

        rows = table_rows or _rows_from_table(item["table"])
        if rows:
            _pptx_table(slide, rows)

        foot = textbox(slide, 0.5, 6.95, 8.0, 0.35)
        write(foot, _FOOTER, 9, _BLUE, bold=True, font=_HEADING_FONT, first=True)
        page = textbox(slide, 11.6, 6.95, 1.2, 0.35)
        write(page, str(index), 9, _GREY, first=True)

        # The detail lives here, not on the slide.
        notes = slide.notes_slide.notes_text_frame
        notes.text = _strip_md(item["answer"])
        if item["sql"]:
            notes.add_paragraph().text = f"\nQuery run:\n{item['sql']}"
        for note in item["notes"]:
            notes.add_paragraph().text = f"Note: {note}"

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _pptx_table(slide, rows):
    from pptx.dml.color import RGBColor
    from pptx.util import Inches, Pt

    rows = rows[: MAX_TABLE_ROWS + 1]
    cols = max(len(r) for r in rows)
    shape = slide.shapes.add_table(len(rows), cols, Inches(0.5), Inches(4.6), Inches(12.3), Inches(0.3 * len(rows)))
    table = shape.table
    for r, row in enumerate(rows):
        for c in range(cols):
            cell = table.cell(r, c)
            cell.text = row[c] if c < len(row) else ""
            para = cell.text_frame.paragraphs[0]
            para.font.size = Pt(10)
            para.font.name = _BODY_FONT
            if r == 0:
                para.font.bold = True
                para.font.color.rgb = RGBColor(*_WHITE)
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(*_NAVY)
            else:
                para.font.color.rgb = RGBColor(*_BLACK)


# ─── Word ────────────────────────────────────────────────────────────────────


def _build_docx(prepared: list, generated_on: str) -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = _BODY_FONT
    normal.font.size = Pt(11)

    def para(text, size=11, colour=_BLACK, bold=False, font=_BODY_FONT, space_after=8):
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.size, run.font.bold, run.font.name = Pt(size), bold, font
        run.font.color.rgb = RGBColor(*colour)
        p.paragraph_format.space_after = Pt(space_after)
        return p

    label = para(_COVER_LABEL, 12, _YELLOW, bold=True, font=_HEADING_FONT)
    label.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title = para("E!nsight Report", 34, _NAVY, bold=True, font=_HEADING_FONT, space_after=4)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub = para(f"Generated {generated_on} · {len(prepared)} question(s)", 12, _GREY)
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    provenance = para(
        "Every figure below was re-read from the dashboard's own endpoints or re-run "
        "against BigQuery when this report was generated. Answers are produced by "
        "E!nsight from that evidence.",
        10, _GREY,
    )
    provenance.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_page_break()

    for index, item in enumerate(prepared, start=1):
        para(f"{index}. {_strip_md(item['question'])}", 20, _NAVY, bold=True, font=_HEADING_FONT)

        for lbl, text in _sections(item["answer"]):
            prose, rows = _table_block(text)
            colour = _rag(prose) if lbl == "Conclusion" else _BLUE
            if lbl:
                para(lbl.upper(), 12, colour, bold=True, font=_HEADING_FONT, space_after=3)
            for chunk in [c for c in prose.split("\n") if c.strip()]:
                para(_strip_md(chunk), 11, _BLACK)
            if rows:
                _docx_table(doc, rows)

        rows = _rows_from_table(item["table"])
        if rows:
            para("Evidence", 12, _BLUE, bold=True, font=_HEADING_FONT, space_after=3)
            _docx_table(doc, rows)

        if item["paths"]:
            para("Source: " + ", ".join(item["paths"]), 9, _GREY)
        if item["sql"]:
            para("Query run", 12, _BLUE, bold=True, font=_HEADING_FONT, space_after=3)
            sql_para = para(item["sql"], 9, _GREY, font="Consolas")
            sql_para.paragraph_format.space_after = Pt(10)
        for note in item["notes"]:
            para(f"Note: {note}", 9, _GREY)

        if index < len(prepared):
            doc.add_page_break()

    section = doc.sections[0]
    footer = section.footer.paragraphs[0]
    run = footer.add_run(_FOOTER)
    run.font.size, run.font.bold, run.font.name = Pt(9), True, _HEADING_FONT
    run.font.color.rgb = RGBColor(*_BLUE)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _docx_table(doc, rows):
    from docx.shared import Pt, RGBColor

    rows = rows[: MAX_TABLE_ROWS + 1]
    cols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    for r, row in enumerate(rows):
        for c in range(cols):
            cell = table.cell(r, c)
            cell.text = row[c] if c < len(row) else ""
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(9.5)
                    run.font.name = _BODY_FONT
                    if r == 0:
                        run.font.bold = True
                        run.font.color.rgb = RGBColor(*_NAVY)
    doc.add_paragraph().paragraph_format.space_after = Pt(6)


# ─── Entry point ─────────────────────────────────────────────────────────────


def build(items: list, fmt: str, user: UserAccess, app, generated_on: str | None = None) -> tuple[bytes, str, str]:
    """Return ``(file bytes, filename, media type)`` for the selected answers.

    Always expands the narrative — a Word report reads it as the body; a deck
    keeps the on-screen wording on the slide and puts the expansion in the
    speaker notes.
    """
    generated_on = generated_on or date.today().isoformat()
    prepared = _prepare(items, user, app)

    if fmt == "docx":
        return (
            _build_docx(prepared, generated_on),
            f"E!nsight-Report-{generated_on}.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    return (
        _build_pptx(prepared, generated_on),
        f"E!nsight-Report-{generated_on}.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
