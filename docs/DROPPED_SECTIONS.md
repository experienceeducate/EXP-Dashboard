# Dropped / Deferred UI Sections — Recalculation Analysis

**Date:** 2026-07-16 · **Context:** the React rewrite (`frontend/src/`) reproduced
the *primary* sections of every view but deferred several secondary ones with
"Coming soon" placeholders (listed in `docs/CONTEXT.md` → Frontend coverage).
This document answers: **can each be recalculated from the BigQuery table, or is
it genuinely gone?**

## TL;DR

**Almost all of it is recalculable.** The source table
`educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model` is a **pre-aggregated
gold model** (verified: **158 columns**, 2026-07-16). Nearly every dropped section
was computing from fields that already exist in the table — the legacy HTML just
did the arithmetic in the browser. Re-implementing them in React is a
front-end-only effort; **no new SQL, no backend change** is required for them
(the `/api/overview/summary` and `/api/cu` endpoints already return every column).

**Only three things are genuinely NOT derivable from this table** (see §3):
1. The **issue tracker** (user-entered resolution notes — not data).
2. Per-**row** categorical tags: school type (O/A/Mixed), MOU status (New/Renewal),
   mentor status (New/Experienced) — those per-record columns don't exist; only
   CU-level **counts** do.
3. **GM 4** — no `schools_with_gm4` column (inactive by design; GM1–3 only).

---

## 1. How this was verified
Queried `gold_exp.INFORMATION_SCHEMA.COLUMNS` through the live backend pod →
158 columns. Cross-checked every deferred section's required fields against that
list. The v6.5 reference's "unverified ASSUMPTION" field names (METRICS.md §7.1)
are now resolved — the model is pre-pivoted, so the assumed runtime-pivot columns
(`group_mentoring_number`, `club_meeting_label`, `milestone_number`,
`report_timeliness_bucket`, …) are unnecessary.

## 2. Deferred sections — recalculable from BigQuery?

| # | View · Section | Recalc? | Fields / formula | Notes |
|---|---|---|---|---|
| 1 | National · Key Insights & Flags (3+ LECs/week clustering) | ✅ Yes | `schools_with_lecN`, `lecN_max_week` (school rows) | Cluster = schools with ≥3 LEC max-weeks equal. Pure derivation. |
| 2 | National · PB Milestone Completion table | ✅ Yes | `schools_completed_m1..m4` ÷ `total_target_schools` | METRICS §2.5 |
| 3 | National · Community Day / Skills Day | ✅ Yes | `schools_with_community_day`, `cd_scholar_attendance`, `cd_non_scholar_attendance`, `schools_with_skills_day`, `sd_total_scholars`, `sd_male/female_scholars`, `sd_*_non_scholars` | METRICS §2.11 |
| 4 | National · Club Milestones & BMP | ✅ Yes | `schools_with_club_meeting_1..4`, `schools_with_bmp` ÷ `total_target_schools` | METRICS §2.13 |
| 5 | National/Regional · Skills-Lab heatmap (LEC × week) | ✅ Yes | `schools_with_lecN`, `lecN_max_week` | Grid of school counts per (LEC, week). |
| 6 | Regional · Issue Summary | ✅ Yes (computed) | derived from RAG thresholds over CU rows | Not stored data — a threshold rollup. |
| 7 | Regional · Activity Completion table | ✅ Yes | `schools_with_awareness/infosession/recruitment/gm/...` | Same fields as the National version. |
| 8 | Regional · Skills Day gender table | ✅ Yes | `sd_male/female_scholars`, `sd_*_non_scholars` | |
| 9 | CU · Priority Alerts | ✅ Yes (computed) | `schools_with_lecN`, `lecN_max_week`, `total_mentor_observations` per school | "LECs due / not observed" rollups. Resolution *notes* are separate — see §3.1. |
| 10 | CU · School Sequencing grid | ✅ Yes | school-level `lecN_max_week`, `schools_with_lecN` | Per-school × week grid. |
| 11 | CU · Schools Behind Schedule | ✅ Yes | `schools_with_lecN`, `schools_with_gm1..3`, `schools_with_club_meeting_*` | Split GM 2/3 & CM 3/4 columns (v6.5) all backed by real columns. |
| 12 | CU · Milestone Reporting | ✅ Yes | `schools_completed_mN`, `mN_*` | |
| 13 | CU · Club Milestones / Skills Day / Report Timeliness | ✅ Yes | as rows 4/8 + `reports_*` | |
| 14 | Drill · region→CU→mentor (multi-level) | ✅ Yes | aggregate school rows by `mentor_id`/`mentor_name` | Mentor level = group school rows; all metric fields present. |
| 15 | CU · Mobile tab mirror | ✅ Yes (UI only) | n/a | Pure layout; no data dependency. |
| 16 | CU · Mentor Performance (GM/CM term-aware columns) | ✅ Yes | `schools_with_gm1..3`, `schools_with_club_meeting_1..4`, `total_mentor_observations` | Denominators = schools attached to mentor. |

**Bottom line:** 16/16 deferred *display* sections are recalculable from the
existing columns. The gaps are narrower than the section list — they're specific
**columns/badges within** some sections, plus the issue tracker (§3).

## 3. Genuine gaps — NOT derivable from this table

### 3.1 Issue tracker (localStorage `exp_issue_tracker`)
User-entered resolution state (status, notes, timeline, author) attached to CU
priority alerts. **Not data** — it's workflow state the legacy app kept in the
browser's localStorage. Options:
- **Keep it client-side** (localStorage), same as legacy — zero backend work, but
  not shared across users/devices.
- **Add a small backend store** (a new BigQuery/Firestore table + `/api/issues`
  routes) — shared + auditable. Recommended if issue tracking matters
  operationally. Would be a new ADR.

### 3.2 Per-row categorical tags (school type / MOU status / mentor status)
The legacy UI rendered per-**school** pills — O-level/A-level/Mixed
(`school_type`), New MOU/Renewal (`school_status`), and per-**mentor** New/
Experienced (`mentor_status`). **Those per-record columns do not exist** in the
table. What exists is CU-level **aggregate counts**:
`schools_count_olevel/alevel/mixed`, `new_mou_schools_count`,
`renewal_mou_schools_count`. So:
- ✅ CU-level type/MOU **distributions** (e.g. "8 O-level · 6 A-level · 1 Mixed") — recalculable.
- ❌ A pill on an individual school/mentor row — **not** recalculable from this table.
  Would require adding `school_type` / `school_status` / `mentor_status` columns to
  the gold model upstream (a data-engineering change, not a dashboard change).

### 3.3 GM 4
No `schools_with_gm4` / `gm4_total_scholars` columns. Consistent with METRICS §2.10
("GM 4 reserved/inactive"). GM 1–3 are fully present. No action unless GM4 is
activated upstream later.

## 4. Legacy field name → live column (corrections)
Legacy code / v6.5 doc referenced these names; use the live equivalents:

| Legacy name | Live column | 
|---|---|
| `avg_mentor_observation_score` | `avg_cu_observation_score` |
| `reports_on_time` | `reports_on_schedule` |
| `reports_week1_delay` | `reports_1_week_delay` |
| `sd_scholar_attendance` | `sd_total_scholars` |
| `schools_with_pb_milestone` | `schools_completed_mN` |
| `cu_total_rating_0..3` | Σ `mN_total_rating_0..3` across milestones |
| `cu_total_milestone_scholars` | *absent* — derive from `mN_total_rated` if needed |
| `mentor_total_observations` | `total_mentor_observations` (fixed in v6.5) |
| `lecN_week` (school) | `lecN_max_week` |

## 5. Bonus — live columns the legacy UI never used (new-section opportunities)
The gold model carries fields no dashboard version surfaced. Candidates for
*new* sections (no SQL work needed):
`s3/s5_male/female_pitch_attendance` (pitch attendance), `total_count_application_forms`,
`total_count_scholars_applied`, `total_infosession_attendance`,
`total_infosession_signup_completion` (a fuller recruitment funnel),
`no_of_skills_labs_attended`, `highest_peer_circle_session_seen`,
`unique_peer_circle_meetings_held`, `climate_action_schools_count`,
`red_schools_count`.

## 6. Recommendation
1. **Re-implement the 16 deferred sections in React** — front-end only, using the
   columns already returned by `/api/overview/summary` + `/api/cu`. Suggested
   priority: CU Priority Alerts + Schools Behind (operational) → Club Milestones &
   BMP + Skills/Community Day (reporting) → heatmaps/sequencing → drill depth.
2. **Decide the issue tracker's home** (localStorage vs. new backend store) — the
   only item needing a design decision (§3.1).
3. **Escalate the per-row tags** (§3.2) to data engineering if per-school
   type/MOU/mentor pills are required — they need new source columns.
4. Treat §5 as backlog for value-add sections once parity is reached.
