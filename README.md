# EXP Programme Dashboard

Read-only operational dashboard over BigQuery for the EXP programme (Educate!).
FastAPI backend + React 19 / Vite SPA, deployed to DigitalOcean Kubernetes.

- **App:** https://exp-dashboard.educateapps.work
- **API:** https://exp-dashboard-api.educateapps.work
- **Source table:** `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model`

```
BigQuery (gold_exp.exp_ai_dashboard_model)
    ↓  service-account key (BigQuery Data Viewer + Job User)
FastAPI backend (Python 3.14)  → single replica / single process
    │  /api/auth/*      email+password or Google SSO → JWT (carries access scope)
    │  /api/overview/*  CU + school rows, row-level access-scoped
    │  /api/cu          CU drilldown (school rows)
    │  every /api/* needs a valid JWT + the X-Exp-Client header
    ↓  REST JSON (Bearer JWT + CORS allowlist + X-Exp-Client)
React 19 + Vite SPA (nginx)  → single replica
```

## Repository layout
```
├── CLAUDE.md            project conventions (thin)
├── docs/                ONBOARDING · CONTEXT · ARCHITECTURE · DECISION · FLOW
├── .github/workflows/   deploy.yml (digest-pinned) · secret-scan.yml (gitleaks)
├── backend/             FastAPI app (app/core, app/routers, tests)
├── frontend/            React 19 + Vite SPA
├── k8s/                 backend + frontend manifests
└── legacy/              dashboard-v1.html — the original single-file app (reference)
```

## Local dev quick-start (Windows / PowerShell)

`--reload` can crash on Windows — run without it and restart manually.

```powershell
# Terminal 1 — backend
cd backend
python -m venv venv; venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env    # then fill secrets + BQ config + place service-account.json
uvicorn app.main:app --port 8000

# Terminal 2 — frontend
cd frontend
npm install
copy .env.example .env.local     # VITE_API_URL=http://localhost:8000
npm run dev
```

Smoke test: `curl http://localhost:8000/health`, open `http://localhost:3000`,
API docs at `http://localhost:8000/docs`.

> **Env-file footgun:** Vite prefers `.env.local` over `.env`. Do **not** create
> `frontend/.env` — a stale one has previously made local dev silently hit prod.

Generate secrets: `python -c "import secrets; print(secrets.token_hex(32))"`.

### Required `backend/.env`
`GOOGLE_SERVICE_ACCOUNT_KEY` (path to SA JSON), `BQ_PROJECT_ID` / `BQ_DATASET` /
`BQ_TABLE`, `JWT_SECRET`, `DASHBOARD_PASSWORD`, the client-header token, and
`FRONTEND_URL`. Google OAuth vars are optional locally (email+password works
without them). See `backend/.env.example`.

## Auth & access model
Two sign-in paths, one JWT scheme (HS256, 8h, `sessionStorage`, `Authorization:
Bearer`):
- **Email + shared password** → `POST /api/auth/login`
- **Google SSO** (`@experienceeducate.org`) → `/api/auth/google/login`

Both resolve the email to an **access scope** (`national` / `regional` / `cu`)
via `ACCESS_CONFIG`, embedded in the JWT. **Row-level filtering is server-side**
(`core/access.py` + `core/sql.py::access_clause`). Unknown emails get no access.

## Metric definitions
The source model is a wide "one-big-table" with a `level` column (`cu` /
`school`). See `docs/ARCHITECTURE.md` for the field catalogue and
`docs/FLOW.md` for how a request becomes a scoped BigQuery query. Derived
metrics (quality rates, completion rates) are documented alongside the routers /
frontend that compute them.

## Deploy
Push to `main` auto-builds changed images and digest-pins the rollout (see
`.github/workflows/deploy.yml`). k8s manifest changes are applied manually with
`kubectl apply` — see `docs/CONTEXT.md` → Deployment for the ordering rules.

## Tests
```powershell
cd backend; python -m pytest
```
