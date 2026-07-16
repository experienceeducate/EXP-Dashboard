# Architecture — EXP Programme Dashboard

## C4 (context → containers)

```
Educate! staff (browser)
        │  HTTPS
        ▼
┌─────────────────────────────────────────────────────────┐
│  nginx-ingress + cert-manager (DO Kubernetes, ns=data-ingestion) │
└───────────────┬───────────────────────────┬─────────────┘
     exp-dashboard.…              exp-dashboard-api.…
                │                             │
                ▼                             ▼
   ┌───────────────────────┐     ┌────────────────────────────┐
   │ Frontend (nginx)      │     │ Backend (FastAPI/uvicorn)   │
   │ React 19 + Vite SPA   │────▶│ single process / single pod │
   │ 1 replica             │ JWT │ /api/auth  /api/overview    │
   └───────────────────────┘  +  │ /api/cu    /health          │
                            X-Exp-Client                        │
                                  │  service-account key        │
                                  ▼                             │
                        ┌──────────────────────────────────────┘
                        ▼
              BigQuery: educate-data-warehouse-test
                        .gold_exp.exp_ai_dashboard_model
```

## Component map (backend)
| Module | Responsibility |
|---|---|
| `app/main.py` | App factory: CORS, SessionMiddleware, client-header guard, `include_router`. No handlers. |
| `app/auth.py` | Email+password + Google SSO → JWT (carries access scope); `current_user` dep. |
| `app/core/config.py` | Pydantic Settings; fail-fast on missing secrets. |
| `app/core/cache.py` | In-memory `TTLCache` (512 / 300s). Process-bound. |
| `app/core/database.py` | BigQuery client + `run_query` (the single test seam). |
| `app/core/sql.py` | `build_where`, `term_clause`, `region_clause`, `cu_clause`, `access_clause`, `level_clause`. Parameterised only. |
| `app/core/tables.py` | Table-reference constants. |
| `app/core/access.py` | ACCESS_CONFIG load + `resolve_access(email) → UserAccess`. |
| `app/routers/health.py` | `/health` (unauth, header-exempt). |
| `app/routers/overview.py` | `/api/overview/summary` — CU + school rows, scoped. |
| `app/routers/cu.py` | `/api/cu` — school-level drilldown for one CU. |

## API surface
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/health` | none | `{status:"ok"}` |
| POST | `/api/auth/login` | client-header | `{status, token, user}` (email+password) |
| GET | `/api/auth/google/login` | none (exempt) | 302 → Google |
| GET | `/api/auth/google/callback` | none (exempt) | 302 → `FRONTEND_URL/#token=…` |
| GET | `/api/auth/me` | JWT + header | `{status, user}` |
| GET | `/api/overview/summary?term=` | JWT + header | `{status, data, cu, schools, access}` |
| GET | `/api/cu?cu=&term=` | JWT + header | `{status, data}` |

`user` / `access` shape: `{email, hasNational, nationalOnly, regions:[], cus:[]}`.

## The data model (`gold_exp.exp_ai_dashboard_model`)
One wide "one-big-table". A `level` column distinguishes **CU-aggregated** rows
(`level='cu'`) from **per-school** rows (`level='school'`). Both carry the same
wide schema; school rows populate `school_id/school_name/mentor_id/mentor_name`,
CU rows null them.

**Identity:** `level, year, term, region, cu, foa_name, school_id, school_name,
mentor_id, mentor_name`

**School composition / MOU:** `total_target_schools, schools_count_{olevel,alevel,mixed},
new_mou_schools_count, renewal_mou_schools_count, climate_action_schools_count,
red_schools_count`

**Mentors / activity presence:** `total_active_mentors, schools_with_{awareness,
infosession,recruitment,gm,community_day,skills_day,club_meeting_1,club_meeting_2},
total_club_meeting_attendance, unique_peer_circle_meetings_held,
total_peer_circle_attendance`

**Passbook milestones (m1..m4):** `schools_completed_m{n}, m{n}_total_rated,
m{n}_quality_rated, m{n}_quality_rate, m{n}_total_rating_{0,1,2,3}`

**Recruitment / reporting / sessions:** `total_scholars_recruited,
total_reports_submitted, avg_session_duration_mins, total_count_application_forms,
total_count_scholars_applied, total_infosession_attendance,
total_infosession_signup_completion`

**Pitch attendance:** `s{3,5}_{male,female}_pitch_attendance`

**Observations:** `total_mentor_observations, total_observed_mentors,
avg_cu_observation_score`

**LEC delivery (n=1..14):** `schools_with_lec{n}, lec{n}_scholars,
lec{n}_non_scholars, lec{n}_max_week`, plus `cu_total_lec_scholars`.

**Report timeliness:** `reports_{on_schedule,early,1_week_delay,late,unscheduled}`

**School-only:** `mentor_status, school_status, school_type, activity_report_type,
peer_circle_attended, mentor_total_observations, lec{n}_week, pb_milestone,
pb_scholars_rating_{0..3}, pb_total_scholars`.

See `docs/reference/frontend-spec.md` (if copied in) and the frontend metric
utils for the full formula catalogue. Key derived metrics:

| Metric | Formula |
|---|---|
| LEC Delivery Rate | Σ schools_with_lecN (term LECs) ÷ (target_schools × #LECs) |
| Scholar Recruitment | recruited(T1) ÷ (target_schools × 45) |
| Avg Scholars / LEC | Σ lecN_scholars(delivered) ÷ Σ schools_with_lecN(delivered) |
| Passbook Quality | Σ m{n}_quality_rated ÷ Σ m{n}_total_rated (n by term) |
| Observation Coverage | min(observed, active) ÷ active |
| Scholar Retention | lec{last}_scholars ÷ lec2_scholars |
| Report Timeliness | (early + on_schedule) ÷ total_reports |

Recruitment/retention/PB always read **term1** rows (the static baseline).
