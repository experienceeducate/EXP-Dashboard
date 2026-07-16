# Architecture Decision Records — EXP Programme Dashboard

Short ADRs capturing the "why". Newest first.

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
