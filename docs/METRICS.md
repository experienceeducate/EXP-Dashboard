# EXP Dashboard Metrics Reference v6.7
**Educate! Uganda · Data & Performance Analytics · July 2026**

> **Repo editor's note (2026-07-16).** This reference originated with the *legacy*
> single-file dashboard (`legacy/dashboard-v1.html`, Google Apps Script proxy,
> GitHub Pages). It is preserved here as the **authoritative catalogue of metric
> definitions, formulas, and RAG thresholds** — those are unchanged and correct.
>
> A few sections describe the *legacy* runtime, not this repo's implementation.
> Where they differ, a `> Repo note:` callout points to the current stack
> (FastAPI backend + React/Vite SPA on DigitalOcean Kubernetes, querying
> `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model` directly):
> - §1 URL and §7.1 "dev/test backend" describe the legacy Apps Script setup.
> - §8 Export PDF and §9 Daily Digest describe legacy behaviour.
>
> **The §7.1 "unverified ASSUMPTION" field names are now RESOLVED** — verified
> against the live table's 158-column schema on 2026-07-16. The gold model is
> already pre-pivoted (no runtime pivot needed); see `docs/DROPPED_SECTIONS.md`
> for the verified field list and the parity gap analysis.
>
> **Versioning policy:** update this file after every dashboard change session.

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| v6.7 | Jul 2026 | **Mentor Quality restructured into 4 sub-tabs (ADR-008 follow-up):** Highlights · LEC Observation · Group Mentoring · Skills Day. **Two more BigQuery sources** (`silver_exp.exp_2026_skills_day_observation_form`, `silver_exp.exp_2026_group_mentoring__observation__form`) — neither has a `cu` column; resolved via a `mentor_id` join to the same bronze roster used for LEC. Both are mid-term survey exports whose live schema can gain/drop columns and change column *type* while submissions are still landing (caught directly: Group Mentoring's Term 2 rating columns vanished from BigQuery mid-build) — guarded with a 10-minute-TTL column-existence cache (`database.get_table_columns()`) so a missing column degrades to `NULL` instead of a hard query error. Group Mentoring normalizes genuinely different Term 1 vs. Term 2 rubrics (Term 1: one generic form; Term 2: GM2 "Create a Product" vs. GM3 "Launch and Make a Sale") into one comparable quality index. **Skills Day qualitative feedback rebuilt on its own theme rules** — reusing LEC's classroom-pedagogy theme set (visual aids, lesson-plan adherence, ISSTUCK facilitation) left ~80% of Skills Day's hands-on product-making comments untagged; a dedicated `SKILLS_DAY_THEMES` set (product/tin quality, entrepreneurship & sales interest, scale-up demand, resource constraints, safety/disruptions, skill mastery) lifted tagged coverage from 21% to 56%. **Highlights sub-tab**: national rollup across all 3 sources, a merged theme summary (each source tagged with its own correct rule set, then combined), a real-quote "Entrepreneurship & scale-up signals" spotlight, and a "Biggest coaching opportunity" callout (the single most-mentioned growth-area theme, with quotes) — plus a comparative quality-index insight across sources. **Bug fix:** Highlights' LEC mentor-coverage stat was computing `SUM(total_mentors_assigned)` over a `LEFT JOIN` to individual observations — a CU with N observations fanned its roster row out N times, inflating the assigned-mentor denominator (2,323 vs. the true 358 every other Mentor Quality endpoint reports). Fixed by computing it as an independent scalar subquery. **UX:** the CU-rankings "Flag" column (`data_quality_flag`: "✓ Adequate data" / "⚠ Low observation count" / etc.) removed from all 3 observation sub-tabs as not realistic at small sample sizes — the Region-breakdown Status column (Exceeding/Meeting/Below Expectations/Ratings Pending) and zero-observation KPI counts are unaffected. |
| v6.6 | Jul 2026 | **Mentor Quality tab (ADR-008):** new 5th National View inner tab, a *second* BigQuery source (`silver_exp.exp_2026_lec_observation_form` + `bronze_exp.mentor_2026`, not `gold_exp`) — mentor observation ratings, rules-based theme tagging of free-text comments, region → CU → mentor ID → individual-observation drill-down. Coverage (assigned vs. observed) sourced from the gold model's `total_active_mentors`/`total_observed_mentors`, not the bronze roster. Term derived from observation date against the fixed 2026 calendar, not the unreliable raw `term` column. **Learning & Measurement Map tab (ADR-009):** new 6th inner tab, static reference content (no BigQuery source) mirroring the EXP 2026 Learning and Measurement Map spreadsheet — 4 pillar sub-tabs, per-metric drill with a live/partial/not-available cross-reference and jump-links into the tabs above where the metric is actually measured. |
| v6.5 | Jul 2026 | **Backend (dev/test only, not yet live):** Local Python/Flask backend (`backend_bigquery.py`) added as a parallel path querying `educate-data-warehouse-test.gold_exp.exp_ai_dashboard_model` directly, replacing the Apps Script proxy that sat in front of the same table. Only `index.html`'s `API_URL` constant changed — GitHub Pages live site is unaffected and still runs on Apps Script. Several v6.4 field names (GM per-session, Club Meeting label, Skills Day/BMP activity type, non-scholar/week fields, milestone pivot, report-timeliness bucket) are unverified ASSUMPTION placeholders pending `bigquery_schema_check.sql` — see §7.1. **Dashboard:** GM 2 and GM 3 score cards (825 fixed target each) added to LEC Delivery tab; combined GM score card restyled as "Group Mentoring (GM) Total" (GM2+GM3/1650, Skills-Labs-Total style). Regional Comparison GM column denominator now term-aware (×1/×2/×3 schools); PB Milestone column split into PB Milestone M3 and PB Milestone M4 for Term 2. CU view Mentor Performance: "CM2" column renamed "CM" with term-aware denominator; "GM" column now shows sessions completed vs. expected, term-aware. CU view Schools Behind Schedule: combined GM and CM2 columns split into per-session/per-meeting GM 2/GM 3 and CM 3/CM 4 (✓/✗), Action Needed lists each individually; wording changed "X LECs missing" → "X LEC Pending". CU view header filters: School Name/Mentor Name became CU-scoped dropdowns, then School ID/Mentor ID hidden entirely, leaving Term/CU/School Name/Mentor Name only — see §11. Two code bug fixes with no metric/definition change: `mentor_total_observations` → `total_mentor_observations` field-name fix; GM per-session term mapping in code corrected to match the already-documented T1=GM1/T2=GM2+GM3 mapping. |
| v6.4 | Jun 2026 | **SQL v3:** GM per-session tracking (GM_1–GM_4 flags + attendance), avg LEC session duration, Skills Day gender disaggregation (sd_male/female_scholars/non_scholars), Club Meeting normalization fixed (CM1 was always 0), Club Meetings 3/4 + Business Model Presentation added. **Dashboard:** GM moved from LEC tab to Passbook tab with per-session regional table. Club Milestones & BMP table added to Programme Quality (National by region, Regional by CU, CU by school with progress bars). Skills Day gender table with completion rate added to Regional + CU views. 3+ LECs clustering drill panel fixed (mechanism aligned to transform/opacity). LEC Delivery tab: added Avg Scholars/LEC, Avg Session Duration, LEC 6, LEC 14 score cards. |
| v6.3 | Jun 2026 | PB Quality split into T1 (M1+M2) and T2 (M3+M4) score cards and drills on Passbook tab. PB Quality drill now reads kpiDrill._pbTerm so T1 card always drills T1, T2 card always drills T2 regardless of global term filter. Observation coverage score cards and insights now use selected term's data (T2 obs campaigns are real). Skills Day drill buttons fixed (were opening LEC Delivery). Community Day drill button fixed. PB Completion drill fixed (was opening PB Quality). GM drill fixed (was opening LEC Delivery). Total Schools made clickable with drill. Skills Day Completion score card added to Programme Quality strip (T2/All only). Non-Scholar score card sub-text shows T1 vs T2 comparison. 3+ LECs clustering insight card now has ⌕ View schools drill showing school/CU/region/max LECs/worst week. Five new metric keys added across all 3 drill levels: gm, community_day, skills_day, pb_completion, total_schools. |
| v6.2 | Jun 2026 | Observation insight wording term-aware. (T1) label on obs KPI card in T2+. National View defaults to Executive Summary on login. GitHub Pages URL corrected in email digest. |
| v6.1 | Jun 2026 | RAG threshold fixes. Observation source fixed to always use T1. PB quality in Term Comparison fixed to T1 M1+M2. Retention as integer. Funnel Activated bar drill corrected. Export PDF async + onafterprint restore. |
| v6.0 | Jun 2026 | Metric definition cards in drill panel. Skills Day sd_ field fix. Header redesign. Tab score cards. |
| v5.0 | Jun 2026 | Mewaka KPI cards, stack drill panel, Key Takeaways, metric tiles. |
| v4.0 | Jun 2026 | 4-tab national view, tab score cards, drill modals. |
| v3.0 | May 2026 | Dynamic insights, LEC clustering, Mentor Observation Coverage. |
| v2.0 | May 2026 | National/Regional/CU structure, AccessConfig RBAC, BigQuery. |
| v1.0 | Apr 2026 | Initial dashboard. |

> **Known/open item (carried from CHANGE_LOG.md baseline, 2026-07-01):** the
> legacy on-page `<title>` and `DASHBOARD_VERSION` constant still read "v1.0".
> **Resolved in this repo:** the React SPA title is "EXP Programme Dashboard —
> Educate!" (no stale version constant).

---

## 1. Dashboard URL

> **Repo note:** the *current* production app is
> **https://exp-dashboard.educateapps.work** (API:
> **https://exp-dashboard-api.educateapps.work**), served by the FastAPI + React
> stack in this repo. The legacy URL below refers to the old Apps Script site.

Legacy: https://educatemetrics.github.io/EXP-Dashboard/ (Google Apps Script proxy).

---

## 2. Metric Definitions

### 2.1 LEC Delivery Rate
- **Formula:** Sum(schools_with_lecN for term) / (total_target_schools × #LECs in term) × 100
- **Source:** current data (term-filtered)
- **Thresholds:** ≥80% G · 60–79% A · <60% R
- T1 = LECs 1–5 · T2 = LECs 6–14

### 2.2 Scholar Recruitment Rate
- **Formula:** total_scholars_recruited (T1) / (total_target_schools × 45) × 100
- **Source:** summaryData term1 always — (T1) badge shown in T2+ views
- **Thresholds:** ≥95% G · 80–94% A · <80% R

### 2.3 Avg Scholars per LEC
- **Formula:** Sum(lecN_scholars delivered) / Sum(schools_with_lecN delivered)
- **Source:** current data, delivered LECs only
- **Thresholds:** ≥45 G · 35–44 A · <35 R

### 2.4 PB Quality Rate (v6.3 — split by term)
- **T1 (M1+M2):** (m1_quality_rated + m2_quality_rated) / (m1_total_rated + m2_total_rated) × 100
  - Source: summaryData term1 always
- **T2 (M3+M4):** (m3_quality_rated + m4_quality_rated) / (m3_total_rated + m4_total_rated) × 100
  - Source: summaryData term2
- **All Terms:** M1+M2+M3+M4 combined across both term rows
- **Passbook tab shows BOTH score cards** — T2 shows "—" until M3/M4 data populates
- **Drill behaviour:** controlled by kpiDrill._pbTerm (set by which card was clicked), NOT the global term filter.
- **Thresholds:** ≥80% G · 60–79% A · <60% R

### 2.5 PB Milestone Completion
- **T1:** schools_completed_m1 / total_target_schools (M1) + schools_completed_m2 (M2)
- **T2:** schools_completed_m3 / total_target_schools (M3)
- Source: term1 rows for M1+M2 · term2 rows for M3
- Passbook tab shows M1 Completed (T1) and M3 Completed (T2) as separate score cards
- **Regional Comparison table (v6.5):** Term 2 shows split **PB Milestone M3** and **PB Milestone M4** columns (each schools_completed_mN / total_target_schools); Term 1/All keep the original single M1 column.

### 2.6 Mentor Observation Coverage (v6.3)
- **Formula:** Min(total_observed_mentors, total_active_mentors) / total_active_mentors × 100
- **Source (v6.3):** uses the SELECTED term's data directly — T1, T2, and All Terms each use their own rows.
- **Thresholds:** ≥80% G · 50–79% A · <50% R
- Min() prevents >100% from data entry errors
- **Field-name bug fix (v6.5):** "not observed" checks were pointing at a non-existent `mentor_total_observations`; corrected to `total_mentor_observations`.

### 2.7 Scholar Retention Rate
- **Formula actual:** lec14_scholars / lec2_scholars (T1) × 100
- **Formula projected:** avg(scholars/school last 2 LECs) × total_schools / lec2_scholars × 100
- Returns integer. Thresholds: ≥95% G · 80–94% A · <80% R

### 2.8 Report Timeliness
- **Formula:** (reports_early + reports_on_time) / total_reports × 100
  - > Repo note: the live column is `reports_on_schedule` (not `reports_on_time`); late buckets are `reports_1_week_delay`, `reports_late`, `reports_unscheduled`.
- **Thresholds:** ≥70% G · 50–69% A · <50% R

### 2.9 Non-Scholar Participation (v6.3)
- **Formula:** schools with any lecN_non_scholars > 0 / total schools
- **Score card sub-text:** shows "T1: X% · T2: Y%" when both terms have data
- Source: schoolData (school-level)

### 2.10 Group Mentoring (GM) (v6.4 — per-session; extended v6.5)
- **Overall:** schools_with_gm / total_target_schools × 100
- **Per-session (v6.4):** schools_with_gm1–gm3 / total_target_schools, with gmN_total_scholars attendance
  - > Repo note: the live table has `schools_with_gm1/gm2/gm3` and `gm1/gm2/gm3_total_scholars` (plus an aggregate `GM_total_scholars`). **There is no `schools_with_gm4` / `gm4_total_scholars`** — GM 4 is inactive, consistent with the note below.
- **Session mapping:** GM_1 = T1 session, GM_2 = T2 session 1, GM_3 = T2 session 2, GM_4 = future
  - T1 shows GM 1 only; T2 shows GM 2 + GM 3. GM 4 remains reserved/inactive.
- **Tab:** Overall summary lives on **Passbook Quality** tab (v6.4)
- **LEC Delivery tab score cards (v6.5):** GM 2 (schools_with_gm2/825) and GM 3 (schools_with_gm3/825) added; combined card is **"Group Mentoring (GM) Total"** (GM2+GM3 against 1650).
- **Regional Comparison table (v6.5):** GM column denominator term-aware — ×1 school (T1: GM1), ×2 (T2: GM2+GM3), ×3 (All).
- **CU view Mentor Performance (v6.5):** "GM" column shows sessions completed vs. expected, term-aware.
- **CU view Schools Behind Schedule (v6.5):** combined "GM" split into **GM 2** / **GM 3** (✓/✗), term-aware.
- Drill: National → Region → CU → School (✓/✗ per school)
- **Thresholds:** ≥80% G · 60–79% A · <60% R

### 2.11 Community Day (T1) / Skills Day (T2) (v6.4 — gender disaggregation)
- **CD:** schools_with_community_day / total_target_schools · attendance: cd_scholar_attendance, cd_non_scholar_attendance
- **SD:** schools_with_skills_day / total_target_schools · attendance: sd_total_scholars (sd_ prefix — NOT sl_)
- **SD Gender (v6.4):** sd_male_scholars, sd_female_scholars, sd_total_non_scholars, sd_male_non_scholars, sd_female_non_scholars
- Skills Day Completion score card shown on Programme Quality strip for T2/All only
- **Skills Day gender table** shown in Regional view (by CU) and CU view (by school)

### 2.12 Average LEC Session Duration (v6.4)
- **Formula:** avg_lec_session_duration (school-level AVG of session_duration for skills_lab records)
- Source: propagated to CU level as AVG of school averages
- Typical value: ~80 mins (median). Raw data has extreme outliers that inflate simple averages.

### 2.13 Club Milestones & Business Model Presentation (v6.4; extended v6.5)
- **Club Meetings 1–4:** schools_with_club_meeting_1 through _4 / total_target_schools
  - CM1 = "Club Meeting" (no number) — fixed in v6.4 SQL (was always 0). CM2/CM3(T2)/CM4(T2).
- **BMP:** schools_with_bmp / total_target_schools (T2 activity — Business Model Presentation)
- **Display:** Table under Programme Quality (National by region; Regional by CU; CU by school).
- **Term scope:** CM1/CM2 all terms; CM3/CM4/BMP T2 and All only
- **CU view Mentor Performance (v6.5):** "CM2" renamed **"CM"**, term-aware denominator (T1=CM1+CM2; T2=CM3+CM4; All=CM1–CM4).
- **CU view Schools Behind Schedule (v6.5):** combined "CM2" split into **CM 3** / **CM 4** (✓/✗), term-aware.
- **Wording (v6.5):** Action Needed text "X LECs missing" → "**X LEC Pending**".

---

## 3. RAG Threshold Summary

| Metric | Green | Amber | Red |
|--------|-------|-------|-----|
| LEC Delivery | ≥80% | 60–79% | <60% |
| Recruitment | ≥95% | 80–94% | <80% |
| Avg Scholars | ≥45 | 35–44 | <35 |
| PB Quality | ≥80% | 60–79% | <60% |
| Observations | ≥80% | 50–79% | <50% |
| Retention | ≥95% | 80–94% | <80% |
| Timeliness | ≥70% | 50–69% | <50% |
| GM | ≥80% | 60–79% | <60% |
| Non-Scholar | No target | — | — |

---

## 4. Drill-Down Architecture

Stack panel (580px right). Every level has "📖 How this is calculated" definition card.

### Drill Levels
| Level | Content |
|-------|---------|
| 1 — National | 5 regions · metric value, RAG badge, CU count, school count |
| 2 — Region | CUs · FOA name, school count, value, alert flag (⚠) |
| 3 — CU | Schools/mentors with per-school detail |

### Metric Keys with Full Drill Support (v6.3)
lec_delivery, lec_single, recruitment, avg_scholars, pb_quality, pb_completion, observations, retention, report_timeliness, non_scholar, gm, community_day, skills_day, total_schools

### Special Drill Behaviours
- **pb_quality:** drill uses kpiDrill._pbTerm (set by clicked card), NOT global term.
- **observations:** uses selected term's data (both T1 and T2 campaigns exist)
- **total_schools:** Level 3 shows school type breakdown (O-level / A-level / mixed)
- **LEC Clustering:** ⌕ View schools drill opens flat table of flagged schools with CU, region, max LECs/week, worst week.

---

## 5. National View Tab Structure

| Tab | Score Cards | Default term source |
|-----|-------------|---------------------|
| Executive Summary | 6 KPI cards | Selected term |
| LEC Delivery | LEC % · Total Schools · Avg Scholars/LEC · Avg Session Duration · LEC 6 · LEC 14 (v6.4) · **GM 2 · GM 3 · Group Mentoring (GM) Total** (v6.5) | Selected term |
| Passbook Quality | PB Quality T1 · PB Quality T2 · M1 Completed · M3 Completed · GM Completion (v6.4) | T1 rows for M1+M2 · T2 rows for M3+M4; GM per-session table |
| Programme Quality | Obs % · Timeliness % · NS % · Skills Day % (T2/All only) · Club Milestones & BMP (v6.4) | Selected term |
| Mentor Quality (v6.6–v6.7, ADR-008) | 4 sub-tabs: **Highlights** (cross-source rollup, merged theme summary, entrepreneurship spotlight, coaching-opportunity callout) · **LEC Observation** (Mentors Observed % · Exceeding/Meeting/Below Expectations · Region breakdown · CU rankings · Session breakdown · theme-tagged comments) · **Group Mentoring** and **Skills Day** (same region/CU/mentor drill shape as LEC, each with its own quality dimensions and theme-tagged comments) | Selected term (LEC/Skills Day: date-derived; Group Mentoring: source `term` column, reliable) |
| Learning & Measurement Map (v6.6, ADR-009) | No score cards — OKR/Learning Agenda reference tab, 4 pillar sub-tabs, static content (`docs/LEARNING_AND_MEASUREMENT_MAP.md`) | N/A (not term-scoped) |

Default on login: Executive Summary inner tab.

> **v6.6–v6.7 note:** Mentor Quality sources 3 *additional* BigQuery tables
> beyond `gold_exp` — `silver_exp.exp_2026_lec_observation_form`,
> `silver_exp.exp_2026_skills_day_observation_form`,
> `silver_exp.exp_2026_group_mentoring__observation__form` — plus the bronze
> mentor roster, none folded into the gold model. See ADR-008 and its
> follow-up. Learning & Measurement Map has no BigQuery source at all — see
> ADR-009.

---

## 6. Scholar Funnel

Recruited → Activated (LEC 2) → T1 Completed (LEC 5, T2+ only) → Retention (LEC 14 or projected)

Drill targets: Recruited → recruitment · Others → retention

---

## 7. Key BigQuery Fields

> **Repo note:** verified against the live 158-column schema on 2026-07-16. The
> table is a wide "one-big-table" with a `level` column (`cu` / `school`). See
> `docs/ARCHITECTURE.md` for the full grouped catalogue and
> `docs/DROPPED_SECTIONS.md` for legacy names that differ or are absent.

| Field | Level | Notes |
|-------|-------|-------|
| schools_with_lecN (N=1–14) | CU | |
| lecN_scholars (N=1–14) | CU | |
| lecN_non_scholars (N=1–14) | School | school-level |
| lecN_max_week (N=1–14) | School | STRING; week for LEC N (clustering) |
| total_target_schools | CU | |
| total_scholars_recruited | CU | T1 |
| lec2_scholars | CU | activation base |
| lec5_scholars | CU | T1 completion |
| lec14_scholars | CU | retention endpoint |
| total_active_mentors | CU | per term |
| total_observed_mentors | CU | per term (T1 and T2 both populated) |
| total_mentor_observations | CU | correct field (see §2.6) |
| avg_cu_observation_score | CU | /3 (legacy called it avg_mentor_observation_score — absent) |
| mN_quality_rated / mN_total_rated (N=1–4) | CU | M1/M2 = T1 · M3/M4 = T2 |
| mN_quality_rate (N=1–4) | CU | FLOAT |
| mN_total_rating_0..3 (N=1–4) | CU | rating distribution per milestone |
| schools_completed_m1..m4 | CU | milestone completion |
| reports_on_schedule / reports_early | CU | on-time |
| reports_1_week_delay / reports_late / reports_unscheduled | CU | late |
| schools_with_community_day | CU | T1 |
| cd_scholar_attendance / cd_non_scholar_attendance | CU | T1 |
| schools_with_skills_day | CU | T2 |
| sd_total_scholars | CU | T2 · sd_ prefix |
| sd_male_scholars / sd_female_scholars | CU | Skills Day gender |
| sd_total_non_scholars / sd_male_non_scholars / sd_female_non_scholars | CU | Skills Day non-scholar |
| schools_with_gm | CU | overall |
| schools_with_gm1 / gm2 / gm3 | CU | per-session (NO gm4) |
| gm1_total_scholars / gm2_total_scholars / gm3_total_scholars | CU | per-session attendance |
| GM_total_scholars | CU | aggregate GM attendance |
| schools_with_club_meeting_1..4 | CU | club meeting milestones |
| schools_with_bmp | CU | Business Model Presentation |
| total_club_meeting_attendance | CU | |
| unique_peer_circle_meetings_held / highest_peer_circle_session_seen | CU | peer circle |
| avg_lec_session_duration / avg_session_duration_mins | CU | session duration |
| schools_count_olevel / alevel / mixed | CU | school-type COUNTS (no per-school type column) |
| new_mou_schools_count / renewal_mou_schools_count | CU | MOU status COUNTS (no per-school status column) |
| climate_action_schools_count / red_schools_count | CU | |
| s3/s5_male/female_pitch_attendance | CU | pitch attendance |
| total_count_application_forms / total_count_scholars_applied | CU | recruitment funnel |
| total_infosession_attendance / total_infosession_signup_completion | CU | info session |
| no_of_skills_labs_attended | CU | |
| mentor_name / mentor_id | School | |
| school_name / school_id | School | |
| foa_name | CU | |

### 7.1 Direct BigQuery backend

> **Repo note — SUPERSEDED.** The v6.5 "dev/test only Flask backend" and its
> unverified field ASSUMPTIONS are now obsolete. This repo ships a production
> FastAPI backend (`backend/app`) that queries the same table directly and is
> **live** at the API host in §1. Every field the app reads is verified against
> the live schema (§7). The assumption table below is retained for history; the
> "Resolved as" column records the actual column.

| Legacy assumed field | Used for | Resolved as (live schema) |
|---|---|---|
| group_mentoring_number (gm1–gm4) | GM session pivot | pre-pivoted: schools_with_gm1/gm2/gm3 (no gm4) |
| club_meeting_label | Club Meeting 1/2/3/4 | pre-pivoted: schools_with_club_meeting_1..4 |
| skills_day (activity type) | Skills Day (T2) | pre-pivoted: schools_with_skills_day |
| business_model_presentation | BMP | pre-pivoted: schools_with_bmp |
| sl_non_scholars, sl_week_number | per-LEC non-scholar / week | lecN_non_scholars, lecN_max_week |
| milestone_number/_total_rated/_quality_rated | M1–M4 pivot | pre-pivoted: mN_total_rated, mN_quality_rated |
| report_timeliness_bucket | timeliness buckets | pre-pivoted: reports_on_schedule/early/1_week_delay/late/unscheduled |

---

## 8. Export PDF
> **Repo note:** the React SPA replicates this via `window.print()` + a print
> stylesheet. Legacy behaviour described below.

All 4 tabs in one PDF. Cycles tabs (80ms wait each), window.print(), onafterprint restore. White KPI cards for readability.

## 9. Daily Digest Email
> **Repo note:** legacy Apps Script feature; not part of this repo.

Script: DashboardDailyDigest.gs · 17:00 EAT trigger · timezone: Africa/Nairobi.

## 10. Role-Based Access
| Role | Views | Scope |
|------|-------|-------|
| National Leadership | National (all 4 tabs) | All regions |
| Regional Officers | Regional + CU tabs | Assigned region(s) |
| FOAs | CU tab only | Assigned CU(s) |

Fallback: @experienceeducate.org domain → national access.

> **Repo note:** enforced **server-side** in this repo (`backend/app/core/access.py`
> + `access_clause` in SQL), unlike the legacy client-side resolution.

## 11. CU View Filters (v6.5)

Current state: only **Term, CU, School Name, and Mentor Name** are visible in the
CU view (School ID / Mentor ID removed 2026-07-13). School Name / Mentor Name are
CU-scoped dropdowns that filter every CU-view table. The Year filter shows on
National/Regional views only.

---
*EXP Dashboard Metrics Reference v6.5 · Educate! Uganda · Data & Performance Analytics · July 2026*
