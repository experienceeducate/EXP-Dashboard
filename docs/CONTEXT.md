# Context — living project state, quirks & gotchas

Update this as the project evolves. It captures what isn't obvious from the code.

## Current state (2026-07-16)
- Migrated from a single-file HTML app (`legacy/dashboard-v1.html`) to a
  FastAPI + React/Vite two-container stack per the prod-readiness handover guide.
- Data source switched from a Google Apps Script endpoint to BigQuery
  `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model`.
- Second data source added (ADR-008): mentor observation/roster data from
  `silver_exp.exp_2026_lec_observation_form` + `bronze_exp.mentor_2026`, served
  by `app/routers/mentor_quality.py`. Not part of the gold model yet — CU-name
  spellings and term format differ from `gold_exp`, handled via
  `access_clause_fuzzy_cu`/`cu_clause_fuzzy` (`core/sql.py`). See ADR-008 for
  the full list of quirks before touching that router.
- Backend: implemented and unit-tested (auth, access scoping, client-header
  guard, overview + CU + mentor-quality routers). Frontend: React rewrite in
  progress.
- Chat widget: intentionally not included (ADR-003).

## Frontend coverage (React rewrite parity vs. legacy)
The React app reproduces the core of `legacy/dashboard-v1.html`. What's built vs.
deferred as of the rewrite:

**Built:** design system + tokens; login (email+password); header with all
filters; access-driven view tabs; the full `lib/` metric formulas; National view
all 4 inner tabs' **primary** sections (6 KPI heroes, term comparison, scholar
funnel, activity completion, Skills-Lab heatmap, PB Quality by milestone with
rating bars, GM completion, observation coverage, non-scholar buckets, report
timeliness); Regional view (7 score cards, CU breakdown, obs coverage,
timeliness); CU view (7 score cards, All-CUs overview, activity completion,
mentor performance); a single-level drill panel with metric definitions; PDF
export via `window.print()`; refresh; logout.

**Deferred (render a labeled "Coming soon" placeholder, not a crash):** National
"Key Insights & Flags" CU list, PB Milestone Completion table, Community/Skills
Day, Club Milestones/BMP, sequencing narratives; Regional Skills-Lab heatmap,
issue summary, club/skills-day sections; CU priority alerts, school sequencing
grid, schools-behind, milestone reporting, club/skills-day/timeliness, the mobile
tab mirror; multi-level drill (region→CU→mentor collapsed to one level); the
localStorage issue tracker. These are follow-ups — track before calling parity complete.

**Recalculation analysis:** `docs/DROPPED_SECTIONS.md` maps every deferred section
to the BigQuery fields behind it — 16/16 are recalculable from the existing
158-column model (front-end-only work). Genuine gaps: the issue tracker (user
state, not data), per-row school-type/MOU/mentor-status tags (columns absent), and
GM 4 (inactive). Metric formulas/thresholds live in `docs/METRICS.md`.

**Verified end-to-end (2026-07-16):** deployed to prod and confirmed live —
login → `/api/overview/summary` returned 46 CU + 825 school rows from BigQuery;
both hosts serve over HTTPS. A full browser click-through of the rendered React
charts against live data is the remaining nice-to-have check.

## The single-process invariant (most important constraint)
The query cache (`core/cache.py`, `TTLCache` maxsize 512 / TTL 300s) is
**in-memory and process-bound**. **Do not** add replicas or run
`uvicorn --workers`. With multiple processes, a cache hit could land on a process
that never saw the entry. To scale horizontally, move the cache to Redis first.
Single replica per service; **pod restart is the recovery path.**

## Quirks & gotchas
- **`database.run_query` is the test seam.** Routers call it as
  `database.run_query(...)` via the module object. A by-value
  `from app.core.database import run_query` would bypass the test monkeypatch —
  don't do it.
- **Config fails fast.** Missing `JWT_SECRET` / `DASHBOARD_PASSWORD` /
  `GOOGLE_SERVICE_ACCOUNT_KEY` raises at import → crash-loop with a clear message.
- **`cachetools` is pinned to 5.x**, not 6.x — 6.x conflicts with
  `google-auth`'s dependency range. Keep it pinned.
- **Access config** lives in `core/access.py` (`_build_fallback_access_config`,
  ported verbatim from the legacy `buildFallbackAccessConfig()` — ~15 national
  users, 5 regions, ~45 CUs). Override at deploy time with `ACCESS_CONFIG_PATH`
  pointing at a JSON file. Any `@experienceeducate.org` email not in a list gets
  National-view-only access; non-domain emails get nothing.
- **`term` is a string column** (`term1`/`term2`/`term3`), validated against
  `VALID_TERMS` before it reaches SQL. `'all'`/absent means no term filter.
- **Windows dev:** run uvicorn without `--reload` (it can crash).
- **Vite env footgun:** use `frontend/.env.local`, never `frontend/.env` — a
  stale `.env` has previously made local dev silently hit prod.

## Deployment notes
- **CI does NOT reconcile k8s manifests.** `deploy.yml` only does
  `kubectl set image ...@sha256:<digest>`. Anything under `k8s/**` (env vars,
  ingress, Secret keys, limits) must be `kubectl apply`-ed manually — and
  applying resets the image to `:latest`, so **re-trigger the workflow afterward
  to re-pin the digest.**
- Ordering when a deployment env var depends on a new Secret key:
  (1) apply `secret.yaml`, (2) apply the deployment, (3) re-run the workflow.
- `secret.yaml` is gitignored (`*secret.yaml`); `k8s/backend/secret.example.yaml`
  is the template. The GCP SA key lives ONLY in a k8s Secret
  (`exp-dashboard-gcp-key`, field `key.json`), mounted at `/var/secrets/gcp/key.json`
  — never in an image layer, never committed. NB: the namespace also has a shared
  `gcp-service-account-key` secret used by other apps (different field name); we
  deliberately use our own dedicated secret instead.
- Cluster secrets in use: `exp-dashboard-credentials` (envFrom) and
  `exp-dashboard-gcp-key` (mounted). Both were created via `kubectl create secret`
  during the first bootstrap.
- gitleaks (`secret-scan.yml`) hard-fails on any finding — the authoritative gate.

## Known limitations (accepted for the pilot)
- Shared guest password; JWT in `sessionStorage`; `JWT_SECRET` also the OAuth
  session key (ADR-004).
- No horizontal scaling (ADR-001). No per-row auth beyond region/CU scoping.
