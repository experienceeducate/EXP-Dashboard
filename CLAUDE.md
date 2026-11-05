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
  and depend on `current_user` — or `person_level_user` for anything at
  person/school level (mentor rows, observations, comments, school lists), so the
  "National view only" tier gets aggregates only. Use typed FastAPI query params (422 not 500).
- Sign-in is Google SSO (staff) or a guest magic link; there is **no shared
  password**. `current_user` validates the server-side session on every request.
  Guests are scoped to one region/CU and are never national/admin/access manager.
- Call BigQuery via `database.run_query(...)` (module object), never a by-value
  `from app.core.database import run_query` — that breaks the test monkeypatch seam.
- Security headers live in `frontend/security-headers.conf`, `include`d from each
  nginx `location` block — never per-location `add_header`.
- Never put SA keys / `*.json` near the Docker context. gitleaks (pre-commit + CI) is the gate.
- Frontend: single-file `App.jsx`, inline styles, no CSS framework, no client
  router — until scope justifies otherwise (document the trigger as an ADR).

## The single-process invariant (do not break)
The query cache (`core/cache.py`), the guest/session store (`core/access_runtime.py`,
replayed from an append-only BigQuery log) and the sign-in rate limiters are
**in-memory and process-bound**. Do NOT add
replicas or `uvicorn --workers` without first moving it to Redis. Single replica
per service; pod restart is the recovery path. See `docs/CONTEXT.md`.

## Local dev
See `README.md` → Local dev quick-start. Backend: `uvicorn app.main:app --port 8000`
(no `--reload` on Windows). Frontend: `npm run dev`. Use `frontend/.env.local`
(never `frontend/.env`).

## Security (read before touching auth, scoping, E!nsight, secrets, CI or k8s)
The 2026-11 security review (Jira DATA-894, parent DATA-888) lives in `docs/security/`:
`SECURITY_REVIEW.md` (OWASP Top 10 assessment), `FINDINGS_TRACKER.md`/`.csv` (shared with
the EXP Training Toolkit — IDs `EXPSEC-D##`), `GUEST_ACCESS.md`, `SECRETS_RUNBOOK.md`.

**Review procedure.** For any change touching auth/sessions/guest access, access scoping,
a route, SQL/E!nsight, admin endpoints, secrets, Dockerfile, `k8s/`, nginx, CI or
dependencies: run the `exp-security-check` skill (`.claude/skills/exp-security-check/SKILL.md`)
before writing and again before committing, and report its checklist. Run `/security-review`
before a PR that changes auth. Update the tracker row / `GUEST_ACCESS.md` in the same PR when
behaviour changes. `app/core/guest_access.py` is shared verbatim with the Toolkit — change both.

**Credential handling.**
- Never commit a credential (code, tests, docs, fixtures, examples). Tests generate dummy
  secrets at runtime; `.env` is gitignored; `.env.example` holds placeholders only.
- Never print, log or echo a token, refresh token, login code, magic-link URL, password or key —
  including in commands you run and output you paste.
- Real secrets live only in the k8s Secrets (`exp-dashboard-credentials`, `exp-dashboard-gcp-key`)
  and GitHub Actions secrets.
- `.gitleaks.toml` `[allowlist]` = verified false positives only, as narrow as possible. A real
  leak: **rotate first** (ask Patrick), then remove, then consider history cleanup.
- Never `git commit --no-verify` past the secret hook.

**Required checks (must pass before every commit/PR):**
```
pre-commit install                         # once per clone — gitleaks on staged changes at every commit
cd backend && python -m pytest             # incl. the 5 revocation tests + sessions/guests tests
gitleaks git --pre-commit --staged -v      # or: pre-commit run gitleaks
bash scripts/gitleaks-selftest.sh          # when .gitleaks.toml changes
cd frontend && npm run lint && npm run build   # when the frontend changes
```
CI enforces the same: `.github/workflows/secret-scan.yml` (full history, every push + PR),
`dependency-audit.yml`, and the backend test job in `deploy.yml`.
