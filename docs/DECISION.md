# Architecture Decision Records — EXP Programme Dashboard

Short ADRs capturing the "why". Newest first.

---

## ADR-008 — Mentor Quality: a second BigQuery source, outside `gold_exp`
**Status:** Accepted · **Date:** 2026-07-17

**Context.** Mentor observation data (LEC session ratings + free-text
comments) lives in `silver_exp.exp_2026_lec_observation_form` and the mentor
roster in `bronze_exp.mentor_2026` — neither is folded into
`gold_exp.exp_ai_dashboard_model`. Data engineering may fold this into the
gold model eventually; the user explicitly chose not to wait for that.

**Decision.** Add `app/routers/mentor_quality.py` querying these two tables
directly, registered as `MENTOR_OBSERVATIONS`/`MENTOR_ROSTER` in
`core/tables.py` alongside (not replacing) `DASHBOARD_MODEL`. Surfaced as a
5th inner tab ("Mentor Quality") on National View, reusing the existing header
term filter. Same access-scoping and parameterised-SQL discipline as every
other route (see ADR-002/ADR-005) — this is additive, not an exception.

**Data-integration quirks this router works around** (discovered by sampling
both tables against the existing `ACCESS_CONFIG` cu keys before writing the
query):
- **CU-name spelling drift.** `gold_exp` / `ACCESS_CONFIG` use e.g. `"jinja 1"`
  (space) and `"busia - namayingo"` (spaced hyphen); the mentor tables use
  `"Jinja-1"` / `"Busia-Namayingo"` (hyphenated, no spaces), and the two
  mentor tables aren't even consistent with each other on this. Reusing
  `core/sql.py::access_clause`/`cu_clause` verbatim would silently deny scoped
  users their own CU's rows. Fixed with `access_clause_fuzzy_cu`/
  `cu_clause_fuzzy` (`core/sql.py`), which compare CU names with spaces and
  hyphens stripped (alphanumerics-only) instead of an exact string match. Use
  these — not the plain `access_clause`/`cu_clause` — for any query against
  the mentor tables or any other future non-`gold_exp` source with the same
  drift.
- **Term format.** The raw `term` column is bare `"1"`/`"2"` and unreliable —
  inconsistent with the actual session date in some rows. Per user decision,
  `observation_base` (in `mentor_quality.py`) derives `term` from the
  observation `date` instead, via `_TERM_CASE_EXPR`, against the fixed 2026
  programme calendar: Term 1 = Feb 1–May 1, Term 2 = May 25–Aug 21, Term 3 =
  Sep 14–Dec 4. A row whose date falls outside all three windows (e.g. the
  gaps between terms) gets `term = NULL` — excluded by a specific-term filter,
  still included (with a blank term) under "all". `_term_filter_clause`
  applies the same CASE expression in the WHERE (BigQuery can't reference a
  SELECT-list alias there).
- **Mentor coverage sourced from `gold_exp`, not the bronze roster.** The
  "mentors assigned vs. observed" KPI/region-breakdown numbers in the frontend
  (`NationalView.jsx::MentorQualityTab`) read `total_active_mentors`/
  `total_observed_mentors` off `summaryData` (the already-loaded, access-scoped
  `gold_exp.exp_ai_dashboard_model` CU rows) instead of the backend's
  bronze-roster-derived `total_mentors_assigned`/`mentors_observed`. Per user
  decision: the gold model is the trusted single source of truth elsewhere in
  the app, and its per-CU mentor counts didn't match the bronze roster
  snapshot. The backend's `/summary`/`/summary-by-cu` roster fields are still
  used for the quality-dimension breakdown and `data_quality_flag` (no
  equivalent exists in the gold model), so the two sources coexist in one tab
  — reconcile via `normCu()`-keyed lookups, same fuzzy-match reasoning as
  above. Under "All Terms", the frontend picks each CU's *latest available*
  term snapshot rather than summing across terms (summing would double-count,
  same failure mode as the mentors-observed fix below).
- **No "active mentor" column.** `bronze_exp.mentor_2026` has no status flag.
  "Active Mentors" is approximated as `first_login_at IS NOT NULL` (has ever
  logged into the mentor app). Revisit if a real status field is added
  upstream.
- **Known pre-existing gap, not fixed here:** `ACCESS_CONFIG`'s own CU key for
  Busia-Namayingo (`"busia-namayingo"`, no spaces) doesn't exact-match
  `gold_exp`'s own `cu` value (`"busia - namayingo"`, spaced hyphen) either —
  i.e. this spelling drift predates this feature and likely already affects
  that one CU-scoped user's access to `DASHBOARD_MODEL` itself. Out of scope
  here; flagged for whoever owns `ACCESS_CONFIG`/the gold model to reconcile.

**Qualitative "unpacking".** Per user decision, comments are tagged with
deterministic keyword/phrase rules (`core/theme_tags.py`) — no LLM, no new
cost or dependency. ~14 themes (time management, energy, checking for
understanding, gender inclusivity, visual aids, real-life examples, classroom
management, lesson-plan adherence, facilitation technique, voice/pace,
rapport, participation, preparation, movement), each mention additionally
classified strength vs. growth-area by cue words in the same sentence
("needs to", "however", "didn't", …). Rules were derived from a sample of the
real 618-row comment corpus, not guessed.

**Consequences.** A second service-account-scoped BigQuery source is now part
of the contract; `docs/CONTEXT.md`'s "single source table" framing is now
"single source table for programme delivery data, plus a second source for
mentor observation data" — update that doc if this grows a third source.

---

## ADR-007 — Rewrite the frontend from a single-file HTML app to React 19 + Vite
**Status:** Accepted · **Date:** 2026-07-16

**Context.** The product started as `legacy/dashboard-v1.html`: one ~11k-line
self-contained HTML file (inline CSS/JS + a 7 MB embedded demo-data literal) that
fetched from a Google Apps Script endpoint.

**Decision.** Rewrite the UI as a React 19 + Vite SPA (`frontend/src/App.jsx`,
inline styles, no CSS framework, no client-side router) matching the reference
stack, and repoint it at the new FastAPI backend.

**Consequences.** Faithful reproduction of the existing views (national /
regional / CU / school), KPIs, tables, charts, filters, and PDF export is
required — there is regression risk. The original is preserved verbatim at
`legacy/dashboard-v1.html` as the behavioural source of truth.

---

## ADR-006 — Switch the data source to `gold_exp.exp_ai_dashboard_model`
**Status:** Accepted · **Date:** 2026-07-16

**Context.** The legacy app read from a Google Apps Script web app backed by
Sheets. The curated gold model `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model`
now holds the same shape (a wide table with a `level` column for CU vs school rows).

**Decision.** The FastAPI backend queries this BigQuery table directly via a
service-account key (BigQuery Data Viewer + Job User), replacing the Apps Script.

**Consequences.** Auth to data is via a mounted SA key (k8s Secret), never in an
image. The table is treated as a stable contract; `SELECT *` is used because it
is a purpose-built dashboard model (see ADR-002 note on column enumeration).

---

## ADR-005 — Preserve email-based per-user access scoping (not full-cohort)
**Status:** Accepted · **Date:** 2026-07-16

**Context.** The reference dashboard is deliberately full-cohort (every
authenticated user sees everything). The legacy EXP app instead scoped each user
by email to national / regional / CU via an `ACCESS_CONFIG`.

**Decision.** Keep the per-user scoping model. A user's email resolves to an
access scope, embedded in the JWT; **row-level filtering is applied server-side**
in every data query (`core/sql.py::access_clause`) — an improvement over the
legacy app which loaded all rows and filtered client-side.

**Consequences.** Every data router MUST apply `access_clause`. The cache key
includes the user's `scope_key` so users with different scopes never share cache
entries. Unknown emails resolve to no access → 403.

---

## ADR-004 — Email + shared password login, alongside Google SSO
**Status:** Accepted · **Date:** 2026-07-16

**Decision.** Two sign-in paths, one JWT scheme: (a) email + shared
`DASHBOARD_PASSWORD`, and (b) Google SSO restricted to `@experienceeducate.org`.
Both resolve the email to an access scope.

**Accepted v1 limitations** (document, don't hide): shared password path; JWT in
`sessionStorage` (not an httpOnly cookie); `JWT_SECRET` doubles as the OAuth
session key. Fine for an internal pilot; revisit before external exposure.

---

## ADR-003 — Drop the analytics chat widget
**Status:** Accepted · **Date:** 2026-07-16

**Context.** The reference optionally proxies an in-cluster analytics bot. The
EXP dashboard has no such bot.

**Decision.** No `chat.py`, no `/api/chat/*`, no widget. If added later, the
bot's `X-API-Key` stays server-side only, `conversation_id` is derived from the
JWT, and the in-memory job store reinforces the single-process invariant.

---

## ADR-002 — Custom client-header guard + parameterised SQL only
**Status:** Accepted · **Date:** 2026-07-16

**Decision.** Every `/api/*` request must carry `X-Exp-Client: dashboard-v1`
(exempt: `/health`, `/docs`, `/redoc`, `/openapi.json`, OAuth callbacks;
`OPTIONS` skipped). All user input reaches BigQuery only as
`ScalarQueryParameter` / `ArrayQueryParameter` via `core/sql.py` helpers — never
f-strings. All queries flow through `database.run_query` (the single test seam).

---

## ADR-001 — Single process / single replica; in-memory cache
**Status:** Accepted · **Date:** 2026-07-16

**Decision.** One replica per service, one uvicorn process. The 5-minute TTL
query cache lives in the process heap.

**Consequences.** Do NOT add replicas or `--workers` without moving the cache to
Redis first — cache hits would otherwise land on a process that never saw the
entry. Pod restart is the recovery path (acceptable for an internal pilot). This
is the most important operational constraint; see `docs/CONTEXT.md`.
