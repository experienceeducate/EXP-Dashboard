---
name: exp-security-check
description: Security regression check for the EXP Programme Dashboard. Use BEFORE writing and again BEFORE committing any change that touches auth/sessions/guest access, access scoping (access_clause, national_only, guests), a new or changed /api route, SQL or E!nsight, admin endpoints, secrets/.env/k8s Secrets, Dockerfile, k8s manifests, nginx, CI workflows, or dependencies; and whenever asked for a "security check" or "did this reintroduce a gap". Encodes the recurring gaps found in the 2026-11 security review (DATA-894) as concrete checks.
---

# EXP Dashboard — security check

Repo-specific regression guard, modelled on Mshauri's `secure-feature` skill.
Every check below exists because the 2026-11 review (DATA-894,
`docs/security/FINDINGS_TRACKER.md`) found the opposite in this codebase. It
does not replace `/security-review` or a human review of auth changes.

## How to run it

1. List what the change touches (`git diff --stat main...`), and pick the
   sections below that apply. **Say explicitly which ones you skipped and
   why.** Silent skips are how guardrails rot.
2. Run the required checks (section 9). They must all pass.
3. Report back in this format, one line per check:
   `✅ / ❌ / n/a — <check> — <evidence: file:line, test name or command output>`.
   Any ❌ blocks the commit. Fix it, or stop and surface the conflict to the
   user. Never quietly downgrade a rule.

## 1. Sign-in and sessions (EXPSEC-D01, D03, D07)

- [ ] No shared password, PIN or "fallback" login of any kind. `grep -rn "DASHBOARD_PASSWORD\|/api/auth/login\"" backend/app frontend/src` → nothing.
- [ ] No token, login code or magic link in a URL query string, a log line, an exception message or an error response. Tokens travel in the JSON body or the `Authorization` header. Browser redirects use `#login_code=` / `#magic=` **fragments** only.
- [ ] Every new data route depends on `current_user` (or `person_level_user` / an admin dependency built on it). `current_user` validates the server-side session (`store.validate(sid)`) on **every** request. Never trust JWT claims alone, and never cache identity.
- [ ] Access tokens stay short (`ACCESS_TOKEN_SECONDS`, 15 min) and carry `sid` + `typ=access`. New token types get their own `typ`.
- [ ] `SessionMiddleware` uses `settings.session_signing_key`, never `JWT_SECRET` directly. One secret, one job.
- [ ] Google: domain check against `OAUTH_ALLOWED_DOMAIN`, and `email_verified` is not False.

## 2. Access scoping (EXPSEC-D02, D05, D06)

- [ ] Every BigQuery data query applies `access_clause` / `access_clause_fuzzy_cu` for the caller (CLAUDE.md rule), and the cache `scope_key` includes `user.scope_key`.
- [ ] **Person- or school-level detail** (per-mentor rows, observations, free-text comments, school lists, anything with names or IDs) uses `Depends(person_level_user)`. `national_only` users get national aggregates only. Add the new path to `test_national_only_cannot_open_person_level_detail`.
- [ ] Writes check ownership of **what** is written, not just the caller's scope: e.g. a task's `issue_key` must belong to the CU in the body (`_key_matches_cu`). `national_only` never writes.
- [ ] Guests (`user.is_guest`) get exactly one region or CU from their grant and never `has_national`, `is_admin` or `can_manage_access`. Any new privileged flag must be false for guests in `auth.guest_access`. Admin dependencies reject `is_guest`.
- [ ] The access-mapping editor accepts `@{OAUTH_ALLOWED_DOMAIN}` emails only. Everyone else goes through guest access.

## 3. Guest access invariants (plan v1.3 §5)

- [ ] A guest needs **both** approval and the whitelist (`store.guest_status`). Never merge the two.
- [ ] Magic links: single use, 15 min, only a hash stored, redeemed by **POST** from the landing page (never on GET or page load), and a new link invalidates older ones.
- [ ] Unauthenticated endpoints (`/request-access`, `/magic-link`) return the same generic message for every email, do their work on `access_runtime.jobs` (equal timing), and are rate-limited by IP (429) and by email (silent).
- [ ] The access log is append-only via `database.insert_rows`. **No UPDATE/DELETE DML on `raw_exp_dashboard_access_events`, ever.** Grants fail closed if the write fails; removals still apply in memory.
- [ ] Revocation stays scoped to one email and immediate. The 5 `TestRevokeAllFor` tests must pass unchanged. Never weaken them to make a change pass.
- [ ] `app/core/guest_access.py` is shared **verbatim** with the EXP Training Toolkit. Change both copies together, and run both test suites.

## 4. SQL and E!nsight (EXPSEC-D04, D11)

- [ ] No f-string or `.format` of user input into SQL. Use `core/sql.py` helpers and BigQuery params only. Table names come from settings or constants.
- [ ] E!nsight: every guardrail runs on the lexer's tokens, and the SQL executed is the lexer-normalised text. `/export` accepts only server-signed `answer_sig` / per-source `sig`. Any new field that flows back from the browser into a query or document must be signed or re-derived server-side.
- [ ] Generated SQL runs on `ensight_guardrails._bq_client()` (the read-only identity when configured), never on a new client built from the main key.

## 5. Errors, logging, docs

- [ ] `HTTPException` details are user-safe. No BigQuery error text, dataset names, stack traces or emails of other people.
- [ ] Log lines never include tokens, refresh tokens, login codes, magic-link URLs, Authorization headers or request bodies of auth routes.
- [ ] `/docs`, `/redoc` and `/openapi.json` stay behind `ENABLE_API_DOCS` (default False).
- [ ] New routes live in `app/routers/<domain>.py`, under `/api/*` (client-header guard). Never add one to `_HEADER_EXEMPT_PATHS` unless it is a browser redirect target.

## 6. Frontend

- [ ] Tokens live only in `sessionStorage` via `src/lib/api.js`. No `localStorage` for tokens, no PII in storage.
- [ ] Every fetch goes through the api wrapper (client header, refresh-on-401, single in-flight refresh).
- [ ] No `dangerouslySetInnerHTML`. Use `encodeURIComponent` on every user value in a URL.
- [ ] UI hiding is UX only. The backend dependency is the boundary, so it must exist too.

## 7. Secrets and CI (EXPSEC-D10, B03, B04)

- [ ] No credential in code, tests, docs or fixtures. Tests build dummy secrets at runtime (`secrets.token_hex`).
- [ ] `.gitleaks.toml` `[allowlist]` only grows for a **verified false positive**, as narrowly as possible (a regex on the value, not a path). Never add `*.md`, a directory or a test file.
- [ ] A real leak: **rotate first** (Patrick), then remove it, then consider a history rewrite. See `docs/security/SECRETS_RUNBOOK.md`.
- [ ] New GitHub Actions are pinned to a full commit SHA with a `# vX.Y.Z` comment. Downloads are checksum-verified.
- [ ] No `*.json` key files near the Docker build context (`.dockerignore`, `.gitignore`).

## 8. Container and Kubernetes (EXPSEC-D08)

- [ ] The Dockerfile keeps `USER 10001` and `--forwarded-allow-ips` limited to RFC 1918. Never `*`.
- [ ] The deployment keeps `automountServiceAccountToken: false`, `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, drop ALL, and resource limits.
- [ ] `replicas: 1`. The query cache, the access store and the rate limiters are in-process. Don't scale or add `--workers` without moving them to a shared store.
- [ ] A new egress destination needs a NetworkPolicy update (`k8s/backend/networkpolicy.yaml`).
- [ ] New secrets go in `secret.example.yaml` as placeholders, and in the Patrick ticket for the live Secret.

## 9. Required checks (run them, paste the result)

```bash
cd backend && python -m pytest                       # all must pass
gitleaks git --pre-commit --staged --redact -v        # staged changes clean (or: pre-commit run gitleaks)
bash scripts/gitleaks-selftest.sh                     # when .gitleaks.toml changed
cd frontend && npm run lint && npm run build         # when frontend changed
```

If the change touches auth, guest access, scoping or E!nsight, also update
`docs/security/` (the tracker row, and GUEST_ACCESS.md if behaviour changed)
in the same PR.
