# E!nsight — "Your Educate! Insights Friend"

Dashboard-first question answering over the EXP programme data. Staff ask a
question in plain English; E!nsight answers it from the dashboard's own
endpoints where it can, and from a guardrailed generated BigQuery query only
where it can't.

See `docs/DECISION.md` ADR-010 for why this exists and what it supersedes.

---

## Phase 0 — the survey this was built from

Written down before any code, as the build spec requires. Everything below is
a fact about *this* repo, not the reference build.

### Stack and entry point
FastAPI backend (`backend/app/main.py`, app factory only — no route handlers)
serving a React 19 / Vite SPA (`frontend/src/App.jsx`, no client router, inline
styles). Read-only over BigQuery. Single replica, single uvicorn process, an
in-memory `TTLCache` (ADR-001). E!nsight keeps that invariant: it is synchronous
and stateless, with no job store — the request carries its own history.

### Tier one — the read-only endpoints
Every `GET /api/*` route, all of them `Depends(current_user)` and all behind the
`X-Exp-Client` guard:

| Endpoint | Params | Returns |
|---|---|---|
| `/api/overview/summary` | `term` | Every CU-level and school-level row in scope |
| `/api/cu` | `cu` (req), `term` | School rows for one CU |
| `/api/mentor-quality/summary` | `term` | One row per (region, cu, term) |
| `/api/mentor-quality/summary-by-cu` | `term` | One row per (region, cu) |
| `/api/mentor-quality/sessions` | `term` | Session-level (LEC1..LEC14) breakdown |
| `/api/mentor-quality/questions` | `term` | Per rated dimension |
| `/api/mentor-quality/mentors` | `cu` (req), `term` | Per-mentor rows for one CU |
| `/api/mentor-quality/mentor-observations` | `cu` (req), `mentor_id` (req), `term` | Individual observations |
| `/api/mentor-quality/comments` | `term` | Theme-tagged free-text comments |
| `/api/mentor-quality/group-mentoring/*` | same shapes | Group Mentoring equivalents |
| `/api/mentor-quality/skills-day/*` | same shapes | Skills Day equivalents |
| `/api/mentor-quality/highlights` | `term` | Cross-source national rollup |

The catalog handed to the model is **derived at runtime** from the router
objects (`core/ensight_catalog.py`), not restated — a renamed route can't drift
out of sync with the prompt.

### The warehouse tables, and the rules each one needs
Mined from the comments in `core/tables.py`, `routers/mentor_quality.py` and
`docs/METRICS.md` — not from the schema.

1. **`gold_exp.exp_ai_dashboard_model`** — the wide one-big-table, ~158 columns.
   **The discriminator is `level`** (`'cu'` / `'school'`). CU rows and school
   rows are stacked in the same table and school rows roll up into CU rows, so
   **any aggregate without `level = 'cu'` or `level = 'school'` double-counts.**
   Also per-term: one row per (cu, term), so summing across terms
   multiply-counts a CU.
2. **`silver_exp.exp_2026_lec_observation_form`** — one row per LEC observation.
   The raw `term` column is unreliable (bare `"1"`/`"2"`, inconsistent with the
   session dates); **term must be derived from `date`** against the fixed 2026
   calendar. Ratings live in `qn*` columns, not readable names.
3. **`bronze_exp.mentor_2026`** — the mentor roster. Has **both `cu` and `CU`**;
   `COALESCE(cu, CU)` or the count splits. "Active" means `first_login_at IS NOT
   NULL` — there is no status column.
4. **`silver_exp.exp_2026_skills_day_observation_form`** and
   **`silver_exp.exp_2026_group_mentoring__observation__form`** — neither has a
   `cu` column at all; CU is recovered by joining `mentor_id` to the roster.
   Both are live survey exports whose schema gains and drops columns while
   submissions land.

Across all of them: CU spellings differ between sources, and text dimensions
hold mixed casing. Group or join on `UPPER(TRIM(col))`, never the raw column.

### The auth model
`core/access.py` resolves an email to a scope: national (everything) / regional
(listed regions) / CU (listed CUs) / `national_only` (any unlisted
`@experienceeducate.org` address — national view, no listing) / nothing.
`access_clause` is applied server-side to every data query.

E!nsight is gated tighter than that: **only emails explicitly listed in
`ACCESS_CONFIG["national"]`.** It excludes `national_only` (the domain-fallback
tier), and all regional/CU staff, because it is the one feature that turns a
typed sentence into a warehouse query and spends money per question.

### Conventions this feature must not break, and the one it bends
- `CLAUDE.md`: never f-string user input into SQL (ADR-002). **E!nsight is the
  documented exception** — see ADR-010 and the guardrails below.
- Never add route handlers to `main.py` → `routers/ensight.py`.
- Call BigQuery via `database.run_query(...)` on the module object (test seam).
- Apply `access_clause` to every data query — generated SQL gets an equivalent
  scope check; see "Access" below.
- ADR-003 dropped an analytics chat widget. **ADR-010 supersedes it.**

---

## The pipeline

```
question
   │
   ▼
[1] plan ──▶ route: dashboard | sql | refuse
   │
   ├── dashboard ──▶ call ≤3 endpoints in-process ──▶ [2] answer
   │                                                     │
   │                                        sufficient? ─┴─ yes ──▶ done
   │                                                     no
   ▼                                                     │
[3] write SQL ◀────────────────────────────────────────  ┘
   │
   ▼
guardrails ──(fail)──▶ one repair attempt ──(fail)──▶ honest "I couldn't"
   │
   ▼
[4] answer from rows   (labelled: direct warehouse query)
```

Endpoints come first because their code already encodes every correction the
team has paid for one audit at a time — which `level` to filter, which term's
rows a rate reads, which denominator. An answer sourced from an endpoint agrees
with the screen by construction. Generated SQL is one step further from the
screen, so it is the fallback and it is labelled as such everywhere it appears.

Four model calls maximum (five with a SQL repair). No background job store.

## Guardrails on generated SQL

Every check fails closed. Order matters — each is cheaper than the next.

| Check | Catches |
|---|---|
| GoogleSQL **lexer** (strings incl. triple-quoted/raw/bytes, backtick identifiers, `--`/`#`/`/* */` comments); every check below runs on its tokens | A comment marker inside a string literal (`'/*'`) hiding a clause from the checks |
| Single statement (one trailing `;` at most), `SELECT`/`WITH` only, no DML/DDL/scripting keyword, no `INFORMATION_SCHEMA` | Anything that writes or scripts; metadata reads |
| Every `FROM`/`JOIN` target is a CTE name, `UNNEST(...)`, a subquery, or one backticked `project.dataset.table` in the allowed datasets | Reads outside the vetted datasets, incl. `` `p`.`d`.`t` `` and bare `dataset.table` |
| No `SELECT *` / `t.*` | Unknown output columns, which would defeat the PII gate |
| **PII identifiers** in the SQL text (see below) | `SELECT phone AS x` — a rename the output-schema gate can't see |
| Dry run (+ `statement_type == SELECT`, every `referenced_tables` entry in the allowed datasets) | Syntax errors and unknown columns — free, before spending. Fed back for **one** repair attempt |
| Byte budget against the dry run's estimate | A runaway scan, before a cent is spent |
| **PII gate on the dry run's output schema** (nested fields too) | Personal data leaving the backend |
| `maximum_bytes_billed` on the real job | The estimate being wrong |

**What runs is what was checked.** The SQL that is dry-run and executed is the
lexer's normalized text (comments removed, trailing `;` dropped) — never the
model's original string. That normalized SQL is what `sources[].sql` shows.

PII is checked twice. On the **SQL tokens**: contact, email, ID-number,
birth-date, GPS and personal-name identifiers (and `guardian`) are rejected
anywhere outside a string. Person IDs (`mentor_id`, `scholar_id`, …) and
unvetted `*name*` columns are legitimate join/count keys, so they're allowed
everywhere except a SELECT list — and there only inside `COUNT`-family
aggregates or as an un-renamed pass-through column (no `AS x`, no wrapping
expression, no scalar subquery). A table alias/CTE name used as a value
(`TO_JSON_STRING(t)`) is rejected too. On the **output schema**: the dry run's
column names (including nested STRUCT fields) are checked again, which is what
catches a pass-through `mentor_id` that reaches the final result.

Optional: set `ENSIGHT_GOOGLE_SERVICE_ACCOUNT_KEY` to a key-file path and the
dry run + execution use that (read-only) service account instead of the
dashboard's main client.

Underneath all of it the service account has **no write access anywhere** in the
warehouse (verified: `create_table` returns 403 on every dataset). Text
validation is not the security boundary; it is what catches an honest mistake
early and keeps the audit log readable.

One repair attempt, not a loop. Two failures return an honest
"I couldn't build a safe query for that" — never an invented answer.

## Answer format

Four labels, in order: **Key finding** (the number, with its denominator named),
**Insight** (the driver and the comparison), **Conclusion** (one sentence of
judgement), **Recommendation** (what to change; no owner, no deadline).

Grounding outranks the structure. The model must mark its evidence — "the data
shows X" when a column demonstrates it, "likely driven by X, which this data
cannot confirm" otherwise. A null means "not reported", not zero. An implausible
value (a rate over 100%, a placeholder name) becomes the finding rather than the
basis of one.

## Provenance, not just prose

The answer alone is half the point — a number with no visible origin is
exactly the thing the reader shouldn't have to trust blind. Every response
from `POST /api/ensight/ask` carries, alongside `answer`:

- **`sources`** — `[{"kind": "endpoint", "path", "params"}, ...]` for a
  dashboard-sourced answer, or `[{"kind": "sql", "sql", "bytes_processed",
  "row_count"}]` for a warehouse one. The UI reveals the SQL on click rather
  than showing it inline — it's evidence, not the headline.
- **`rows`** (capped at 200) and **`row_count`** (the true total) — the
  warehouse route's evidence rows, so a figure can be checked against what
  actually came back instead of taken on trust. `null` for a dashboard answer
  (the endpoint's own tab already shows those rows).
- **`notes`** — plain-English asides for anything that happened on the way:
  the dashboard-to-SQL escalation ("the dashboard endpoints didn't cover this
  — queried the warehouse directly instead"), or a SQL repair that succeeded.
  Never used to hide a failure — a failure is the `answer` itself.
- **`cached` / `cached_minutes_ago`** — a reused answer says how old it is;
  "Ask again" (`force_refresh`) bypasses the cache explicitly rather than
  leaving a stale figure the only option.

## Exports are signed

`POST /api/ensight/export` re-runs each answer's SQL and puts its answer text
into an Educate!-branded document, so it only accepts what `/ask` produced:

- `/ask` returns **`answer_sig`** (over the answer text) and a **`sig`** on
  every `kind: "sql"` source (over its `sql`). HMAC-SHA256, keyed by
  `HMAC(JWT_SECRET, "ensight-export-v1")`, bound to the purpose (answer vs SQL)
  and the signed-in user's email.
- The client echoes them back unchanged: each export item carries
  `answer_sig`, and each SQL source carries `sig`. A missing or invalid
  signature on any item is a generic **400**; nothing is run.
- Endpoint sources need no signature — they're re-run under the caller's own
  access scope, only against cataloged paths, with each endpoint's declared
  `Query` constraints (pattern/length/bounds) enforced.

Rotating `JWT_SECRET` invalidates outstanding signatures (re-ask, then export).

## Input limits

`question` ≤ 1000 chars; `history` ≤ 6 entries, each `role` exactly `user` or
`assistant` and `content` ≤ 4000 chars (anything else is a 422).

## Access, cost, caching, audit

- **Gate:** listed national users only. Re-checked server-side on every request,
  not inferred from the prompt.
- **Availability:** `GET /api/ensight/availability` is open to any signed-in
  user so the SPA can decide whether to render the tab instead of showing
  everyone a tab that 403s. An unset `OPENROUTER_API_KEY` switches the feature
  off cleanly.
- **Rate limit:** per user, sliding window, per-minute and per-hour.
- **Cache:** keyed on the normalised question plus the caller's scope and active
  filters, TTL matched to `CACHE_TTL_SECONDS` — an answer can never be fresher
  than the data behind it. A follow-up carrying history neither reads nor writes
  it; "Ask again" bypasses it explicitly.
- **Audit:** every question is logged — who, route taken, generated SQL,
  duration, cached or not. The table does not exist yet (the service account has
  no write access); the insert degrades to a **logged warning**, never a silent
  swallow — and no audit failure of any kind can replace the answer or the
  real error. See `DATA_ENG_BIGQUERY_TABLES_REQUEST.md` table 4.

Budget roughly US$0.05 and 30–50 s per question.

## Where the code is

| File | Job |
|---|---|
| `backend/app/core/ensight_catalog.py` | Endpoint catalog (derived at runtime), table cards, shared context |
| `backend/app/core/ensight_calling.py` | Calling a route in-process, resolving FastAPI's markers |
| `backend/app/core/ensight_guardrails.py` | Every check above |
| `backend/app/core/ensight_llm.py` | OpenRouter client, tolerant JSON parsing, truncation detection |
| `backend/app/core/ensight_pipeline.py` | The four steps, cache, rate limit, audit |
| `backend/app/routers/ensight.py` | `GET /availability`, `POST /ask`, `POST /export` (signature check) |
| `frontend/src/views/EnsightView.jsx` | The tab |
| `frontend/src/lib/markdown.jsx` | Minimal renderer (bold, code, lists, tables) |
</content>
