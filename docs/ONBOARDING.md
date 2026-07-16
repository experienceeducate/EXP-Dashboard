# Onboarding — EXP Programme Dashboard

Orientation map for a new engineer (or Claude Code session). Read in this order.

## Read order
1. **This file** — the map and quick-start.
2. `README.md` — local setup, env vars, high-level architecture.
3. `docs/CONTEXT.md` — current state, quirks, gotchas, the single-process invariant.
4. `docs/ARCHITECTURE.md` — component map, the data model, API surface.
5. `docs/DECISION.md` — the "why" behind the non-obvious choices (ADRs).
6. `docs/FLOW.md` — step-by-step runtime traces (login, a scoped query).
7. `docs/METRICS.md` — metric definitions, formulas, RAG thresholds, BQ fields.
8. `docs/DROPPED_SECTIONS.md` — which legacy UI sections are deferred and whether
   they can be recalculated from BigQuery.
9. `CLAUDE.md` — the conventions you must follow when editing.

## Mental model in three sentences
A React SPA talks to a FastAPI backend that runs parameterised, access-scoped
queries against one wide BigQuery table (`gold_exp.exp_ai_dashboard_model`) and
caches results in-memory for 5 minutes. Users authenticate by email (shared
password or Google SSO); their email resolves to an access scope (national /
regional / CU) that filters every row server-side. Everything is single-replica
and read-only — the operational constraints follow from the in-memory cache.

## Quick-start
See `README.md` → Local dev quick-start. TL;DR: fill `backend/.env`, run
`uvicorn app.main:app --port 8000`, then `npm run dev` in `frontend/`.

## Where things live
| You want to… | Go to |
|---|---|
| Add an API endpoint | `backend/app/routers/<domain>.py` (include in `main.py`) |
| Change how BigQuery is queried | `backend/app/core/database.py`, `core/sql.py` |
| Change the source table | `backend/app/core/tables.py` + `.env` |
| Change auth / access scoping | `backend/app/auth.py`, `core/access.py` |
| Change the UI | `frontend/src/App.jsx` |
| Look up a metric formula / RAG threshold | `docs/METRICS.md` |
| Know if a dropped section is recalculable | `docs/DROPPED_SECTIONS.md` |
| Change deploy / CI | `.github/workflows/deploy.yml` |
| Change cluster config | `k8s/**` (applied manually — see CONTEXT) |
| See the original dashboard | `legacy/dashboard-v1.html` |
