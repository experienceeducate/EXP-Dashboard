"""The four-step E!nsight pipeline: plan -> (dashboard | sql) -> guardrails -> answer.

Orchestrates ``ensight_llm``/``ensight_calling``/``ensight_guardrails`` against
the catalog in ``ensight_catalog``. Deliberately synchronous and stateless (no
job store) to keep the single-process invariant (docs/CONTEXT.md) — the
request carries its own follow-up history instead. See docs/ENSIGHT.md for
the full design this implements.

The answer is only half the point: every result also carries ``sources``
(which endpoints were called, or the SQL that ran), ``rows`` (the evidence
behind a warehouse answer), and ``notes`` (anything that went sideways on the
way, like an escalation from dashboard to SQL) — a number with no visible
origin is exactly the thing the reader shouldn't have to trust blind.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from cachetools import TTLCache

from app.core import database, ensight_guardrails
from app.core.access import UserAccess
from app.core.config import settings
from app.core.ensight_calling import EndpointCallError, call_endpoint
from app.core.ensight_catalog import EXTRA_TABLES_TEXT, TABLE_CARDS, catalog_prompt_text
from app.core.ensight_llm import EnsightLLMError, chat_json
from app.core import ensight_metrics
from app.core.sql import VALID_TERMS

logger = logging.getLogger(__name__)

# Full table notes handed to both the planner (so it knows these tables are
# reachable and doesn't wrongly refuse) and the SQL writer (so it can name
# them). See ensight_catalog.EXTRA_TABLES_TEXT for why this is a static
# snapshot rather than a live per-request schema fetch.
ALL_TABLE_NOTES = TABLE_CARDS + "\n\n" + EXTRA_TABLES_TEXT

_MAX_CALLS = 3
_JSON_ROWS_LIMIT = 200  # rows handed to the model AND to the browser — keeps both bounded

# Rows kept from any one list inside a fetched *dashboard endpoint* payload,
# before it goes in a prompt. EXP's tables are wide (~158 columns on the gold
# model) — a naive character-length cut lands mid-row, handing the model
# malformed JSON it then has to puzzle over (slow, and prone to the very
# truncation this is fixing). Cutting the row COUNT first, with an explicit
# "N more rows not shown" marker, keeps what's sent well-formed and honest
# about what was cut. Well under EBA's equivalent (40) because EXP's rows are
# roughly an order of magnitude wider.
_MAX_LIST_ITEMS = 12
_MAX_EVIDENCE_CHARS = 9000  # per endpoint payload, after shrinking — a rare last-resort net
_MAX_SQL_EVIDENCE_CHARS = 15000  # SQL rows are a purpose-built, usually-narrow result set

# Per-user sliding-window rate limit. In-memory, like query_cache — fine under
# the single-process invariant, resets on pod restart same as everything else.
RATE_LIMIT_PER_MINUTE = 6
RATE_LIMIT_PER_HOUR = 40

_answer_cache: TTLCache = TTLCache(maxsize=256, ttl=settings.CACHE_TTL_SECONDS)
_rate_state: dict[str, list[float]] = {}

_ANSWER_FORMAT = (
    "Answer in exactly four labelled sections, in this order:\n"
    "Key finding: the number, with its denominator named.\n"
    "Insight: an actual finding — a real driver or a real comparison, stated "
    "in numbers from the rows you have. Never spend this section describing "
    "what data is missing, what a better query would need, or that this is "
    "a warehouse query one step from the screen — those are caveats, not "
    "insight, and belong (at most one line) at the very end, after "
    "Recommendation, only if still needed. If the rows genuinely give you "
    "only one bare number with nothing to compare it to, use Insight to say "
    "what that number means in scale (how many CUs/schools/sessions it "
    "covers, whether it's plausible) — not to apologise for the row count.\n"
    "Conclusion: one sentence of judgement.\n"
    "Recommendation: what to change (no owner, no deadline).\n\n"
    "Only speak in terms that exist in this programme's data — CU, region, "
    "school, mentor, scholar, term. Never invent a breakdown dimension that "
    "isn't an actual column in the rows or table notes you were given (no "
    "\"subject\", \"instructor\", \"section\", \"grade\", \"classroom\", "
    "\"tutorial\", \"lab\", or any other generic-school concept — this is a "
    "mentoring programme, not a school timetable).\n\n"
    'Mark your evidence: say "the data shows X" only when a column '
    'demonstrates it; otherwise say "likely driven by X, which this data '
    'cannot confirm". A null means "not reported", not zero. An implausible '
    "value (a rate over 100%, a placeholder name) is the finding itself, not "
    "the basis of one. Never invent a number that isn't in the data you were "
    "given.\n\n"
    "Be concise. For a ranking/extreme question (\"which CU is lowest\"), name "
    "the answer plus at most 4-5 comparators — never enumerate every row. Any "
    "table you include has at most 8 rows. The whole answer fits comfortably "
    "in a few short paragraphs; a long answer is a sign you're listing data "
    "instead of answering the question."
)


class RateLimitError(Exception):
    pass


@dataclass
class AskResult:
    answer: str
    route: str  # "dashboard" | "sql" | "refuse" — always the true origin, even on a cache hit
    cached: bool
    sources: list[dict] = field(default_factory=list)
    rows: list[dict] | None = None  # the sql route's evidence rows (capped), else None
    row_count: int | None = None  # true row count, may exceed len(rows) if capped
    notes: list[str] = field(default_factory=list)
    cached_minutes_ago: int | None = None


def check_rate_limit(email: str) -> None:
    """Per-user sliding-window limit, shared by /ask and /export (an export is
    slower and spends more model calls than a single question, but the same
    per-user budget applies)."""
    now = time.time()
    hits = [t for t in _rate_state.get(email, []) if now - t < 3600]
    if sum(1 for t in hits if now - t < 60) >= RATE_LIMIT_PER_MINUTE:
        raise RateLimitError(f"More than {RATE_LIMIT_PER_MINUTE} questions in a minute — please wait a moment.")
    if len(hits) >= RATE_LIMIT_PER_HOUR:
        raise RateLimitError(f"More than {RATE_LIMIT_PER_HOUR} questions in an hour — please try again later.")
    hits.append(now)
    _rate_state[email] = hits


def _cache_key(question: str, user: UserAccess, filters: dict) -> tuple:
    norm_q = " ".join(question.strip().lower().split())
    return (norm_q, user.scope_key, tuple(sorted((filters or {}).items())))


def _shrink(value):
    """Trim a payload to something worth spending prompt tokens on.

    Endpoint payloads carry long per-CU/per-school row arrays; the head of
    each is plenty for narrating a total or spotting the extremes. The cut is
    marked so the model is told a list was trimmed, rather than silently
    handed a partial one it might mistake for the whole thing.
    """
    if isinstance(value, dict):
        return {k: _shrink(v) for k, v in value.items()}
    if isinstance(value, list):
        kept = [_shrink(v) for v in value[:_MAX_LIST_ITEMS]]
        if len(value) > _MAX_LIST_ITEMS:
            kept.append(f"...{len(value) - _MAX_LIST_ITEMS} more rows not shown")
        return kept
    return value


def _capped_json(obj, max_chars: int) -> str:
    """A JSON string, safety-capped by length. Only a last resort by the time
    this runs on already-shrunk data — but if it still fires, it says so
    rather than landing mid-token."""
    text = json.dumps(obj, default=str, ensure_ascii=False)
    if len(text) > max_chars:
        text = text[:max_chars] + " ...(truncated)"
    return text


def _evidence_for_endpoints(fetched: dict) -> str:
    """One evidence block per called endpoint, each shrunk and capped on its
    own — so one wide payload can't starve another call's share of the prompt."""
    return "\n\n".join(f"{path}:\n{_capped_json(_shrink(payload), _MAX_EVIDENCE_CHARS)}" for path, payload in fetched.items())


# The fixed 2026 programme calendar (also documented in TABLE_CARDS for the
# LEC observation table's date-derived term). Resolving "last term"/"this
# term" here — rather than leaving it as natural language for the model to
# guess at — is what catches a question like "which CU had the lowest LEC
# delivery rate last term" actually meaning a concrete, single term; left
# vague, a generated query has aggregated across every term row for a CU
# instead (silently multiply-counting total_target_schools — the exact
# failure TABLE_CARDS warns about, just not forcefully enough on its own).
_TERM_CALENDAR_2026 = (
    ("term1", date(2026, 2, 1), date(2026, 5, 1)),
    ("term2", date(2026, 5, 25), date(2026, 8, 21)),
    ("term3", date(2026, 9, 14), date(2026, 12, 4)),
)


def _current_and_last_term(today: date | None = None) -> tuple[str | None, str | None]:
    """The programme term `today` falls in, and the one before it.

    Between terms (a gap in the calendar), the most recently CONCLUDED term
    counts as "current" for this purpose — "last term" from a gap should
    still mean the term before that one, not silently return nothing.
    """
    today = today or datetime.now(timezone.utc).date()
    order = [t for t, _, _ in _TERM_CALENDAR_2026]
    current = next((t for t, start, end in _TERM_CALENDAR_2026 if start <= today <= end), None)
    if current is None:
        concluded = [t for t, _, end in _TERM_CALENDAR_2026 if end < today]
        current = concluded[-1] if concluded else None
    if current is None:
        return None, None
    idx = order.index(current)
    return current, (order[idx - 1] if idx > 0 else None)


def _filters_line(filters: dict) -> str:
    term = (filters or {}).get("term") or "all"
    line = f"Active dashboard filter: term={term}. Use this term when the question doesn't name one."
    current, last = _current_and_last_term()
    if current:
        line += f' Today maps to {current} on the fixed 2026 calendar, so "this/current term" means {current}'
        line += f' and "last/previous term" means {last}.' if last else "."
    return line


def _history_and_question(history: list[dict], question: str, context_line: str) -> str:
    lines = [context_line]
    for h in (history or [])[-6:]:
        lines.append(f"{h.get('role', 'user')}: {h.get('content', '')}")
    lines.append(f"user: {question}")
    return "\n".join(lines)


_HEADLINE_METRICS = (
    "LEC delivery rate, retention rate, recruitment rate, passbook quality "
    "rate, mentor coverage rate"
)


def _plan_system(catalog_text: str, tables: str) -> str:
    return (
        "You are the planning step of E!nsight, a Q&A assistant over the EXP "
        "programme dashboard. Given a question, a catalog of read-only "
        "dashboard endpoints, and the warehouse tables a fallback query could "
        "reach, decide how to answer it.\n\n"
        "Respond with a single JSON object, one of:\n"
        '{"route": "dashboard", "calls": [{"path": "...", "params": {...}}]}\n'
        '{"route": "metric"}\n'
        '{"route": "sql"}\n'
        '{"route": "refuse", "refusal_reason": "..."}\n\n'
        '"calls" is at most 3 entries, each "path" an exact endpoint path from '
        "the catalog below and \"params\" the query params it needs.\n\n"
        'Use "dashboard" whenever one or more of these endpoints can answer '
        "the question — their code already encodes every correction this "
        "team has made (which level to filter, which term's rows a rate "
        'reads, which denominator), so an endpoint-sourced answer is '
        'preferred over a generated query.\n\n'
        f'Use "metric" whenever the question is about one or more of E!nsight\'s '
        f"five headline metrics — {_HEADLINE_METRICS} — for a CU, region, or "
        "the whole programme, in any phrasing (including a vague word like "
        "\"performance\" or \"doing well\" attached to an in-domain entity: "
        "CU, region, mentor, school). Prefer this over \"sql\" whenever it "
        "applies: these five are computed by tested Python code reusing the "
        "exact formulas the weekly digest already runs in production, not by "
        "a freehand-written query, so they can't get the arithmetic wrong the "
        "way a generated query has before. A later step picks which "
        "metric(s), which term(s), and which dimension (cu/region/national) "
        "— you only need to recognise the question is one of these five.\n\n"
        'Use "sql" whenever the question is about data described in the '
        "table notes below that ISN'T one of the five headline metrics, even "
        "if no endpoint covers it — a later step writes that query, you only "
        'need to decide it\'s reachable. Use "refuse" ONLY for a question '
        "that isn't about EXP programme data at all (weather, sports, "
        "general trivia), or that would require writing to the warehouse "
        "(never possible here) — never refuse just because no endpoint "
        "covers it, and never refuse a vague-but-in-domain metric word "
        "instead of routing it to \"metric\" above. When you do refuse for "
        "an unrecognised term, word it honestly: you only know about the "
        "endpoints and tables listed below, a small vetted slice of a much "
        "larger warehouse — say the term \"isn't part of what E!nsight "
        "currently has access to\", never that it \"doesn't exist\" or "
        "\"doesn't correspond to anything in the dashboard/warehouse\", "
        "which claims a certainty about the full warehouse you don't have.\n\n"
        f"Endpoints:\n{catalog_text}\n\n"
        f"Tables a \"sql\" query could reach:\n{tables}\n\n"
        f"Known terms: {', '.join(sorted(VALID_TERMS))}."
    )


_DASHBOARD_ANSWER_SYSTEM = (
    "You are E!nsight, answering a question from EXP programme dashboard "
    'data already fetched from the app\'s own endpoints (label this "from '
    'the dashboard" — it agrees with the screen by construction).\n\n'
    "First decide: is the data below SUFFICIENT to answer the question well? "
    "Mark it NOT sufficient — {\"sufficient\": false, \"reason\": \"...\"} — "
    "if answering reliably means ranking, averaging, or comparing more rows "
    "than you can actually see and check below (a bare data dump may have "
    "been cut off before every row was included); a generated SQL query can "
    "compute that aggregation exactly instead of you estimating it from a "
    "partial list. Respond with a single JSON object, one of:\n"
    '{"sufficient": true, "answer": "<the four-section answer>"}\n'
    '{"sufficient": false, "reason": "..."}\n\n'
    "If sufficient, format \"answer\" as follows:\n" + _ANSWER_FORMAT
)


def _sql_system(datasets: str, repair_of: str | None = None, repair_error: str | None = None) -> str:
    base = (
        "You write one read-only BigQuery SELECT/WITH query to answer a "
        "question the dashboard's own endpoints could not. Rules, all "
        "enforced mechanically after you answer — a violation fails the "
        "query, so follow them exactly:\n"
        f"- Only tables inside these datasets, fully-qualified and backtick-"
        f"quoted as `project.dataset.table`: {datasets}. Pick the exact "
        "table name from the table notes below — never invent one.\n"
        "- SELECT/WITH only — no comments, no second statement, no SELECT *.\n"
        "- Never return a raw personal-data column (any person's name, ID, "
        "phone, email, contact, or GPS coordinate — not just mentor_id/"
        "mentor_name/phone/email, the table notes below list far more of "
        "these across the newly-opened tables) as an output column — "
        "aggregate or COUNT(DISTINCT ...) it instead.\n"
        "- Name every output column with an explicit alias.\n\n"
        "Correctness rule not caught by any mechanical check, so get it right "
        "yourself: gold_exp is one row per (cu, term). Any query against it "
        "MUST filter to a single concrete term (WHERE term = 'termN') unless "
        "the question explicitly asks to compare across terms — aggregating "
        "a CU-level field (e.g. total_target_schools) without a term filter "
        "sums it once per term row that CU has, silently inflating every "
        "denominator by however many terms exist. Resolve \"last term\"/"
        "\"this term\" from the active-filter line in the question below; "
        "never leave gold_exp unfiltered by term to sidestep resolving it.\n\n"
        "Two more, just as easy to get wrong silently: (1) Any numeric column "
        "on these tables can be NULL for a given row, not just zero. Adding "
        "two columns with a bare `+` (e.g. `col_a + col_b`) propagates that "
        "NULL through the whole expression, silently dropping the row from "
        "everything downstream (a SUM, a rate, a ranking) with no error and "
        "no visible sign anything was dropped. Wrap every addend in "
        "COALESCE(col, 0) before adding it to another column, or sum each "
        "column separately and add the sums (SUM(col_a) + SUM(col_b), not "
        "SUM(col_a + col_b)). (2) For a ranking/extreme question (\"which CU "
        "is lowest/highest\"), return EVERY row's computed value, ordered — "
        "never ORDER BY ... LIMIT 1. A single collapsed row can't be sanity-"
        "checked against its peers and hides exactly the kind of computation "
        "bug rule (1) describes; the row-count cap downstream already keeps "
        "the result bounded, and the next step picks the extreme from what "
        "you return. (3) Don't collapse a metric to one bare national number "
        "unless the question is explicitly and only about that one overall "
        "figure. A single row gives the step that writes the final answer "
        "nothing to compare, so it ends up describing the missing context "
        "instead of giving an insight. Default to breaking the metric down "
        "by CU (or by term, for a question about change over time) so real "
        "comparators exist — GROUP BY the natural dimension already on the "
        "table rather than aggregating it away. (4) If the question names a "
        "vague metric (\"performance\", \"doing well\") instead of one from "
        "the table notes, don't refuse or guess silently — write the query "
        "against LEC delivery rate (the programme's primary delivery "
        "metric) and output an extra column making the substitution "
        "explicit (e.g. alias the rate column `performance_as_lec_delivery_"
        "rate_pct`) so the answer step can say plainly which metric it used "
        "in place of the vague one. (5) Before you finish, sanity-check your "
        "own query against the shape of the result it implies: a bounded "
        "percentage metric (delivery, retention, quality, coverage) landing "
        "over ~100% or a ratio's denominator looking implausibly small next "
        "to a large numerator is almost never a real finding — it means two "
        "columns that don't belong to the same row (or the same term) got "
        "divided against each other. gold_exp mixes fields that are only "
        "ever populated on ONE specific term's row (recruitment, retention's "
        "activation base — see the table notes) with fields scoped to "
        "whichever term you filtered to; a single `WHERE term = 'termN'` "
        "silently pairs a real value with a near-zero stray one from the "
        "wrong term unless you explicitly source each field from the right "
        "term's row for that CU.\n\n"
        f"Table notes:\n{ALL_TABLE_NOTES}\n\n"
        'Respond with a single JSON object: {"sql": "<the query>"}'
    )
    if repair_of:
        base += f"\n\nYour previous query failed. Fix it.\nPrevious query:\n{repair_of}\n\nError:\n{repair_error}"
    return base


_ROWS_ANSWER_SYSTEM = (
    "You are E!nsight, answering a question from rows returned by a "
    'generated BigQuery query (label this "direct warehouse query" in your '
    "answer — it is one step further from the screen than a dashboard "
    "endpoint, so say so).\n\n" + _ANSWER_FORMAT + "\n\n"
    'Respond with a single JSON object: {"answer": "<the four-section answer>"}'
)


def _metric_system(context_line: str) -> str:
    return (
        "You are choosing HOW to compute one of E!nsight's five headline "
        f"metrics ({_HEADLINE_METRICS}) for the question below. You do NOT "
        "write any arithmetic or SQL — a later step (tested Python code "
        "reusing the weekly digest's validated formulas) does the actual "
        "computation. You only pick its shape.\n\n"
        "Respond with a single JSON object:\n"
        '{"dimension": "cu"|"region"|"national", "terms": ["term1", ...], '
        '"filter_names": ["..."]}\n\n'
        '"dimension": "cu" for a per-CU breakdown or ranking ("which CU is '
        'lowest", "compare CUs"), "region" for a per-region breakdown, '
        '"national" for one overall programme-wide figure. Default to '
        '"national" only when the question has no CU/region framing at all.\n'
        '"terms": which term(s) to compute. Usually exactly one, resolved '
        "from the active-filter line below. Include all three "
        "(term1, term2, term3) only when the question is explicitly about "
        "change/trend/comparison over time (\"how has X changed\", \"all "
        "terms\", \"term-on-term\", \"the funnel\").\n"
        '"filter_names": specific CU or region names the question names '
        'explicitly (e.g. "how is Nakawa doing" -> ["Nakawa"]). Empty means '
        "every CU/region — do not guess a name that isn't in the question.\n\n"
        f"{context_line}"
    )


_METRIC_ANSWER_SYSTEM = (
    "You are E!nsight, answering a question from metric rows already "
    'computed by validated Python code (label this "from a computed metric" '
    "in your answer, not \"warehouse query\" or \"SQL\" — no query was "
    "generated for this; the same tested formulas the weekly digest emails "
    "already use in production did the arithmetic) — each row has "
    "lec_delivery_pct, retention_pct, recruitment_pct, pb_quality_pct, "
    "mentor_coverage_pct and their underlying counts for one (group, term).\n"
    "\n" + _ANSWER_FORMAT + "\n\n"
    'Respond with a single JSON object: {"answer": "<the four-section answer>"}'
)


# JSON Schemas for each step's forced tool call (ensight_llm.chat_json).
_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "route": {"type": "string", "enum": ["dashboard", "metric", "sql", "refuse"]},
        "calls": {
            "type": "array",
            "maxItems": _MAX_CALLS,
            "items": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "params": {"type": "object"}},
                "required": ["path"],
            },
        },
        "refusal_reason": {"type": "string"},
    },
    "required": ["route"],
}

_DASHBOARD_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "sufficient": {"type": "boolean"},
        "answer": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["sufficient"],
}

_SQL_SCHEMA = {
    "type": "object",
    "properties": {"sql": {"type": "string"}},
    "required": ["sql"],
}

_METRIC_SCHEMA = {
    "type": "object",
    "properties": {
        "dimension": {"type": "string", "enum": ["cu", "region", "national"]},
        "terms": {
            "type": "array",
            "items": {"type": "string", "enum": sorted(VALID_TERMS)},
            "minItems": 1,
        },
        "filter_names": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["dimension", "terms"],
}

_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}


def _audit(user: UserAccess, question: str, route: str, sql: str | None, duration_s: float, cached: bool, error: str | None) -> None:
    row = {
        "question_id": str(uuid.uuid4()),
        "event_timestamp": datetime.now(timezone.utc).isoformat(),
        "user_email": user.email,
        "question": question,
        "route": route,
        "generated_sql": sql,
        "duration_ms": int(duration_s * 1000),
        "cached": cached,
        "error": error,
    }
    errors = database.insert_rows(settings.ensight_audit_table, [row])
    if errors:
        logger.warning("E!nsight audit log write failed (table may not exist yet): %s", errors)


def ask(
    app,
    user: UserAccess,
    question: str,
    history: list[dict],
    filters: dict,
    force_refresh: bool = False,
) -> AskResult:
    question = (question or "").strip()
    if not question:
        raise EnsightLLMError("Ask a question first.")

    check_rate_limit(user.email)

    # A follow-up ("and for last term?") means nothing without its history, so
    # it neither reads from nor writes to the cache — the question text alone
    # isn't what was actually asked.
    cacheable = not history
    key = _cache_key(question, user, filters)

    start = time.time()
    route = "refuse"
    sql_used: str | None = None
    error: str | None = None
    served_from_cache = False
    context_line = _filters_line(filters)

    def _finish(payload: dict) -> AskResult:
        """Single exit point, so every answer — including a refusal, which
        costs the same model call to reach as a real one — is cached alike."""
        if cacheable:
            _answer_cache[key] = {"payload": payload, "stored_at": time.time()}
        return AskResult(cached=False, **payload)

    try:
        if cacheable and not force_refresh and key in _answer_cache:
            served_from_cache = True
            hit = _answer_cache[key]
            route = hit["payload"]["route"]
            minutes_ago = int((time.time() - hit["stored_at"]) // 60)
            return AskResult(cached=True, cached_minutes_ago=minutes_ago, **hit["payload"])

        plan = chat_json(
            _plan_system(catalog_prompt_text(app), ALL_TABLE_NOTES),
            _history_and_question(history, question, context_line),
            schema=_PLAN_SCHEMA,
        )
        route = plan.get("route", "refuse")

        if route == "refuse":
            reason = plan.get("refusal_reason") or "not a question about EXP programme data."
            answer = f"I couldn't build a safe answer for that: {reason}"
            return _finish({"answer": answer, "route": "refuse", "sources": [], "rows": None, "row_count": None, "notes": []})

        notes: list[str] = []

        if route == "metric":
            metric_plan = chat_json(
                _metric_system(context_line),
                f"{context_line}\n\n{question}",
                schema=_METRIC_SCHEMA,
                max_tokens=500,
            )
            dimension = metric_plan.get("dimension") or "national"
            terms = metric_plan.get("terms") or [_current_and_last_term()[0] or "term1"]
            filter_names = metric_plan.get("filter_names") or []
            metric_rows = ensight_metrics.compute(user, dimension, terms, filter_names)

            step4 = chat_json(
                _METRIC_ANSWER_SYSTEM,
                f"Question: {question}\n\nRows:\n{_capped_json(metric_rows[:_JSON_ROWS_LIMIT], _MAX_SQL_EVIDENCE_CHARS)}",
                schema=_ANSWER_SCHEMA,
                max_tokens=1500,
            )
            source = {
                "kind": "metric", "dimension": dimension, "terms": terms,
                "filter_names": filter_names, "row_count": len(metric_rows),
            }
            return _finish({
                "answer": step4["answer"], "route": "metric",
                "sources": [source], "rows": metric_rows[:_JSON_ROWS_LIMIT],
                "row_count": len(metric_rows), "notes": notes,
            })

        if route == "dashboard":
            calls = (plan.get("calls") or [])[:_MAX_CALLS]
            fetched = {}
            failed_paths = set()
            for c in calls:
                path = c.get("path")
                try:
                    fetched[path] = call_endpoint(app, path, c.get("params") or {}, user)
                except EndpointCallError as exc:
                    fetched[path] = {"error": str(exc)}
                    failed_paths.add(path)

            step2 = chat_json(
                _DASHBOARD_ANSWER_SYSTEM,
                f"Question: {question}\n\nFetched data:\n{_evidence_for_endpoints(fetched)}",
                schema=_DASHBOARD_ANSWER_SCHEMA,
                max_tokens=1500,
            )
            if step2.get("sufficient"):
                sources = [
                    {"kind": "endpoint", "path": c.get("path"), "params": c.get("params") or {}}
                    for c in calls
                    if c.get("path") not in failed_paths
                ]
                return _finish({
                    "answer": step2["answer"], "route": "dashboard",
                    "sources": sources, "rows": None, "row_count": None, "notes": notes,
                })
            # The dashboard was tried and came up short — this is the
            # escalation the SQL fallback exists for.
            missing = str(step2.get("reason") or "").strip()
            notes.append(
                "The dashboard endpoints didn't cover this"
                + (f" ({missing})" if missing else "")
                + " — queried the warehouse directly instead."
            )

        route = "sql"
        datasets = ", ".join(
            f"`{settings.BQ_PROJECT_ID}.{ds}`" for ds in sorted(ensight_guardrails.ALLOWED_DATASETS)
        )
        # A query against these tables can run to several CTEs (term-derivation
        # CASE expressions, fuzzy CU joins — see TABLE_CARDS) — 1000 tokens
        # (chat_json's default) is tight for that as JSON-escaped text.
        sql_plan = chat_json(_sql_system(datasets), f"{context_line}\n\n{question}", schema=_SQL_SCHEMA, max_tokens=1800)
        sql_used = sql_plan.get("sql", "")
        result, rows = ensight_guardrails.run_guarded(sql_used)

        if not result.ok:
            repair = chat_json(
                _sql_system(datasets, repair_of=sql_used, repair_error=result.reason),
                f"{context_line}\n\n{question}",
                schema=_SQL_SCHEMA,
                max_tokens=1800,
            )
            sql_used = repair.get("sql", "")
            result, rows = ensight_guardrails.run_guarded(sql_used)
            if result.ok:
                notes.append("The first draft query failed the safety checks and needed one repair before it ran.")

        if not result.ok:
            answer = f"I couldn't build a safe query for that ({result.reason})."
            error = result.reason
            return _finish({"answer": answer, "route": "sql", "sources": [], "rows": None, "row_count": None, "notes": notes})

        step4 = chat_json(
            _ROWS_ANSWER_SYSTEM,
            f"Question: {question}\n\nRows:\n{_capped_json(rows[:_JSON_ROWS_LIMIT], _MAX_SQL_EVIDENCE_CHARS)}",
            schema=_ANSWER_SCHEMA,
            max_tokens=1500,
        )
        source = {"kind": "sql", "sql": sql_used, "bytes_processed": result.dry_run_bytes, "row_count": len(rows)}
        return _finish({
            "answer": step4["answer"], "route": "sql",
            "sources": [source], "rows": rows[:_JSON_ROWS_LIMIT], "row_count": len(rows),
            "notes": notes,
        })

    except (EnsightLLMError, RateLimitError):
        raise
    except Exception as exc:  # noqa: BLE001 — never a raw 500 to the user
        logger.exception("E!nsight pipeline failed")
        error = str(exc)
        raise EnsightLLMError("Something went wrong answering that question.") from exc
    finally:
        _audit(user, question, route, sql_used, time.time() - start, cached=served_from_cache, error=error)
