"""Guardrails on E!nsight's generated SQL — security-critical.

Every check fails closed. Order matches docs/ENSIGHT.md's guardrails table:
each is cheaper than the next, so a free syntactic rejection never pays for a
dry run, and a dry run never pays for a real query.

Underneath all of it the service account has NO write access anywhere in the
warehouse (verified: every ``create_table`` attempt 403s — see
DATA_ENG_BIGQUERY_TABLES_REQUEST.md). These checks are not the security
boundary; they catch an honest mistake early and keep the audit log readable.
"""
from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass

from google.cloud import bigquery

from app.core import database
from app.core.config import settings
from app.core.tables import (
    DASHBOARD_MODEL,
    GROUP_MENTORING_OBSERVATIONS,
    MENTOR_OBSERVATIONS,
    MENTOR_ROSTER,
    SKILLS_DAY_OBSERVATIONS,
)

# The five sources originally surveyed for E!nsight (docs/ENSIGHT.md's Phase 0)
# — their table cards are hand-written and trustworthy, so the SQL prompt
# still steers the model toward these first. Bare (no backticks) so they
# compare directly against a parsed `a.b.c` reference.
ALLOWED_TABLES = {
    ref.strip("`")
    for ref in (
        DASHBOARD_MODEL,
        MENTOR_OBSERVATIONS,
        MENTOR_ROSTER,
        SKILLS_DAY_OBSERVATIONS,
        GROUP_MENTORING_OBSERVATIONS,
    )
}

# The three datasets E!nsight may read from — everything in gold_exp,
# silver_exp and bronze_exp, not just the five hand-surveyed tables above.
# This is deliberately dataset-scoped rather than an exact table list: the
# warehouse has ~140 tables across these three datasets (many gaining/dropping
# columns as live exports land — see TABLE_CARDS), and a per-table allowlist
# would either go stale or block legitimate tables no one had gotten around to
# adding yet. The PII output-schema gate below is what actually protects a
# question against an unsurveyed table's PII, not this list — this list only
# keeps the query inside the EXP programme's own project data.
ALLOWED_DATASETS = {"gold_exp", "silver_exp", "bronze_exp"}


def _table_in_allowed_dataset(table_ref: str) -> bool:
    """True if a bare `project.dataset.table` reference is both inside the
    warehouse project (never some other project the service account can
    reach) and inside one of the three allowed datasets."""
    parts = table_ref.split(".")
    if len(parts) != 3:
        return False
    project, dataset, _ = parts
    return project == settings.BQ_PROJECT_ID and dataset in ALLOWED_DATASETS


# Person-role prefixes seen across the warehouse's ~140 tables (mined from a
# live INFORMATION_SCHEMA survey of gold_exp/silver_exp/bronze_exp — naming is
# wildly inconsistent: "mentor_name", "YlName", "MM_name", "Recruiter_name",
# "foa_name", "staff_name", "scholar_name", "patron_first_name" all exist).
# Used to block `<role>_id` as a raw output column the same way `<role>_name`
# already is below — an opaque ID for a specific mentor/scholar/etc. is still
# a personal identifier, unlike `cu_id`/`school_id`/`term_id`/`lesson_id`.
_PERSON_ROLES = (
    "mentor", "scholar", "student", "guardian", "patron", "recruiter",
    "admin", "staff", "observer", "facilitator", "reporter", "teacher",
    "parent", "youth", "respondent", "informant", "foa", "mm", "headteacher",
    "recipient", "beneficiary", "participant", "user",
)

# Entity-name fields verified safe (they name a CU/school/term/etc., not a
# person) — exempted from the generic "contains 'name'" block below. Anything
# NOT on this short, deliberately reviewed list is blocked by default: with
# ~140 unsurveyed tables using "name" for everything from a lesson's title to
# a scholar's guardian, failing closed on an unrecognised "*name*" column is
# far safer than trying to enumerate every safe case. If a query's own source
# column is a safe variant not listed here (`school_name_other`,
# `correct_school_name`, a lookup table's bare `name`), alias it to one of
# these on the way out — the gate only inspects the final output alias.
_SAFE_NAME_COLUMNS = {
    "school_name", "cu_name", "region_name", "lesson_name", "term_name",
    "instance_name", "activity_type_name", "session_name",
}

_PII_PATTERNS = (
    re.compile(r"phone|contact|mobile|\btel\b", re.IGNORECASE),
    re.compile(r"email", re.IGNORECASE),
    re.compile(r"national_id|passport|\bnin\b|\bssn\b|id[_ ]?number", re.IGNORECASE),
    re.compile(r"\bdob\b|date_of_birth|birth_date", re.IGNORECASE),
    re.compile(r"latitude|longitude|\bgps\b|coordinat", re.IGNORECASE),
    re.compile(r"^(first|last|middle|given)_?name$|surname|othername|other_name|full_name|username", re.IGNORECASE),
    re.compile(r"(" + "|".join(_PERSON_ROLES) + r")_?id$", re.IGNORECASE),
)


def _is_pii_output_column(name: str) -> bool:
    lname = name.lower().strip()
    if "name" in lname and lname not in _SAFE_NAME_COLUMNS:
        return True
    return any(p.search(lname) for p in _PII_PATTERNS)


# Generous for aggregate queries over these tables; a runaway scan across the
# widest source (the gold model) still fails well under this.
MAX_BYTES_BILLED = 200 * 1024 * 1024


@dataclass
class GuardrailResult:
    ok: bool
    reason: str = ""
    dry_run_bytes: int = 0
    output_columns: list[str] | None = None
    # The comment-free, normalized SQL that check_static validated. run_guarded
    # dry-runs and executes exactly this string — never the caller's original
    # text — so what BigQuery runs is what the checks below actually looked at.
    sql: str | None = None


# ─── A small GoogleSQL lexer ─────────────────────────────────────────────────
# Validation runs on tokens, not on regexes over raw text: a regex that strips
# `/* ... */` or `--` without knowing about string literals can be steered by
# a literal like '/*' into hiding a whole clause (a second table, a second
# statement) from every check, while BigQuery happily runs the original text.
# The lexer below knows GoogleSQL's quoting rules, and the SQL that is
# dry-run/executed is rebuilt from what it saw (comments replaced by a space).


class SQLLexError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    kind: str  # "word" | "qid" (backticked) | "string" | "number" | "op"
    text: str  # source text (for "qid": the text between the backticks)

    @property
    def upper(self) -> str:
        return self.text.upper() if self.kind == "word" else ""

    @property
    def ident(self) -> str | None:
        """Identifier name for an unquoted word or a single-part backticked
        identifier; None for anything else (incl. a dotted backticked path)."""
        if self.kind == "word":
            return self.text
        if self.kind == "qid" and "." not in self.text:
            return self.text
        return None

    def is_op(self, text: str) -> bool:
        return self.kind == "op" and self.text == text


_WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NUMBER = re.compile(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
_STRING_PREFIXES = {"r", "b", "rb", "br"}
_TWO_CHAR_OPS = ("<=", ">=", "<>", "!=", "||", "<<", ">>", "@@", "=>", "|>")
_ONE_CHAR_OPS = set("()[],.;=<>+-*/%&|^~!?:@{}")


def _scan_quoted(sql: str, i: int, quote: str, allow_triple: bool) -> int:
    """Return the index just past the literal opening at ``sql[i]``.

    Backslash escapes the next character (GoogleSQL treats a backslash-quote
    as not terminating even a raw string — a raw string can't end in an odd
    number of backslashes). Single-quoted forms may not span lines.
    """
    n = len(sql)
    if allow_triple and sql.startswith(quote * 3, i):
        j = i + 3
        while j < n:
            if sql[j] == "\\":
                j += 2
                continue
            if sql.startswith(quote * 3, j):
                return j + 3
            j += 1
        raise SQLLexError("Unterminated triple-quoted string.")
    j = i + 1
    while j < n:
        ch = sql[j]
        if ch == "\\":
            j += 2
            continue
        if ch == quote:
            return j + 1
        if ch == "\n":
            raise SQLLexError("Newline inside a quoted literal.")
        j += 1
    raise SQLLexError("Unterminated quoted literal.")


def tokenize(sql: str) -> tuple[list[Token], str]:
    """Lex GoogleSQL. Returns ``(tokens, normalized_sql)`` where the
    normalized SQL is the input with every comment replaced by one space.

    Raises ``SQLLexError`` on anything it doesn't understand — fail closed.
    """
    tokens: list[Token] = []
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if c.isspace():
            out.append(c)
            i += 1
            continue
        if sql.startswith("--", i) or c == "#":
            j = sql.find("\n", i)
            i = n if j == -1 else j
            out.append(" ")
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            if j == -1:
                raise SQLLexError("Unterminated /* comment.")
            out.append(" ")
            i = j + 2
            continue
        if c in ("'", '"'):
            j = _scan_quoted(sql, i, c, allow_triple=True)
            tokens.append(Token("string", sql[i:j]))
            out.append(sql[i:j])
            i = j
            continue
        if c == "`":
            j = _scan_quoted(sql, i, "`", allow_triple=False)
            inner = sql[i + 1:j - 1]
            if not inner or "\\" in inner:
                raise SQLLexError("Empty or escaped backtick identifier.")
            tokens.append(Token("qid", inner))
            out.append(sql[i:j])
            i = j
            continue
        m = _WORD.match(sql, i)
        if m:
            word, j = m.group(), m.end()
            if word.lower() in _STRING_PREFIXES and j < n and sql[j] in ("'", '"'):
                k = _scan_quoted(sql, j, sql[j], allow_triple=True)
                tokens.append(Token("string", sql[i:k]))
                out.append(sql[i:k])
                i = k
                continue
            tokens.append(Token("word", word))
            out.append(word)
            i = j
            continue
        m = _NUMBER.match(sql, i)
        if m and m.end() > i:
            tokens.append(Token("number", m.group()))
            out.append(m.group())
            i = m.end()
            continue
        two = sql[i:i + 2]
        if two in _TWO_CHAR_OPS:
            tokens.append(Token("op", two))
            out.append(two)
            i += 2
            continue
        if c in _ONE_CHAR_OPS:
            tokens.append(Token("op", c))
            out.append(c)
            i += 1
            continue
        raise SQLLexError(f"Unexpected character {c!r}.")
    return tokens, "".join(out)


# ─── Token-level checks ──────────────────────────────────────────────────────

# Anything that writes, defines, or scripts. Matched only against unquoted
# words, so a string literal or a backticked column can't trip it.
_FORBIDDEN_KEYWORDS = {
    "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "DROP", "UNDROP", "ALTER",
    "TRUNCATE", "RENAME", "GRANT", "REVOKE", "EXPORT", "LOAD", "CALL", "EXECUTE",
    "IMMEDIATE", "DECLARE", "SET", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION",
    "ASSERT", "RAISE", "LOOP", "WHILE", "REPEAT", "LEAVE", "ITERATE", "BREAK",
    "CONTINUE", "RETURN", "EXTERNAL_QUERY",
}

# Words after which a following `*` is a column wildcard (SELECT *, t.*,
# SELECT DISTINCT *, SELECT AS STRUCT *, `a, *`), not multiplication/COUNT(*).
_STAR_AFTER_WORDS = {"SELECT", "DISTINCT", "ALL", "STRUCT", "VALUE"}

# Not a table alias when seen right after a FROM/JOIN target.
_NON_ALIAS_WORDS = {
    "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "FULL", "CROSS", "OUTER", "ON",
    "USING", "GROUP", "ORDER", "HAVING", "QUALIFY", "WINDOW", "LIMIT", "UNION",
    "INTERSECT", "EXCEPT", "FOR", "TABLESAMPLE", "PIVOT", "UNPIVOT", "WITH",
    "AS", "SELECT", "FROM",
}

# Words that end a plain select-list item (`SELECT mentor_id FROM ...`).
_ITEM_END_WORDS = {
    "FROM", "WHERE", "GROUP", "HAVING", "QUALIFY", "WINDOW", "ORDER", "LIMIT",
    "UNION", "INTERSECT", "EXCEPT",
}

# Aggregates whose result can never be the identifier itself.
_COUNT_FUNCS = {"COUNT", "COUNTIF", "APPROX_COUNT_DISTINCT", "LOGICAL_AND", "LOGICAL_OR"}

# PII applied to every identifier token in the query, wherever it appears:
# the output-schema gate alone is defeated by `SELECT phone AS x`. These are
# the existing output-column patterns (minus the person-ID one — see below)
# plus `guardian`, which is a contact/relationship field in every table it
# appears in.
_STRICT_PII_TOKEN_PATTERNS = _PII_PATTERNS[:-1] + (re.compile(r"guardian", re.IGNORECASE),)
_PERSON_ID_PATTERN = _PII_PATTERNS[-1]


def _is_strict_pii_token(name: str) -> bool:
    lname = name.lower()
    return any(p.search(lname) for p in _STRICT_PII_TOKEN_PATTERNS)


def _is_contextual_pii_token(name: str) -> bool:
    """Person IDs (`mentor_id`, `scholar_id`, ...) and unvetted `*name*`
    columns (`mentor_name`).

    Decision: these are NOT rejected outright. `mentor_id` is the documented
    join key from the Skills Day / Group Mentoring forms to the roster (it's
    the only way to recover CU there — see TABLE_CARDS) and
    `COUNT(DISTINCT mentor_id)` is the legitimate way to count people; the
    existing tests treat both as safe. They're allowed anywhere except a
    SELECT list, and in a SELECT list only inside COUNT-family aggregates or
    as an un-renamed pass-through column (`SELECT mentor_id` / `r.mentor_id`
    / `mentor_id AS mentor_id`) of a relation — which the output-schema gate
    then still catches if it reaches the final result. Renaming
    (`mentor_id AS x`), wrapping (`CONCAT(mentor_id, '')`) or a scalar
    subquery is rejected: that is exactly how the output-schema gate is
    bypassed.
    """
    lname = name.lower()
    if _is_strict_pii_token(lname):
        return False
    if "name" in lname and lname not in _SAFE_NAME_COLUMNS:
        return True
    return bool(_PERSON_ID_PATTERN.search(lname))


@dataclass
class _Frame:
    kind: str  # "root" | "target" (FROM-subquery) | "cte" | "expr" (any other paren)
    clause: str  # "select" | "from" | "on" | "where" | "group" | ... | "expr"
    func: str | None = None  # word before an "expr" paren (function name), if any
    relation_ok: bool = True  # False for a subquery whose result feeds a SELECT-list expression


def _governing(stack: list[_Frame]) -> tuple[str, _Frame, list[str | None]]:
    funcs: list[str | None] = []
    for frame in reversed(stack):
        if frame.clause == "expr":
            funcs.append(frame.func)
            continue
        return frame.clause, frame, funcs
    return stack[0].clause, stack[0], funcs


def _is_passthrough(tokens: list[Token], i: int) -> bool:
    """`SELECT mentor_id`, `, r.mentor_id,`, `mentor_id AS mentor_id FROM`."""
    n = len(tokens)
    j = i
    while j >= 2 and tokens[j - 1].is_op(".") and tokens[j - 2].ident:
        j -= 2
    before = tokens[j - 1] if j > 0 else None
    if before is None or not (before.is_op(",") or before.upper in ("SELECT", "DISTINCT", "ALL")):
        return False

    def _ends(tok: Token | None) -> bool:
        return tok is None or tok.is_op(",") or tok.is_op(")") or tok.upper in _ITEM_END_WORDS

    after = tokens[i + 1] if i + 1 < n else None
    if _ends(after):
        return True
    if after.upper == "AS" and i + 2 < n:
        alias = tokens[i + 2].ident
        if alias and alias.lower() == (tokens[i].ident or "").lower():
            return _ends(tokens[i + 3] if i + 3 < n else None)
    return False


def _structural_check(tokens: list[Token]) -> str | None:
    """FROM/JOIN targets, person-ID context, whole-row references.

    Returns a rejection reason, or None. Tracks parentheses and the clause
    each paren level is in, which is all these checks need.
    """
    n = len(tokens)

    # CTE names: `WITH name AS (`, `, name AS (`.
    cte_names: set[str] = set()
    cte_parens: set[int] = set()
    defs: set[int] = set()  # token indexes that define a name (not a value use)
    for i in range(1, n - 2):
        t = tokens[i]
        prev = tokens[i - 1]
        if (
            t.ident
            and tokens[i + 1].upper == "AS"
            and tokens[i + 2].is_op("(")
            and (prev.upper in ("WITH", "RECURSIVE") or prev.is_op(","))
        ):
            cte_names.add(t.ident.lower())
            cte_parens.add(i + 2)
            defs.add(i)

    aliases: set[str] = set()
    stack = [_Frame("root", "select")]
    expect_target = False
    allow_query = False  # a FROM-paren may open a subquery: `FROM (SELECT ...`
    pending_alias = False

    for i, t in enumerate(tokens):
        prev = tokens[i - 1] if i > 0 else None
        nxt = tokens[i + 1] if i + 1 < n else None
        top = stack[-1]

        if pending_alias:
            pending_alias = False
            if t.upper == "AS":
                if nxt is not None and nxt.ident:
                    aliases.add(nxt.ident.lower())
                    defs.add(i + 1)
            elif t.ident and (t.kind == "qid" or t.upper not in _NON_ALIAS_WORDS):
                aliases.add(t.ident.lower())
                defs.add(i)
                continue

        if expect_target:
            expect_target = False
            if t.is_op("("):
                stack.append(_Frame("target", "from"))
                expect_target, allow_query = True, True
                continue
            if allow_query and t.upper in ("SELECT", "WITH"):
                allow_query = False  # fall through: an ordinary subquery
            elif t.upper == "UNNEST" and nxt is not None and nxt.is_op("("):
                continue  # the paren opens as an expression; its alias is a value, not a row
            elif t.ident and t.ident.lower() in cte_names and not (nxt is not None and nxt.is_op(".")):
                defs.add(i)
                pending_alias = True
                continue
            elif t.kind == "qid" and "." in t.text and not (nxt is not None and nxt.is_op(".")):
                # 3-part shape/allowlist already enforced on every backticked path.
                pending_alias = True
                continue
            else:
                return (
                    f"Unsupported table reference after FROM/JOIN ({t.text!r}). Every table must be one "
                    "backticked `project.dataset.table`, a CTE name, UNNEST(...) or a subquery."
                )
        allow_query = False

        if t.is_op("("):
            if i in cte_parens:
                stack.append(_Frame("cte", "with"))
            else:
                gov, _, _ = _governing(stack)
                func = prev.upper if prev is not None and prev.kind == "word" else None
                stack.append(_Frame("expr", "expr", func=func, relation_ok=gov != "select"))
            continue
        if t.is_op(")"):
            if len(stack) == 1:
                return "Unbalanced parentheses."
            closed = stack.pop()
            if closed.kind == "target":
                pending_alias = True
            continue
        if t.is_op(",") and top.clause in ("from", "on"):
            expect_target = True  # comma join
            continue

        if t.kind == "word":
            u = t.upper
            if u == "FROM":
                in_extract = top.kind == "expr" and top.func == "EXTRACT"
                distinct_from = prev is not None and prev.upper == "DISTINCT" and i >= 2 and tokens[i - 2].upper in ("IS", "NOT")
                if not (in_extract or distinct_from):
                    top.clause = "from"
                    expect_target = True
                continue
            if u == "JOIN":
                top.clause = "from"
                expect_target = True
                continue
            if u in ("ON", "USING"):
                top.clause = "on"
            elif u in ("WHERE", "HAVING", "QUALIFY", "WINDOW", "LIMIT"):
                top.clause = u.lower()
            elif u in ("UNION", "INTERSECT", "EXCEPT"):
                top.clause = "setop"
            elif u == "SELECT":
                top.clause = "select"
            elif u in ("GROUP", "ORDER", "PARTITION") and nxt is not None and nxt.upper == "BY":
                top.clause = "group" if u != "ORDER" else "order"
            elif u == "WITH" and not (nxt is not None and nxt.upper == "OFFSET"):
                top.clause = "with"

        # Person-ID / unvetted-name columns: only where they can't be renamed
        # into the output (see _is_contextual_pii_token).
        name = t.ident
        if (
            name
            and i not in defs
            and not (prev is not None and prev.upper == "AS")
            and not (nxt is not None and (nxt.is_op(".") or nxt.is_op("(")))
            and _is_contextual_pii_token(name)
        ):
            gov, owner, funcs = _governing(stack)
            if gov == "select":
                ok = (
                    any(f in _COUNT_FUNCS for f in funcs)
                    or (not funcs and owner.relation_ok and _is_passthrough(tokens, i))
                )
                if not ok:
                    return (
                        f"Personal-data column `{name}` may only be counted (COUNT(DISTINCT ...)), joined on, "
                        "filtered or grouped by — not renamed, wrapped in an expression, or returned via a "
                        "scalar subquery."
                    )

    if len(stack) != 1:
        return "Unbalanced parentheses."
    if expect_target:
        return "Query ends where a table reference was expected."

    # A table alias or CTE name used as a value (`TO_JSON_STRING(t)`, `SELECT
    # t`) carries every column of the row out under one innocuous name.
    relations = cte_names | aliases
    for i, t in enumerate(tokens):
        name = t.ident
        if not name or i in defs or name.lower() not in relations:
            continue
        prev = tokens[i - 1] if i > 0 else None
        nxt = tokens[i + 1] if i + 1 < n else None
        if nxt is not None and nxt.is_op("."):
            continue  # `t.col`
        if prev is not None and (prev.is_op(".") or prev.upper in ("AS", "OVER")):
            continue  # a field named like the alias, an output alias, a named window
        # A FROM/JOIN target occurrence of a CTE name was recorded in defs.
        return f"`{name}` is a table alias/CTE name used as a value — select named columns instead."
    return None


def _table_ref_check(tokens: list[Token]) -> tuple[str | None, set[str]]:
    tables: set[str] = set()
    outside: set[str] = set()
    for i, t in enumerate(tokens):
        if t.kind != "qid" or "." not in t.text:
            continue
        parts = t.text.split(".")
        if len(parts) != 3 or not all(re.fullmatch(r"[A-Za-z0-9_-]+", p) for p in parts):
            return (f"Table reference `{t.text}` must be exactly one backticked `project.dataset.table`.", tables)
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        prev = tokens[i - 1] if i > 0 else None
        if (nxt is not None and nxt.is_op(".")) or (prev is not None and prev.is_op(".")):
            return (f"Table reference `{t.text}` must be exactly one backticked `project.dataset.table`.", tables)
        if _table_in_allowed_dataset(t.text):
            tables.add(t.text)
        else:
            outside.add(t.text)
    if outside:
        return f"Reads outside the allowed datasets: {', '.join(sorted(outside))}", tables
    return None, tables


def check_static(sql: str) -> GuardrailResult:
    """Lexes the query, then: single statement / SELECT-or-WITH /
    DML-DDL-scripting / INFORMATION_SCHEMA / SELECT * / table allowlist /
    FROM-target shape / PII identifiers.

    All free — no BigQuery call — so a malformed or out-of-bounds query never
    reaches the dry run. On success ``result.sql`` is the normalized SQL
    (comments removed, no trailing ``;``) that must be what's dry-run and run.
    """
    try:
        tokens, normalized = tokenize(sql or "")
    except SQLLexError as exc:
        return GuardrailResult(False, f"Could not parse the query: {exc}")
    normalized = normalized.strip()
    if tokens and tokens[-1].is_op(";"):
        tokens = tokens[:-1]
        normalized = normalized[:-1].rstrip()
    if not tokens:
        return GuardrailResult(False, "Empty query after stripping comments.")

    if any(t.is_op(";") for t in tokens):
        return GuardrailResult(False, "Multiple statements are not allowed.")

    if tokens[0].upper not in ("SELECT", "WITH"):
        return GuardrailResult(False, "Query must start with SELECT or WITH.")

    for t in tokens:
        if t.kind == "word" and t.upper in _FORBIDDEN_KEYWORDS:
            return GuardrailResult(False, f"Query contains a write/DDL/scripting keyword ({t.upper}).")
        if t.kind in ("word", "qid") and ("INFORMATION_SCHEMA" in t.text.upper() or "__TABLES" in t.text.upper()):
            return GuardrailResult(False, "INFORMATION_SCHEMA / metadata tables are not allowed.")
        if t.kind == "op" and t.text in ("|>", "@@"):
            return GuardrailResult(False, f"Unsupported syntax {t.text!r}.")

    for i, t in enumerate(tokens):
        if t.is_op("*") and i > 0:
            prev = tokens[i - 1]
            if prev.upper in _STAR_AFTER_WORDS or prev.is_op(",") or prev.is_op("."):
                return GuardrailResult(False, "SELECT * is not allowed — name output columns explicitly.")

    reason, tables = _table_ref_check(tokens)
    if reason:
        return GuardrailResult(False, reason)
    if not tables:
        return GuardrailResult(False, "No fully-qualified `project.dataset.table` reference found.")

    for t in tokens:
        if t.ident and _is_strict_pii_token(t.ident):
            return GuardrailResult(
                False,
                f"Query references personal-data column `{t.ident}` — contact, ID-number, birth-date, "
                "location and personal-name fields can't be used at all, even renamed or aggregated.",
            )

    reason = _structural_check(tokens)
    if reason:
        return GuardrailResult(False, reason)

    return GuardrailResult(True, sql=normalized)


# ─── BigQuery client ─────────────────────────────────────────────────────────
# ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY (optional): a service-account key file
# for a read-only identity E!nsight's generated SQL runs as. Unset → the
# dashboard's main client, unchanged.
_ensight_client = None
_ensight_client_key: str | None = None
_ensight_client_lock = threading.Lock()


def _ensight_key_path() -> str:
    return (getattr(settings, "ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY", None) or os.environ.get("ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY") or "").strip()


def _build_ensight_client(key_path: str):
    from google.oauth2 import service_account

    credentials = service_account.Credentials.from_service_account_file(key_path, scopes=database._SCOPES)
    return bigquery.Client(project=settings.BQ_PROJECT_ID, credentials=credentials)


def _bq_client():
    global _ensight_client, _ensight_client_key
    key_path = _ensight_key_path()
    if not key_path:
        return database.get_client()
    with _ensight_client_lock:
        if _ensight_client is None or _ensight_client_key != key_path:
            _ensight_client = _build_ensight_client(key_path)
            _ensight_client_key = key_path
        return _ensight_client


def _all_field_names(fields) -> list[str]:
    names: list[str] = []
    for f in fields or []:
        names.append(f.name)
        names.extend(_all_field_names(getattr(f, "fields", None) or []))
    return names


def dry_run(sql: str) -> GuardrailResult:
    """Free syntax/schema check + statement-type/referenced-table re-check +
    byte estimate + the PII gate, via BigQuery's dry-run mode — no bytes
    billed, catches an unknown column before a cent is spent, and its
    resulting output schema is what the PII gate inspects."""
    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False, use_legacy_sql=False)
    try:
        job = _bq_client().query(sql, job_config=job_config)
    except Exception as exc:  # noqa: BLE001 — fed back verbatim for the one repair attempt
        return GuardrailResult(False, f"Dry run failed: {exc}")

    # Defence in depth: BigQuery's own view of what this statement is and
    # which tables it reads, independent of the text checks above.
    try:
        has_statement_type = hasattr(job, "statement_type")
        statement_type = job.statement_type if has_statement_type else None
    except Exception:  # noqa: BLE001
        return GuardrailResult(False, "Dry run did not report a statement type.")
    if has_statement_type and statement_type != "SELECT":
        return GuardrailResult(False, f"Only SELECT statements are allowed (dry run reports {statement_type!r}).")

    try:
        refs = list(job.referenced_tables)
    except Exception:  # noqa: BLE001 — can't verify what it reads, so it doesn't run
        return GuardrailResult(False, "Dry run did not report which tables the query reads.")
    if not refs:
        return GuardrailResult(False, "Dry run did not report which tables the query reads.")
    outside = []
    for ref in refs:
        project = getattr(ref, "project", None)
        dataset = getattr(ref, "dataset_id", None)
        table = getattr(ref, "table_id", None)
        full = f"{project}.{dataset}.{table}"
        if not (project and dataset and table) or not _table_in_allowed_dataset(full):
            outside.append(full)
    if outside:
        return GuardrailResult(False, f"Reads outside the allowed datasets: {', '.join(sorted(outside))}")

    columns = [f.name for f in job.schema] if job.schema else []
    scanned = job.total_bytes_processed or 0

    if scanned > MAX_BYTES_BILLED:
        return GuardrailResult(
            False,
            f"Estimated scan ({scanned:,} bytes) exceeds the {MAX_BYTES_BILLED:,}-byte budget.",
            dry_run_bytes=scanned,
            output_columns=columns,
        )

    # Nested STRUCT/RECORD fields too: `SELECT STRUCT(...) AS s` must not
    # smuggle a PII field out under a harmless top-level name.
    pii_hits = sorted({c for c in _all_field_names(job.schema) if _is_pii_output_column(c)})
    if pii_hits:
        return GuardrailResult(
            False,
            f"Output would include raw personal-data column(s): {', '.join(pii_hits)}. "
            "Aggregate or COUNT(DISTINCT ...) them instead of selecting the raw value.",
            dry_run_bytes=scanned,
            output_columns=columns,
        )

    return GuardrailResult(True, dry_run_bytes=scanned, output_columns=columns)


def run_guarded(sql: str) -> tuple[GuardrailResult, list[dict]]:
    """Static checks, then dry run, then — only if both pass — the real,
    byte-capped query. Returns ``(result, rows)``; ``rows`` is ``[]`` unless
    ``result.ok``.

    Only the normalized SQL that check_static validated is ever sent to
    BigQuery (``result.sql``); the caller's original text never is.
    """
    static = check_static(sql)
    if not static.ok:
        return static, []
    normalized = static.sql or ""

    dr = dry_run(normalized)
    if not dr.ok:
        return dr, []

    job_config = bigquery.QueryJobConfig(maximum_bytes_billed=MAX_BYTES_BILLED, use_legacy_sql=False)
    try:
        rows = [dict(r) for r in _bq_client().query(normalized, job_config=job_config).result()]
    except Exception as exc:  # noqa: BLE001 — the estimate was wrong or the real job hit the byte cap
        return GuardrailResult(False, f"Query execution failed: {exc}"), []
    return (
        GuardrailResult(True, dry_run_bytes=dr.dry_run_bytes, output_columns=dr.output_columns, sql=normalized),
        rows,
    )
