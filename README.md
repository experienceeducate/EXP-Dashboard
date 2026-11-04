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
    │  /api/auth/*      Google SSO (staff) / magic links (guests) → server-side session
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
copy .env.example .env    # then fill secrets + BQ config
gcloud auth application-default login   # BigQuery as your own Google identity
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

### BigQuery credentials locally
Leave `GOOGLE_SERVICE_ACCOUNT_KEY` **empty** and run:

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project educate-data-warehouse-test
```

The backend then reaches BigQuery as *you*, under your own IAM grants, and no
service-account key ever lands on the laptop — the SA key is meant to live only
in the k8s Secret (`docs/CONTEXT.md`). You need BigQuery Data Viewer + Job User
on `educate-data-warehouse-test`. Setting `GOOGLE_SERVICE_ACCOUNT_KEY` to a JSON
path still works and still takes precedence; that is how the cluster runs.

### Required `backend/.env`
`BQ_PROJECT_ID` / `BQ_DATASET` / `BQ_TABLE`, `JWT_SECRET`, the client-header
token, and `FRONTEND_URL` (`GOOGLE_SERVICE_ACCOUNT_KEY` is optional — see above).
There is no shared password any more: sign in locally with Google SSO
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, see below) or as a guest via a
magic link — set `MAIL_BACKEND=file` + `MAIL_OUTBOX_DIR` to have links written to
disk instead of emailed, and `ACCESS_EVENTS_IN_MEMORY=true` to keep sessions in
memory instead of BigQuery. See `backend/.env.example`.

## Auth & access model
Every sign-in creates a **server-side session** (`core/guest_access.py`): a
15-minute access JWT (`Authorization: Bearer`) bound to the session id and
re-validated on every request (so revocation is immediate), plus a rotating
refresh token, a 60-minute idle timeout and an absolute lifetime (8h). The SPA
keeps both tokens in `sessionStorage`, refreshes ~1 minute before expiry and on
any 401 (`POST /api/auth/session/refresh`), and `POST /api/auth/logout` revokes
the session. Tokens never appear in URLs. There is **no shared password** (the
old `POST /api/auth/login` is gone — see ADR-011 in `docs/DECISION.md`).
- **Staff — Google SSO** (`@experienceeducate.org`) → `/api/auth/google/login` →
  Google → `/api/auth/google/callback` → redirects to
  `FRONTEND_URL/#login_code=<one-time code>` (60 s, single use; or `/#error=<code>`).
  The SPA strips the fragment and exchanges the code via
  `POST /api/auth/session/exchange`.
- **Guests — magic links.** A guest (partner, personal address) requests access
  on the login screen (`POST /api/auth/request-access`) or is invited; an access
  manager approves them in **Admin → Guest access** with exactly one region or
  CU and an end date (90 days by default), and whitelists their exact email (a
  separate control). They then request a single-use, 15-minute link
  (`POST /api/auth/magic-link`) that lands on `FRONTEND_URL/#magic=<token>`; the
  SPA only redeems it (`POST /api/auth/magic-link/redeem`) when the guest presses
  **Sign in** — never on load, since email scanners prefetch links.
  `GET /api/auth/config` tells the login screen which options are available.

Staff emails resolve to an **access scope** (`national` / `regional` / `cu`)
via `ACCESS_CONFIG`, re-resolved on every request; a guest's scope is the one
region/CU they were approved for. **Row-level filtering is server-side**
(`core/access.py` + `core/sql.py::access_clause`). Unknown emails get no access;
other `@experienceeducate.org` colleagues get *National view only* (national
aggregates, no person/school drill-downs or task updates).

### Google OAuth setup (one-time)
SSO needs a Google OAuth 2.0 client. In the Google Cloud console for the project:
1. **APIs & Services → OAuth consent screen** — Internal user type, app name
   "EXP Dashboard", support email; no scopes beyond the default openid/email/profile.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID** —
   type **Web application**. Add **Authorized redirect URIs**:
   - `https://exp-dashboard-api.educateapps.work/api/auth/google/callback` (prod)
   - `http://localhost:8000/api/auth/google/callback` (local dev)
3. Copy the **Client ID / Client secret** into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` — in the `exp-dashboard-credentials` k8s Secret for prod,
   and `backend/.env` for local dev. Ensure `FRONTEND_URL` matches the SPA origin
   the callback should return to.

## Metric definitions
The source model is a wide "one-big-table" with a `level` column (`cu` /
`school`). Full metric formulas, RAG thresholds, and the field catalogue are in
**`docs/METRICS.md`** (the EXP Dashboard Metrics Reference). See
`docs/ARCHITECTURE.md` for the grouped field list, `docs/FLOW.md` for how a
request becomes a scoped BigQuery query, and `docs/DROPPED_SECTIONS.md` for the
parity gap analysis vs. the legacy dashboard.

## Deploy
Push to `main` auto-builds changed images and digest-pins the rollout (see
`.github/workflows/deploy.yml`). k8s manifest changes are applied manually with
`kubectl apply` — see `docs/CONTEXT.md` → Deployment for the ordering rules.

## Tests
```powershell
cd backend; python -m pytest
```
