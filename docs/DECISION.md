# Architecture Decision Records — EXP Programme Dashboard

Short ADRs capturing the "why". Newest first.

---

## ADR-009 — Learning & Measurement Map: static content, not a data source
**Status:** Accepted · **Date:** 2026-07-18

**Context.** The Product/Metrics team maintains an OKR / Learning Agenda tracker
as a spreadsheet (`EXP 2026 Learning and Measurement Map (8).xlsx`, repo root,
gitignored — a planning artefact, not app data), reviewed and updated at each
term/mid-year checkpoint. The user asked for a dashboard tab to surface it
alongside what the app already measures, to help with OKR and Learning Agenda
monitoring.

**Decision.** Convert the spreadsheet once into a static data module
(`frontend/src/data/learningMeasurementMap.js`, 36 metrics after deduping one
exact duplicate row) rather than building any ingestion pipeline — there's no
BigQuery table backing this content, and it changes by manual edit, not by
event. Added as a 6th National View inner tab ("Learning & Measurement Map"),
sub-tabbed by the sheet's 4 Strategic Pillars (Investment Memo — grouped by OKR,
since "the Investment Memo section responds to OKRs" — Learning Agenda, Product
Health Metrics, Theory of Change). Each metric is a local drill (own
`.drill-panel`, not the global `DrillPanel`) showing the full reference record
(learning question, targets, data source, decision trigger, Term 1 Achieved
narrative). See `docs/LEARNING_AND_MEASUREMENT_MAP.md` for the full content and
the metric-by-metric live/partial/not-available cross-reference against
`docs/METRICS.md`'s gold-model field catalogue and the Mentor Quality source.

**Consequences.** This file goes stale as the spreadsheet is revised — there is
no live sync. The user updates the source spreadsheet monthly; **regenerate
`learningMeasurementMap.js` from it each time** (see "Keeping this in sync" in
the reference doc) rather than letting the snapshot drift. Each metric carries
a hand-curated `liveStatus` (`live` / `partial` / `none`) and, where live, a
`jumpTab` that switches the parent tab state so the metric's card links
straight to the real BigQuery-backed view (e.g. FOA Supervision Coverage Rate
→ Mentor Quality tab) instead of duplicating its computation. Do not wire a
BigQuery/ETL path for this content without first checking whether the source
spreadsheet itself moves to a queryable system.

**Follow-up (2026-07-18).** Two upgrades on top of the initial snapshot:
- **Dynamic Term 1 vs. Term 2 for live metrics.** `frontend/src/lib/lmmLiveMetrics.js`
  computes real numbers (national + region + CU, both terms) for the 8
  `liveStatus: 'live'` metrics, reusing existing formulas (`getTermMetrics`,
  `avgScholarsPerLec` from `lib/metrics.js`) against `summaryData` already
  loaded by `NationalView` — no new API calls. This replaces the static "Term 1
  Achieved" narrative *only* for metrics with a resolver; metrics without live
  data keep showing the spreadsheet's own narrative text, unchanged, per user
  decision ("where there is no live data, it is okay to keep what is indicated
  in the map"). The metric drill panel gained a click-through region → CU table
  (local state, resets per metric via `key={metric.id}` on remount).
- **OKR descriptions.** `frontend/src/data/okrDescriptions.js` transcribes the
  actual objective/KR text from the approved Investment Memo
  (`APPROVED_ E! EXP Investment Memo_Jan 2026 (2).pdf`, repo root, gitignored —
  same "reference artefact, not app data" treatment as the xlsx), keyed by the
  exact `okrGroup` strings the spreadsheet uses. Two of those spreadsheet
  anchors (`Delivery OKRs - Objective 1: KR1`, `Implementation OKRs -
  Objective 1: KR1`) don't cleanly match the memo's actual Objective/KR
  numbering — each entry's `note` field says so explicitly rather than
  silently forcing a mapping that isn't really there.

**Follow-up (2026-07-18, same day).** Two more changes, per user feedback:
- The key-takeaways note is now stakeholder-facing text ("Tracking progress
  against our 2026 OKRs and Learning Agenda... We are actively mapping
  remaining data sources to BigQuery...") instead of the internal
  engineering framing (doc paths, "static planning doc" wording) — this tab
  is seen by more than just engineers.
- **Passbook Feedback Rate flipped from `partial` to `live`.** Per user
  decision, the proxy is scholars completing passbook milestones ÷ scholars
  activated (LEC2). First implementation summed both of the term's milestone
  `_total_rated` columns (M1+M2 for T1, M3+M4 for T2) as the numerator — that
  double-counts scholars rated on both milestones and produced a nonsense
  186% for Term 1. Fixed to `MAX(milestone A, milestone B)` per term instead
  of summing, which also correctly handles a term's later milestone not
  having happened yet (real data mid-Term 2: M3 had 34,058 scholars rated,
  M4 only 1,773 — using M4 alone would have read as a collapse, not
  "in progress"). Verified against live BigQuery data before and after the fix.

**Follow-up (2026-07-18, later same day) — audit + UX pass.** User feedback:
the tab still buried several metrics behind static spreadsheet text where a
live BigQuery proxy actually existed, and the layout wasn't intuitive. Re-audit
against the gold-model field catalogue found 5 more computable metrics — added
resolvers to `lmmLiveMetrics.js` for: SBC Structural Readiness Rate and SBC
Scholar Project Participation Rate (Community Day T1 / Skills Day T2 as a
live proxy), gender split (Skills Day is the only field with gender captured),
non-scholar engagement (Part B of the club-leadership metric — needed
`schoolData`, threaded through as a new prop since every other resolver only
needed the CU-level `summaryData`), and session duration. Also fixed a status
inconsistency (`mentor-coaching-behavior-score` had a `jumpTab` set but
`liveStatus: 'none'` — contradictory UI) and bumped `earn-save-act-composite`
to `partial` since the sheet itself names PB Quality + Retention as in-program
proxies. Net: live count 9 → 14, partial 5 → 2 (the 2 remaining partials link
through to related-but-not-exact data rather than computing anything).

Caught one more real bug during verification: the session-duration resolver's
first pass used a plain mean of `avg_session_duration_mins`, which produced
259 min nationally and 773 min for one region in Term 1 — `docs/METRICS.md`
§2.12 already documents that this field has extreme per-CU outliers that
blow up a simple average. Switched to median, which is what that section
recommends; result is a sane ~78 min in both terms.

UX changes: metrics within each OKR/pillar group now sort live → partial →
none (real data isn't buried under a long run of greyed-out rows); the
Term 1 vs. Term 2 comparison renders immediately after the live/partial
banner instead of after the full static reference block, and that reference
block is now a collapsed `<details>` for live metrics (still open by default
for metrics with no live data, since the static text is all there is to show
for those); added a per-pillar "Live/partial only" filter toggle.

**Follow-up (2026-07-19).** Two more rounds of user feedback:
- **Investment Memo group ordering + OKR alignment fix.** Groups previously
  followed raw spreadsheet row order, which interleaved a bare "Implementation
  OKRs" group between the two Product OKRs objectives. Added
  `LMM_GROUP_CANONICAL` (merges the sheet's two mismatched "Implementation
  OKRs - Objective 1: KR1/KR2" raw keys into one real group, "Objective 2: KR2
  (Team Culture Survey)", and renames "Delivery OKRs - Objective 1: KR1" to
  its real identity, "Objective 1: KR1 (Frontline Hallmark Index)") and
  `LMM_IM_GROUP_ORDER` (explicit sort: all Product OKRs groups first, in
  Objective/KR order, then all Implementation OKRs groups) — Investment Memo
  only, other pillars keep natural sheet order. Re-verified the PDF text
  directly (`Objective 1` has only `KR1`; `Objective 2` has `KR1` — "Structure
  implemented", untracked by any current metric — `and KR2` — the team
  culture survey) per explicit user request to double-check; the mapping
  already in place was correct, so the note on the merged group now says so
  explicitly (surfaces the untracked Objective 2: KR1 rather than silently
  omitting it).
- **Context for the other 3 pillars.** Learning Agenda / Product Health
  Metrics / Theory of Change have no equivalent OKR source document, so
  groups there looked bare next to Investment Memo's OKR boxes. Added
  `LmmGroupContext`: a same-styled box built from the sheet's own "Learning
  Question" field(s) for that group's metric(s) — open by default for ≤3
  metrics, a collapsed `<details>` for larger groups (Theory of Change's
  15-metric "Product TOC 2026 Draft" group in particular).
- **Top-line results on the metric row itself.** Live metrics previously only
  showed their Term 1/Term 2 numbers after opening the drill panel. Each
  metric row now computes and shows the national T1/T2 top line inline (via
  `resolveLiveMetric`, reusing the same resolvers — no new computation path),
  with a "Click for region/CU drill-down" (live) / "Click for details"
  (everything else) hint replacing the implicit "click to see more."

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

**Follow-up (2026-07-17) — 3rd and 4th sources, Mentor Quality sub-tabs.** Per
user request: "add sub Tabs for Highlights, LEC Observation, Group mentoring
Observation, Skills Day Observation." Added:
- **Two more silver_exp sources**: `exp_2026_skills_day_observation_form` and
  `exp_2026_group_mentoring__observation__form` (`SKILLS_DAY_OBSERVATIONS`/
  `GROUP_MENTORING_OBSERVATIONS` in `core/tables.py`). Field names decoded by
  reading each source's XLSForm `survey`/`choices` sheets (same approach as
  the original LEC form) — both use a 1–3 "On point / Good start / Could be
  better" style rubric with bespoke per-question wording, decoded server-side
  into `objective_score`/`participation_score`/`tin_quality_score`/
  `overall_score` (Skills Day) and `overall_score`/`guidance_score`/
  `action_plan_score`/`engagement_score` (Group Mentoring).
- **Neither source has a `cu` column** (only `region` + `school_name`) — CU is
  resolved via a `mentor_id` join to the same `MENTOR_ROSTER` used for LEC
  (`_mentor_cu_lookup_cte()` in `mentor_quality.py`). Match rate isn't 100%
  (~82% Skills Day, ~95% Group Mentoring at time of writing) — rows whose
  `mentor_id` isn't in the roster get `cu = NULL` and are excluded from a
  CU-scoped user's view (LEFT JOIN + fuzzy CU access filter), never leaked.
- **Group Mentoring's Term 1 vs. Term 2 rubrics are genuinely different
  forms** (Term 1: one generic "Beginning Inquiries" section; Term 2: GM2
  "Create a Product" vs. GM3 "Launch and Make a Sale", each with their own
  option labels). `_group_mentoring_base_cte` normalizes the closest
  equivalent question per term/session-type into one comparable
  `overall_score`/`guidance_score`/`action_plan_score` trio;
  `engagement_score`/`passbook_referenced`/`session_opened_with_milestone`
  only exist on the Term 2 rubric and are `NULL` for Term 1 rows. Skills Day
  has no such split — one rubric covers both terms in the observed data.
- **Live schema volatility, discovered directly, not theoretical.** Mid-build,
  Group Mentoring's Term 2 `t2_q*` rating columns disappeared entirely from
  the BigQuery table between two schema checks minutes apart — even though
  Term 2 rows already existed (session_type `GM2`/`GM3`, zero populated rating
  fields). The exporting pipeline appears to drop a column from the table
  the moment it has zero non-null values across all rows, and re-add it once
  a submission populates it. Referencing a column BigQuery doesn't currently
  have is a hard query error (`400 Name ... not found`), not a `NULL` — a
  naive column reference would intermittently break the whole tab depending
  on submission timing. Fixed with `database.get_table_columns()` (a 10-minute
  TTL-cached `get_table()` schema check) + a `_col(existing, alias, name)`
  helper in `mentor_quality.py`: a column reference degrades to SQL `NULL`
  when the live schema doesn't currently have it, instead of erroring. Applied
  to every optional rating/comment field on both new sources. The same
  incident also flipped several columns from `INTEGER`/`INT64` to `STRING` —
  every numeric field on both new sources uses `SAFE_CAST`, not bare `CAST`,
  for this reason.
- **`performanceBucket()` (frontend) gained a second `hasObservations`
  param** to distinguish "no observations submitted for this CU" from
  "observations exist, but the rated dimensions aren't populated yet" (the
  live-volatility case above makes this common for Group Mentoring Term 2
  right now) — surfaced as a new `unrated`/"Ratings Pending" bucket, mirrored
  server-side as a 4th `data_quality_flag` value. Existing LEC call sites
  don't pass the new param, so LEC's behaviour is unchanged.
- **Highlights sub-tab** (`/api/mentor-quality/highlights`) is a thin
  aggregator, not a new data model: three lightweight national rollup queries
  (one per source, reusing each source's own base CTE) plus one theme summary
  computed by concatenating all three sources' raw comment rows into a single
  `theme_tags.summarize()` call. Per-region/CU detail intentionally stays on
  each source's own sub-tab.
- **Frontend**: `MentorQualityTab` is now a thin sub-tab switcher (Highlights
  / LEC Observation / Group Mentoring / Skills Day); the original tab content
  is unchanged, renamed to `LecObservationSubTab`. Group Mentoring and Skills
  Day share one generic `ObservationSourceSubTab`/`ObservationSourceDrill`
  pair (same region → CU → mentor → observation drill shape, same
  theme-tagged comments pattern as LEC), parameterized by field
  labels/renderers per source — written generically because the two sources
  are structurally identical, not despite it.

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
