# Flow — runtime traces

Step-by-step traces of the important request paths.

## 1. Login — staff (Google SSO → one-time code → session)
1. Login screen calls `GET /api/auth/config` (public) → `{google,
   guest_sign_in_available}` and shows only the options that work.
2. SPA sends the browser to `GET /api/auth/google/login` (header-exempt path).
3. authlib redirects to Google; user consents.
4. Google redirects to `GET /api/auth/google/callback` (header-exempt).
5. Backend checks the email domain == `experienceeducate.org` and that
   `resolve_access(email)` has any access (else redirect to
   `FRONTEND_URL/#error=domain_not_allowed|no_access|oauth_failed`).
6. `store.issue_login_code(...)` → redirect to
   `FRONTEND_URL/#login_code=<code>` (60 s, single use — never a token in a URL).
7. The SPA reads the fragment once at module load (`api.consumeAuthRedirect`),
   strips it with `history.replaceState`, and `POST /api/auth/session/exchange
   {code}` (with `X-Exp-Client`).
8. Response `{status, token, refresh_token, expires_in: 900,
   session_expires_at, auth_kind: "staff", user}`. SPA stores both tokens in
   `sessionStorage`, then hydrates `user` from `GET /api/auth/me` (which adds
   `authKind`, `sessionExpiresAt`, `accessExpiresAt`).

## 2. Login — guest (request → approve + whitelist → magic link)
1. Guest submits the login screen's "Request guest access" form:
   `POST /api/auth/request-access {email, organization, reason}` → always 202
   with the same generic message (429 if rate-limited).
2. An access manager approves them in **Admin → Guest access** with one region
   or CU and a number of days (`POST /api/admin/guests/approve`, which also
   whitelists by default) — or invites them directly (`/invite`).
3. Guest asks for a link: `POST /api/auth/magic-link {email}` → 202 generic
   message; if approved + whitelisted + email configured, a single-use,
   15-minute link to `FRONTEND_URL/#magic=<token>` is emailed.
4. Opening the link: the SPA strips the fragment immediately, keeps the token in
   memory only, and shows "Sign in to EXP Programme Dashboard" with a **Sign in**
   button. Nothing is redeemed on load (email scanners prefetch links).
5. On click: `POST /api/auth/magic-link/redeem {token}` → the same session
   response (`auth_kind: "guest"`); 400 → generic invalid/expired message and a
   way to request a new link. The header shows "Guest access · ends <date>".

## 2a. Session refresh, 401s and logout
- The access token lives 15 minutes. `lib/api.js` refreshes ~1 minute before
  expiry (while the user is active) and on any 401, through a single in-flight
  `POST /api/auth/session/refresh {refresh_token}`; the response carries a NEW
  refresh token (rotation), and the original request is retried once.
- 409 = the token was rotated moments ago by another tab sharing the session:
  wait ~1 s, re-read the stored refresh token and retry once with it. 400/401
  → sign out ("Your session has ended"). Re-presenting an already-rotated token
  after the grace window revokes the session server-side (theft signal).
- Every request re-validates the session (`current_user` → `store.validate`),
  so revocation, idle timeout (60 min), absolute expiry and a guest's end date
  apply immediately.
- Logout: `POST /api/auth/logout` with the Bearer token revokes the session,
  then the SPA clears `sessionStorage`.

## 3. Loading the overview (a scoped, cached query)
1. SPA `GET /api/overview/summary?term=term1` with
   `Authorization: Bearer <jwt>` + `X-Exp-Client`.
2. Client-header guard passes; `current_user` decodes the JWT, validates its
   server-side session and re-resolves `UserAccess` (401 if invalid/expired/
   revoked, 403 if no access).
3. `overview.summary` calls `_fetch_level('cu', 'term1', user)` and
   `_fetch_level('school', 'term1', user)`.
4. For each: `build_where(level_clause, term_clause, access_clause(user))`
   builds a parameterised WHERE.
   - National user → `access_clause` returns `''` (no restriction).
   - Regional user → `region IN UNNEST(@acc_regions)`.
   - CU user → `LOWER(cu) IN UNNEST(@acc_cus)`.
5. `database.run_query(sql, params, scope_key=<user scope>|<level>|<term>)`.
   - Cache hit (keyed by scope+SQL+params) within 5 min → return cached rows.
   - Miss → submit BigQuery job, cache the result.
6. Response `{status, data: cu+schools, cu, schools, access}`. The SPA derives
   its views/indexes with `useMemo` and renders KPIs/tables/charts.

## 4. CU drilldown
1. User selects a CU. SPA `GET /api/cu?cu=<name>&term=term1`.
2. `_may_access_cu` checks the caller may see that CU (national → any; scoped →
   their CUs/regions), else 403.
3. Query: `level='school' AND LOWER(cu)=@... AND term=@...` (+ region clause for
   regional users), via `run_query`. Cached per scope+cu+term.
4. Response `{status, data:[school rows]}` → CU view renders school breakdowns.

## 5. Deploy (push to main)
1. Push touches `backend/**` and/or `frontend/**`.
2. `deploy.yml` → `changes` job path-filters which images build.
3. Backend: `backend-tests` (pytest) must pass → `deploy-backend` builds + pushes
   `patrickgichini/exp-dashboard-server:{latest,sha}` → `kubectl set image
   ...@sha256:<digest>` → `rollout status`.
4. Frontend: `deploy-frontend` builds with `--build-arg VITE_API_URL=<api host>`
   → push → digest-pin rollout.
5. PRs run tests only (no build/push). gitleaks (`secret-scan.yml`) gates every
   PR and push.
6. Manual `kubectl apply` of any `k8s/**` change resets the image to `:latest` →
   re-run the workflow to re-pin the digest.
