# Flow — runtime traces

Step-by-step traces of the important request paths.

## 1. Login (email + shared password)
1. User enters email + password in the SPA login screen.
2. SPA `POST /api/auth/login` with body `{email, password}` and header
   `X-Exp-Client: dashboard-v1`.
3. Client-header guard middleware passes (header present).
4. `auth.login` checks `password == DASHBOARD_PASSWORD` (401 if not).
5. `resolve_access(email)` maps the email → `UserAccess` via `ACCESS_CONFIG`
   (national / regions / cus). No access → 403.
6. `create_token(access)` issues an HS256 JWT carrying `sub=email` and the
   resolved `access` dict, 8-hour expiry.
7. Response `{status:"ok", token, user}`. SPA stores the token in
   `sessionStorage` and renders the dashboard scoped to `user`.

## 2. Login (Google SSO)
1. SPA sends the browser to `GET /api/auth/google/login` (header-exempt path).
2. authlib redirects to Google; user consents.
3. Google redirects to `GET /api/auth/google/callback` (header-exempt).
4. Backend verifies the email domain == `experienceeducate.org` (403 otherwise),
   `resolve_access(email)`, `create_token(...)`.
5. Redirect to `FRONTEND_URL/#token=<jwt>`. The SPA reads the fragment, stores
   the token, and strips the hash.

## 3. Loading the overview (a scoped, cached query)
1. SPA `GET /api/overview/summary?term=term1` with
   `Authorization: Bearer <jwt>` + `X-Exp-Client`.
2. Client-header guard passes; `current_user` decodes the JWT → `UserAccess`
   (401 if invalid/expired, 403 if no access).
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
