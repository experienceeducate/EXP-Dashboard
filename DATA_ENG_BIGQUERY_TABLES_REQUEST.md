# BigQuery table request — EXP Programme Dashboard

**Status: resolved.** This originally requested a dedicated `dashboard_app`
dataset (kept below for context), since the service account had zero create
rights on `bronze_exp` / `silver_exp` / `gold_exp` at the time. That's since
changed — the service account now has `bigquery.tables.create` on
`bronze_exp` specifically (still no `bigquery.datasets.create` at the project
level, so it still can't create a brand-new dataset itself). Given that, all
five tables below were created directly in `bronze_exp` rather than waiting
on a separate dataset — see `app/core/config.py`'s `DASHBOARD_APP_DATASET`
(`"bronze_exp"`) and the individual `*_table` properties for the exact
`project.dataset.table` paths the app actually uses. No further action
needed from Data Engineering; kept here as a record of the original ask and
the table schemas.

## Original ask (superseded — see Status above)

1. Create the dataset + four tables below (DDL provided — adjust names/location
   to match your conventions if needed).
2. Grant the dashboard's service account write access **scoped to that
   dataset only** (not project-wide, and not on bronze/silver/gold):
   - **Service account**: `exp-dashboard-srvc-acc@educate-data-warehouse-test.iam.gserviceaccount.com`
   - **Role**: `roles/bigquery.dataEditor` on the new dataset (lets it insert/query
     rows in these four tables; doesn't touch anything else)
3. Reply with the exact `project.dataset.table` paths if they differ from the
   suggested names below — the app's config just needs those four strings.

Originally recommended dataset name: `dashboard_app` (new, dedicated — keeps
this app's operational data separate from the ETL-managed bronze/silver/gold
datasets it only ever reads). Superseded — see Status above.

---

## Table 1 — `raw_dashboard_events`

**Purpose**: usage analytics — who logs in, how, and which views/tabs get
used. One row per event.

| Column | Type | Description |
|---|---|---|
| `event_id` | `STRING` | UUID, generated per event |
| `event_timestamp` | `TIMESTAMP` | Server-side capture time |
| `user_email` | `STRING` | From the authenticated session (JWT) |
| `event_type` | `STRING` | Implemented now: `'page_view'` \| `'session_end'`. Reserved for later: `'login'` \| `'view_change'` \| `'tab_change'` |
| `login_method` | `STRING` | `'google'` \| `'password'` — reserved, not written yet |
| `view` | `STRING` | `'national'` \| `'regional'` \| `'cu'` \| `'guide'` \| `'admin'` — the tab active at the time |
| `tab` | `STRING` | Sub-tab granularity — reserved, not written yet |
| `region` | `STRING` | Reserved, not written yet |
| `cu` | `STRING` | Reserved, not written yet |
| `term` | `STRING` | Reserved, not written yet |
| `year` | `INT64` | Reserved, not written yet |
| `session_id` | `STRING` | Random id minted client-side per page load — groups a user's events into one browser session |
| `duration_seconds` | `INT64` | Set on `session_end` only — elapsed time since the session started, sent via `beforeunload`/tab-hidden |
| `user_agent` | `STRING` | Browser/device string — reserved, not written yet |

```sql
CREATE TABLE `educate-data-warehouse-test.dashboard_app.raw_dashboard_events` (
  event_id          STRING,
  event_timestamp   TIMESTAMP,
  user_email        STRING,
  event_type        STRING,
  login_method      STRING,
  view              STRING,
  tab               STRING,
  region            STRING,
  cu                STRING,
  term              STRING,
  year              INT64,
  session_id        STRING,
  duration_seconds  INT64,
  user_agent        STRING
)
PARTITION BY DATE(event_timestamp)
CLUSTER BY user_email, event_type;
```

First implementation (Admin usage-analytics tab) only writes `event_id`,
`event_timestamp`, `event_type`, `user_email`, `view`, `session_id`, and
`duration_seconds` — the rest are nullable and reserved for the richer
login/tab-level tracking described above, once that's built.

Partitioning by day keeps time-range queries ("logins this week") cheap;
clustering by `user_email, event_type` speeds up the per-user / per-event-type
filtering that usage reports will mostly need.

---

## Table 2 — `raw_exp_dashboard_tasks`

**Purpose**: audit log for the Regional Issues "follow-up" workflow (Regional
View flags issues like LEC clustering, low PB quality, missing recruitment
data, etc.; a programme user can mark one as followed-up with a reason, which
hides it from the flagged list unless the underlying detail changes). This is
currently tracked only in browser `localStorage` — this table lets the
programme team see follow-up history centrally instead of per-browser.

One row **per action** (not one row per issue) — an issue's current status is
whichever row for its `issue_key` has the latest `action_timestamp`. Appending
rather than updating keeps writes to a simple `INSERT`, no `UPDATE`/`MERGE`
needed.

| Column | Type | Description |
|---|---|---|
| `issue_key` | `STRING` | Stable identifier for one issue instance — `cu + issue_type + issue_detail`, lowercased/normalized. A changed detail (e.g. clustering count goes from 4 to 6 schools) is treated as a *new* issue, so it reappears even if the old instance was resolved |
| `region` | `STRING` | Region the issue was flagged in |
| `cu` | `STRING` | Cluster Unit the issue belongs to |
| `issue_type` | `STRING` | e.g. `'LEC Clustering'`, `'Low Observation Coverage'`, `'LEC Behind Pace'`, `'Low PB Quality'`, `'Skills Day Pending'`, `'No Club Meetings'` |
| `issue_detail` | `STRING` | The specific value that made this instance distinct, e.g. `'6 schools with 3+ LECs in one week'` |
| `severity` | `STRING` | `'high'` \| `'medium'` — as flagged at the time |
| `status` | `STRING` | `'open'` \| `'in-progress'` \| `'resolved'` |
| `reason` | `STRING` | Why the issue exists — one of a fixed dropdown (e.g. `'Mentor on leave / unavailable'`, `'Data entry pending'`, `'Already addressed with FOA/mentor'`, `'Other'`) — set when resolving |
| `notes` | `STRING` | Free-text additional detail, optional |
| `user_email` | `STRING` | Who took this action |
| `action_timestamp` | `TIMESTAMP` | Server-side time of this action |

```sql
CREATE TABLE `educate-data-warehouse-test.dashboard_app.raw_exp_dashboard_tasks` (
  issue_key        STRING,
  region           STRING,
  cu               STRING,
  issue_type       STRING,
  issue_detail     STRING,
  severity         STRING,
  status           STRING,
  reason           STRING,
  notes            STRING,
  user_email       STRING,
  action_timestamp TIMESTAMP
)
PARTITION BY DATE(action_timestamp)
CLUSTER BY cu, issue_type;
```

Partitioning by day again keeps recent-activity queries cheap; clustering by
`cu, issue_type` matches how the app will look this up (latest status per
issue key, grouped by CU).

---

## Table 3 — `raw_dashboard_digest_snapshots`

**Purpose**: backs the weekly automated email digest (sent Fridays) —
national/regional/CU-level rollups of the same headline metrics the
dashboard shows, captured once per run so the digest can report a
week-over-week trend ("retention down 3pp vs last week") instead of only a
point-in-time number. One row per `(run_date, level, entity)` — e.g. one
national row, one row per region, one row per CU, each run.

| Column | Type | Description |
|---|---|---|
| `run_date` | `DATE` | The Friday this digest ran |
| `level` | `STRING` | `'national'` \| `'region'` \| `'cu'` |
| `entity` | `STRING` | Region name or CU name; `'—'` for the national row |
| `year` | `INT64` | Programme year |
| `term` | `STRING` | Term scope the snapshot was computed for (`term1`/`term2`/`all`) |
| `lec_delivery_pct` | `FLOAT64` | LEC delivery rate |
| `retention_pct` | `FLOAT64` | Scholar retention rate |
| `pb_quality_pct` | `FLOAT64` | Passbook quality rate (Good/Excellent) |
| `mentor_coverage_pct` | `FLOAT64` | Mentor observation coverage |
| `recruitment_pct` | `FLOAT64` | Scholar recruitment vs. target |
| `open_issue_count` | `INT64` | Count of unresolved Regional Issues flagged at this level (national/region rows only) |
| `created_timestamp` | `TIMESTAMP` | When this snapshot row was written |

```sql
CREATE TABLE `educate-data-warehouse-test.dashboard_app.raw_dashboard_digest_snapshots` (
  run_date            DATE,
  level                STRING,
  entity               STRING,
  year                 INT64,
  term                 STRING,
  lec_delivery_pct     FLOAT64,
  retention_pct        FLOAT64,
  pb_quality_pct       FLOAT64,
  mentor_coverage_pct  FLOAT64,
  recruitment_pct      FLOAT64,
  open_issue_count     INT64,
  created_timestamp    TIMESTAMP
)
PARTITION BY run_date
CLUSTER BY level, entity;
```

Partitioning by `run_date` makes "get last week's snapshot" a single-partition
scan; clustering by `level, entity` matches the digest's own lookup pattern
(most-recent prior row for a given region/CU).

---

## Table 4 — `raw_ensight_audit_log`

**Purpose**: audit log for E!nsight (see `docs/ENSIGHT.md`) — the one feature
that turns a typed question into a generated warehouse query. One row per
question asked, whether it was answered from a dashboard endpoint, from a
generated SQL query, refused, or served from cache. Until this table exists
the write degrades to a logged warning (never a silent swallow, never a
failed request) — see `insert_rows`'s docstring in `app/core/database.py`.

| Column | Type | Description |
|---|---|---|
| `question_id` | `STRING` | UUID, generated per question |
| `event_timestamp` | `TIMESTAMP` | Server-side capture time |
| `user_email` | `STRING` | From the authenticated session (JWT) — always a listed national user |
| `question` | `STRING` | The question as typed |
| `route` | `STRING` | `'dashboard'` \| `'sql'` \| `'refuse'` \| `'cache'` |
| `generated_sql` | `STRING` | The query actually run, if `route = 'sql'`; null otherwise |
| `duration_ms` | `INT64` | Wall-clock time for the whole pipeline call |
| `cached` | `BOOL` | Whether this answer was served from the answer cache |
| `error` | `STRING` | Set when guardrails rejected the query or the pipeline errored |

```sql
CREATE TABLE `educate-data-warehouse-test.dashboard_app.raw_ensight_audit_log` (
  question_id     STRING,
  event_timestamp TIMESTAMP,
  user_email      STRING,
  question        STRING,
  route           STRING,
  generated_sql   STRING,
  duration_ms     INT64,
  cached          BOOL,
  error           STRING
)
PARTITION BY DATE(event_timestamp)
CLUSTER BY user_email, route;
```

Partitioning by day keeps "questions this week" cheap; clustering by
`user_email, route` matches how the audit log will mostly be read (a given
user's history, or how often the `sql` fallback fires).

---

## Table 5 — `raw_exp_access_mapping_events` (added after the above was
already resolved — see Status note at the top)

**Purpose**: audit log for the Admin tab's CU→FOA / Region→PO mapping editor.
One row per add/remove action (not per current assignment) — the current
state for a `(scope_type, scope_key)` is every `user_email` whose latest row
for that pair is `action = 'add'`. A "switch" (reassign) is a `'remove'` row
for the old email plus an `'add'` row for the new one, written together.

| Column | Type | Description |
|---|---|---|
| `event_id` | `STRING` | UUID, generated per event |
| `event_timestamp` | `TIMESTAMP` | Server-side capture time |
| `action` | `STRING` | `'add'` \| `'remove'` |
| `scope_type` | `STRING` | `'regional'` \| `'cu'` |
| `scope_key` | `STRING` | Region name or CU name |
| `user_email` | `STRING` | The FOA/PO email being added or removed |
| `changed_by` | `STRING` | The admin who made the change |

```sql
CREATE TABLE `educate-data-warehouse-test.bronze_exp.raw_exp_access_mapping_events` (
  event_id        STRING,
  event_timestamp TIMESTAMP,
  action          STRING,
  scope_type      STRING,
  scope_key       STRING,
  user_email      STRING,
  changed_by      STRING
)
PARTITION BY DATE(event_timestamp)
CLUSTER BY scope_type, scope_key;
```

---

*All five tables are written to exclusively by the dashboard's FastAPI backend
via the same service account it already uses for reads — no other write
path.*
