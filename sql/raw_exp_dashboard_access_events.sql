-- Access event log for guest access + server-side sessions (security review DATA-894).
-- Documented in DATA_ENG_BIGQUERY_TABLES_REQUEST.md, Table 6. Idempotent.
-- Append-only (streaming inserts only); the app replays it at start-up, so NO partition expiration.
-- Run:  bq query --use_legacy_sql=false --project_id=educate-data-warehouse-test < sql/raw_exp_dashboard_access_events.sql
CREATE TABLE IF NOT EXISTS `educate-data-warehouse-test.bronze_exp.raw_exp_dashboard_access_events` (
  event_id        STRING    NOT NULL,
  event_timestamp TIMESTAMP NOT NULL,
  event_type      STRING    NOT NULL,
  subject_email   STRING,
  actor_email     STRING,
  session_id      STRING,
  link_id         STRING,
  token_hash      STRING,
  client_ip       STRING,
  details         STRING
)
PARTITION BY DATE(event_timestamp)
CLUSTER BY event_type, subject_email
OPTIONS (description = "EXP Dashboard guest access + session event log (append-only, streaming inserts only). DATA-894.");
