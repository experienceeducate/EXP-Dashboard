# CLAUDE.md — EXP Programme Dashboard

Thin project instructions. Detail lives in `docs/`. Read `docs/ONBOARDING.md` first.

## What this is
A two-container read-only dashboard over BigQuery for the EXP programme
(Educate!). FastAPI backend + React 19/Vite SPA, deployed to DigitalOcean
Kubernetes. Single source table: `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model`.

## Non-negotiable conventions
- **Never commit/push directly to `main`** — it auto-deploys to prod. Branch +
  PR. Commits: capitalized imperative subject, no type prefix.
- **Never f-string user input into SQL** — always BigQuery params via the
  `core/sql.py` helpers (`build_where`, `term_clause`, `access_clause`, …).
- Apply the access filter (`access_clause`) to **every** data query — row-level
  scoping is server-side.
- If a status column is tri-state (`active`/`inactive`/NULL), test `= 'active'`,
  never `!= 'inactive'` — NULL is a distinct "no data" state.
- New routes → `app/routers/<domain>.py`, included from `main.py`. **Never add
  route handlers to `main.py`** (it's the app factory only).
- All `/api/*` routes pass the client-header guard (`X-Exp-Client: dashboard-v1`)
  and depend on `current_user`. Use typed FastAPI query params (422 not 500).
- Call BigQuery via `database.run_query(...)` (module object), never a by-value
  `from app.core.database import run_query` — that breaks the test monkeypatch seam.
- Security headers live in `frontend/security-headers.conf`, `include`d from each
  nginx `location` block — never per-location `add_header`.
- Never put SA keys / `*.json` near the Docker context. gitleaks CI is the gate.
- Frontend: single-file `App.jsx`, inline styles, no CSS framework, no client
  router — until scope justifies otherwise (document the trigger as an ADR).

## The single-process invariant (do not break)
The query cache (`core/cache.py`) is **in-memory and process-bound**. Do NOT add
replicas or `uvicorn --workers` without first moving it to Redis. Single replica
per service; pod restart is the recovery path. See `docs/CONTEXT.md`.

## Local dev
See `README.md` → Local dev quick-start. Backend: `uvicorn app.main:app --port 8000`
(no `--reload` on Windows). Frontend: `npm run dev`. Use `frontend/.env.local`
(never `frontend/.env`).
