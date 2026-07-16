# EXP Programme Dashboard — Frontend Build Spec (React 19 + Vite rewrite)

Source file analyzed: the original `index.html` (single-file app, ~11,455 lines). During this session it was git-renamed to `legacy/dashboard-v1.html` — that is the authoritative source. Line numbers below refer to it. CSS = lines 7–1962 (`<style>`), markup = 1950–2100, JS = 2101–end. Two giant embedded data literals to skip: `DEMO_RAW_DATA` (line 2225, ~5.8MB, one line) and `DEMO_CU_ENTEBBE_T1` (line 2236). These are offline demo fallbacks only — the React app should NOT embed them; it fetches live data.

App identity: title "EXP Programme Dashboard v1.0 - Educate!". `DASHBOARD_VERSION='v1.0'`, `BUILD_DATE='2026-06-06'`. Org: Educate! Uganda. Font: Google **Inter** (weights 400/600/700/800).

---

## 1. Design Tokens

CSS `:root` variables (exact hex):

| Token | Value | Use |
|---|---|---|
| `--educate-red` | `#870101` | primary brand / login btn / logo |
| `--educate-blue` | `#0F6A8C` | accents, links |
| `--educate-yellow` | `#F1A01B` | warning/amber |
| `--educate-grey` | `#666666` | muted text |
| `--educate-green` | `#008148` | success |
| `--educate-navy` | `#0e313e` | header bg, KPI hero bg, titles |
| `--educate-red-light` | `#A03434` | |
| `--educate-blue-light` | `#4D889D` | |
| `--educate-yellow-light` | `#f4b14d` | |
| `--educate-green-light` | `#4F9262` | |
| `--bg-light` | `#f5f7fa` | page background |
| `--white` | `#ffffff` | |
| `--border` | `#e5e9ed` | |
| `--text-dark` | `#2c3e50` | body text |
| `--text-muted` | `#95a5a6` | subtitles |

**RAG (red/amber/green) status palette** used throughout (not in `:root`, hardcoded):
- KPI hero value colors: green `#8FD48A`, amber `#E6C474`, red `#F4A8A0`, blue `#90CAF9` (classes `.kpi-green/.kpi-amber/.kpi-red/.kpi-blue`).
- Insight/takeaway RAG: green `#2e7d5a`/bg `#EEF5ED`, amber `#C38A1F`/bg `#FBF1DD`, red `#C9554A`/bg `#FCF3F1`.
- PB rating segment colors: rating0 `#dc3545` (Not Observed), rating1 `#ffc107` (Poor), rating2 `#20c997` (Good), rating3 `#198754` (Excellent).
- Obs quality: >2.5 green, ≥2.0 yellow, <2.0 red (from `getObsQualityColor`).
- School type tags: O-level `#084298 on #cfe2ff`, A-level `#6f42c1 on #e2d9f3`, Mixed `#0c5460 on #d1ecf1`.
- Mentor/school status tags: New `#856404 on #fff3cd`, Experienced/Renewal `#0c5460 on #d1ecf1` / `#155724 on #d4edda`.

**Key layout dimensions:**
- Header bg `#0e313e`; `.header-top` padding `.7rem 2rem`, flex space-between. Title `h1` 1.15rem/700; subtitle `#B8C7D6` .75rem.
- `.header-select`: translucent white `rgba(255,255,255,.12)`, border `rgba(255,255,255,.2)`, radius 6px, min-width 80px.
- `.content`: padding `2rem 3rem`, `max-width:1800px`, centered.
- `.section`: white card, padding 2rem, radius 12px, shadow `0 2px 8px rgba(0,0,0,.08)`, margin-bottom 2rem. `.section-title` 1.3rem/800 navy; `.section-subtitle` .85rem muted.
- `.score-cards`: grid `repeat(auto-fit,minmax(220px,1fr))` gap 1.5rem. `.score-card` white, top-border 4px (color by `.red/.green/.yellow/.blue`), value 3rem/800.
- `.kpi-hero-strip`: grid `repeat(auto-fit,minmax(185px,1fr))` gap 12px, `max-width:1100px`. `.kpi-hero-card` navy `#0e313e`, radius 12px, min-height 148px, value 36px/800 tabular-nums.
- `.metric-tile`: white bordered tile, badges `.on/.near/.off`; mini bar `.mt-bar-track/.mt-bar-fill`.
- `.view-tabs` bar (navy, padding `0 2rem`), `.view-tab` .82rem/600, active underline `#E6C474`.
- `.nat-tab-bar` (white, bottom border), `.nat-tab-btn` .85rem/600, active navy underline + `#f0f4ff` bg. `.nat-tab-panel{display:none}` / `.active{display:block}`.
- `.breakdown-table`: full width, header gradient `#f8f9fa→#e9ecef`, uppercase .75rem, bottom-border navy; body td padding `1rem .75rem`, rows `cursor:pointer`. `.center` class = centered cell.
- `@keyframes spin` (line 1962) for loading spinner.

---

## 2. App Shell / Layout

**Loading overlay** (`#loadingOverlay`, fixed, gradient `#870101→#0e313e`): "Educate!" wordmark + "EXP Programme Dashboard v1.0", a progress bar `#loadingBar` (width driven by `setLoadingProgress(pct,msg)`), and status text `#loadingMsg`. Shown during data load/refresh.

**Login screen** (`#loginScreen`, gradient bg): card with:
- Logo "EXP Dashboard" / "Educate! Program Monitoring".
- Hidden error message `#errorMessage` ("Access denied. Please check your email address.").
- Form `#loginForm` with a **single `type=email` input** (`#emailInput`, placeholder `yourname@experienceeducate.org`). **Collects email ONLY — no password.**
- Submit button "Access Dashboard".
- Info box: "Enter your email address to access the dashboard. Your access level will be determined based on your role and region."
- On submit: lowercase/trim email → `currentUser={email, access:{...}}` → `showDashboard()`. Access is determined AFTER data + ACCESS_CONFIG load.

**Header** (`.header`, navy):
- Left: `h1` "EXP Programme Monitoring Dashboard" + `#headerSubtitle` (dynamic "National View · 2026 Term 2").
- Right controls (`.header-right`, inline): Year select `#yearSelect` (2026/2025; hidden in CU view), Term select `#termSelect` (Term1/2/3/All), Region select `#regionFilterSelect` (regional users), CU select `#cuFilterSelect`, and CU-view-only sub-filters School Name `#cuSchoolNameFilter` + Mentor Name `#cuMentorNameFilter` + `#cuSubFilterClearBtn` ("✕ Clear"). Then `#userInfo` (email), and three buttons: **"⬇ Export"** (`exportDashboardPDF()`), **"🔄"** refresh (`refreshData()`), **"Logout"** (`logout()`). All `onchange` filters call `renderCurrentView()`.
- Bottom: `#viewTabs` (top-level view tabs, built by `buildViewTabs()`).

**Content area** (`.content`) holds three view containers: `#nationalView`, `#regionalView`, `#cuView` (`.view-content`, only `.active` shown).

**Modals/panels:** `#drillModal` (legacy alert/insight modal), and a Mewaka-style slide-in drill panel `#kpiDrillPanel` + backdrop `#kpiDrillBackdrop` (580px right drawer with breadcrumb `#kpiDrillCrumbs`, title, subtitle, scrollable `#kpiDrillBody`).

**Debug/connection pill** (`#debugPanel`, injected bottom-right): green "🗄 Live" if `window._dataSource==='bigquery'` else red "🎭 Demo", plus "Data as of {date} {time}" from `window._dataLoadedAt`. A "🎭 DEMO MODE" badge is also appended on API failure.

**Print header** `#printHeader` populated only during PDF export.

---

## 3. Views / Tabs

`currentView` ∈ `national | regional | cu`. Top-level tabs built by `buildViewTabs()` depend on role (see §7): national users get ONLY a "National View" tab (they reach regional/CU via drill panel); regional officers get "Regional View" + "CU View"; FOAs get "CU View" only.

### 3A. National View (`renderNationalView`, line 3189)
Inner tab bar (`.nat-tab-bar`, `switchNatTab(id)`) with 4 tabs; each is a `.nat-tab-panel#nat-panel-{id}`:

**Tab `exec` — 📊 Executive Summary**
- `#nationalKeyTakeaways` — `renderNationalKeyTakeaways` (key-takeaways strip: 3–4 RAG-colored insight bullets computed from LEC%, recruitment%, PB%, obs%, best/lagging regions).
- `#nationalScoreCards` — `renderNationalScoreCards`: **6 navy KPI hero tiles**, each `openKpiDrill(metric)`:
  1. **LEC Delivery** = lecsDelivered/lecsExpected % (RAG 80/60). Sub: "{del} of {exp} sessions · {N} LECs this term · {schools} schools".
  2. **Scholar Recruitment** (T1) = recruited/(T1 schools×45) (RAG 95/80).
  3. **Avg Scholars / LEC** = Σlec_scholars(delivered)/Σschools_with_lec(delivered), 1dp (blue).
  4. **PB Quality** = quality_rated/total_rated %; term-sensitive: T1→M1+M2, T2→M3+M4, All→M1–M4 (RAG 80/60).
  5. **Mentor Observation Coverage** = min(observed,active)/active % (RAG 80/50). Sub shows unobserved count + total visits.
  6. **Scholar Retention** = lastLEC_scholars/activated %; projected if last LEC not delivered (RAG 95/80).
- `#nationalTermComparison` — `renderNationalTermComparison`: 4 comparison cards (LEC Delivery, Avg Scholars/LEC, Retention, PB Quality) current-term vs previous term (and vs T1 when on T2), with ↑/↓/→ delta arrows. Uses `getTermMetrics()`.
- `#nationalDynamicInsights` — `renderNationalDynamicInsights` (narrative insight cards w/ deltas via `delta()`).
- 🎓 **Scholar Participation Funnel** `#nationalScholarFunnel` — `renderNationalScholarFunnel`: 4 stat tiles (Recruited, Activated LEC2, T1 Completed LEC5 [T2+ only], Retention lastLEC) + horizontal funnel bars. Recruit target = schools×45.

**Tab `lec` — 📚 LEC Delivery**
- `#lecTabInsights` — tab-level metric tiles + insight strip (`renderTabInsights`, `el_lec`): avg LEC session duration (target 70–90 min), LEC6 %, LEC14 %, avg scholars/school.
- ✅ **Activity Completion & Participation** `#nationalActivityCompletion` (`renderNationalActivityCompletion`): breakdown table by CU/region.
- 📅 **Skills Lab Activity Heatmap** `#nationalSequencing` (`renderNationalSequencing`): LEC × Week grid from `LEC_WEEK_MATRIX[term]`, cells clickable → `drillNationalSequencing(lec,week,lecNum)` / `drillHeatmapCell`. Columns: LEC rows × week columns; cell = #schools.
- 🔍 **Key Insights & Flags** `#nationalKeyInsights` (`renderNationalKeyInsights`): CUs needing attention; rows drill via `drillNationalInsight(idx)`.

**Tab `pb` — 📋 Passbook Quality**
- `#pbTabInsights` — PB tab tiles (T1 M1+M2 %, M1 completion %, T2 M3+M4 %, M3 completion %).
- 📋 **PB Quality by Milestone** `#nationalPBQuality` (`renderNationalPBQuality(data,showAllTerms)`): stacked rating bars per milestone/region; header drills `openKpiDrill('pb_quality')`. Columns include Milestone, Rating 0/1/2/3, Quality Score.
- 📋 **Passbook Milestone Completion** `#nationalPBMilestone` (`renderNationalPBMilestone`): schools completed M1/M2 (or M3/M4).
- 👥 **Group Mentoring Completion** `#nationalGMCompletion` (`renderNationalGMCompletion`): GM sessions/term/school by region; drills `openKpiDrill('gm')`.

**Tab `quality` — 🏅 Programme Quality**
- `#qualityTabInsights` — obs coverage tiles + report timeliness summary.
- 👁️ **Observation Coverage & Quality by Region** `#nationalObservationCoverage` (`renderNationalObservationCoverage`): per-region observed/active + avg score; drills `openKpiDrill('observations')` → region → CU → mentor.
- 👥 **Non-Scholar Participation** `#nationalNonScholarBreakdown` (`renderNationalNonScholarBreakdown`): distribution of schools by non-scholar attendance bucket (0, 1–10, 11–20, 21–30, 31+). Drill `openKpiDrill('non_scholar')`.
- 🎉 **Community Day & 🔬 Skills Day** `#nationalCommunityDay` (`renderNationalCommunityDay`): T1 Community Day / T2 Skills Day delivery by region (Male/Female/attendance).
- 🏛️ **Club Milestones & Business Model Presentation** `#nationalClubMilestones` (`renderNationalClubMilestones`): schools per club meeting milestone + BMP by region.
- 📅 **Activity Report Timeliness** `#nationalReportTimeliness` (`renderNationalReportTimeliness`): Early / On Schedule / 1 Wk Delay / Late / Unscheduled by region. Drill `openKpiDrill('report_timeliness')`. Uses `renderTimelinessBars`/`renderTimelinessLegend`.

*Note:* National sections render on staggered `setTimeout`s (5–220ms) after injecting the panel HTML. Every hidden panel still renders (needed for PDF).

### 3B. Regional View (`renderRegionalView`, line 4667)
Filtered by `#regionFilterSelect`. Single scrolling page (no inner tabs). Sections:
- `#regionalScoreCards` (`renderRegionalScoreCards`): **7 score-cards** — Total Schools, LEC Delivery, Avg Scholars/LEC, Recruitment (T1), PB Quality (T1) M1+M2, PB Quality (T2) M3+M4, Mentor Observations.
- `#regionalIssueSummary` (`renderRegionalIssueSummary`): flagged issues per CU; `viewCUIssues(cu)`.
- ✅ **Activity Completion & Participation** `#regionalActivityCompletion`.
- 📅 **Skills Lab Activity Heatmap** `#regionalSequencing` (`renderRegionalSequencing`): from `LEC_WEEK_MATRIX_REGIONAL.regional[term][region]`; drills `drillRegionalHeatmapCell`, `drillRegionalSequencing`.
- 📊 **CU Performance Breakdown** `#regionalCUBreakdown` (`renderRegionalCUBreakdown`): table columns **Cluster Unit / Recruitment / LEC Coverage / {Community|Skills Day} / GM / PB / Obs. / Quality** — click row → `drillRegionalCU(cu)`. There is also `renderRegionalCUSummaryTable` / `drillRegionalCUDetail`.
- 👁️ **Mentor Observation Coverage by CU** `#regionalObservation` (`renderRegionalObservation`): per-CU observed/active; `drillRegionalObservation(cu)`, `drillRegionalCUPB`.
- 🏛️ **Club Milestones & BMP** `#regionalClubMilestones`.
- 🔬 **Skills Day Attendance** `#regionalSkillsDay` (gender breakdown Male/Female).
- 📅 **Activity Report Timeliness** `#regionalReportTimeliness`.

### 3C. CU View (`renderCUView`, line 4736)
Filtered by `#cuFilterSelect` + optional School Name / Mentor Name sub-filters (substring, case-insensitive). Uses **school-level** data (`schoolData`). If no CU selected → `renderAllCUsOverview` (see below). Sections (stacked; mobile has tabbed mirror via `syncCUMobileTabs`/`switchCUTab`):
- `#cuPriorityAlerts` (`renderCUPriorityAlerts` + `getLECsDueByToday`): schools/mentors needing follow-up; each alert → `openIssueResolution*` (issue tracker).
- `#cuScoreCards` (`renderCUScoreCards`): **7 score-cards** — Total Schools, Recruitment vs Target (T1), LEC Delivery Rate, Avg Scholars/LEC, Schools On Track (≥60% LECs & ≥30 scholars), PB Feedback Quality (T1), Mentor Observations.
- 📅 **School Skills Lab Sequencing** `#cuSequencing` (`renderCUSequencing`): Schools × Weeks grid; cell drill `drillCUSequencingCell(schoolId,week)`.
- ✅ **Activity Completion & Participation** `#cuActivityCompletion` (`renderCUActivityCompletion`): per-school LEC delivery, milestones, participation.
- 🏫 **Schools Behind Schedule** `#cuSchoolsBehind` (`renderCUSchoolsBehind`): lagging schools; drill `drillCUSchool`/`drillSchoolMilestones`.
- `#cuMilestoneReporting` (`renderCUMilestoneReporting`).
- 👨‍🏫 **Mentor Performance** `#cuMentorPerformance` (`renderCUMentorPerformance`): columns Mentor / Status / delivery / Observations; drill `drillCUMentor(mentorId)`.
- 🏛️ **Club Milestones & BMP** `#cuClubMilestones`.
- 🔬 **Skills Day Attendance** `#cuSkillsDay`.
- 📅 **Activity Report Timeliness** `#cuReportTimeliness`.

### 3D. All-CUs Overview (`renderAllCUsOverview`, line 4863) — CU view with no CU selected
4 summary score-cards (Total Schools, Recruitment, LEC Delivery, Mentor Observations) + table **"All CUs — Activity Summary"** with columns:
`Cluster Unit | FOA | Schools | Recruited (rec/target + %) | LECs Delivered (del/exp + %) | {GM label} (hasGM/n) | PB Milestone (hasPB/n) | Quality % | Observed (obs/mentors) | Alerts`, plus a TOTAL row. Each row → `switchToCU(cu)`.

### Drill system
- Slide-in panel (`openKpiDrill(metric)`, `openKpiDrillLEC(n)`, `renderKpiDrillPanel`, `closeKpiDrill`) with breadcrumb stack `kpiDrill.stack`. National metric drills call `_kpiDrillNational` → `_kpiDrillRegion(metric,region)` → `_kpiDrillCU(metric,cu)` → `_kpiDrillCUMentors`. Metrics keyed: `lec_delivery, lec_single, recruitment, avg_scholars, pb_quality, observations, retention, gm, non_scholar, report_timeliness`. Each drill body appends a "How this is calculated" card via `_getMetricDefCard` (from `METRIC_DEFINITIONS`).
- Legacy `#drillModal` + many `drill*` functions (`drillNationalScoreCard`, `drillHeatmapCell`, `drillSchoolType`, `drillMentorStatus`, `drillSchoolStatus`, `drillPBRegion`, etc.).
- Cluster drill: `openClusterDrill()` (schools behind, sorted by maxLecs/week).

---

## 4. Filters & Term Logic

`filterData()` (line 3131) is the central filter:
- Reads `#yearSelect` and `#termSelect`.
- **Source**: CU view → `schoolData` (fallback `cuRawData`); national/regional → `summaryData`.
- **Term**: `all` → all rows for the year; otherwise `row.year==year && row.term==term`.
- **Regional view**: filter by `#regionFilterSelect` (case-insensitive). If regional officer with no selection, restrict to their assigned regions.
- **CU view**: filter by `#cuFilterSelect` (case-insensitive). If FOA with no selection, restrict to assigned CUs.

`TERM_CONFIG` (line 2108) — **term → LEC numbers & milestones**:
```
term1: lecs [1,2,3,4,5],              milestones [1,2], label 'Term 1'
term2: lecs [6,7,8,9,10,11,12,13,14], milestones [3,4], label 'Term 2'
term3: lecs [15,16,17,18,19,20],      milestones [5,6], label 'Term 3'
```
Helpers: `getLECsForTerm`, `getLECLabels` ("LEC n"), `getMilestonesForTerm`, `getTermLabel`.

`autoSelectTerm()` (line 2599): from `summaryData`, find terms with data in order [term1,term2,term3], rebuild `#termSelect` options with **latest term first (selected)** then earlier terms then "All Terms". Also repopulate `#yearSelect` from distinct years (desc).

`populateFilters()` (2903) builds region/CU dropdowns scoped to the user's role. `switchToView(view)` (3000) shows/hides the right filter controls per view (Year hidden in CU view; Region only for regional; CU + School/Mentor sub-filters only in CU view) and re-scopes the CU dropdown to the selected region.

CU-view sub-filters: `populateCUSubFilterDropdowns(viewData)` fills School Name / Mentor Name selects from the current CU's rows; `clearCUSubFilters()` resets them.

**Labels — Skills Day vs Community Day** (`getNonLECActivityLabel(term)`): term2 → "Skills Day", otherwise → "Community Day". `getGMLabel()` → "Group Mentoring (GM)".

---

## 5. Data Model (BigQuery table contract)

Two row levels distinguished by `level` field: `cu` (CU-aggregated → `summaryData`) and `school` (per-school → `schoolData`). The `?view=summary` endpoint returns BOTH, split client-side by `level`. In the demo data both levels carry the SAME wide schema (school rows also populate `school_id/school_name/mentor_id/mentor_name`; CU rows null those). 1754 demo rows across levels; 5 regions (Central/East/North/South/West).

**Shared / identity fields (both levels):**
`level, year, term, region, cu, foa_name, school_id, school_name, mentor_id, mentor_name`

**School composition & MOU:**
`total_target_schools, schools_count_olevel, schools_count_alevel, schools_count_mixed, new_mou_schools_count, renewal_mou_schools_count, climate_action_schools_count, red_schools_count`

**Mentors & activity presence:**
`total_active_mentors, schools_with_awareness, schools_with_infosession, schools_with_recruitment, schools_with_gm, schools_with_community_day, schools_with_skills_day, schools_with_club_meeting_1, schools_with_club_meeting_2, total_club_meeting_attendance, unique_peer_circle_meetings_held, total_peer_circle_attendance`

**Passbook milestones M1–M4** (repeated per milestone m1..m4):
`schools_completed_m{n}, m{n}_total_rated, m{n}_quality_rated, m{n}_quality_rate, m{n}_total_rating_0, m{n}_total_rating_1, m{n}_total_rating_2, m{n}_total_rating_3`

**Recruitment / reporting / sessions:**
`total_scholars_recruited, total_reports_submitted, avg_session_duration_mins, total_count_application_forms, total_count_scholars_applied, total_infosession_attendance, total_infosession_signup_completion`

**Pitch attendance:** `s3_male_pitch_attendance, s3_female_pitch_attendance, s5_male_pitch_attendance, s5_female_pitch_attendance`

**Observations:** `total_mentor_observations, total_observed_mentors, avg_cu_observation_score`

**LEC delivery (per LEC 1–14):**
`schools_with_lec{n}` (n=1..14), `lec{n}_scholars`, `lec{n}_non_scholars`, `lec{n}_max_week`, plus `cu_total_lec_scholars`.

**Report timeliness:** `reports_on_schedule, reports_early, reports_1_week_delay, reports_late, reports_unscheduled`

**School-level-only fields** (from `DEMO_CU_ENTEBBE_T1` / `?view=cu`): `mentor_status, school_status, school_type, activity_report_type, peer_circle_attended, mentor_total_observations, lec{n}_week` (school variant of max_week), and per-school passbook: `pb_milestone, pb_scholars_rating_0..3, pb_total_scholars`.

**Additional fields referenced in code** (must exist in the live schema even if absent from demo): `avg_lec_session_duration, avg_mentor_observation_score, cd_scholar_attendance, cd_non_scholar_attendance, cu_total_milestone_scholars, cu_total_rating_0..3, schools_with_gm1/gm2/gm3, schools_with_pb_milestone, sd_scholar_attendance, sd_male_scholars, sd_female_scholars, sd_total_scholars, sd_total_non_scholars`.

Indexes built by `buildDataIndex()` (2626): `_cuIdx[cu|term]`, `_t1cuIdx[cu]`, `_idx[school_id]`, `_t1idx[school_id]`, plus `LEC_WEEK_MATRIX[term][lecKey][week]=count` and `LEC_WEEK_MATRIX_REGIONAL.regional[term][region][lecKey][week]=count` (built from school rows' `schools_with_lecN` + `lecN_max_week`). `getStaticField(school,field)` falls back to the T1 record when a value is null/0/empty. `getT1Value(cu,field)` reads the T1 CU record.

---

## 6. Computed Metrics (formulas)

From `METRIC_DEFINITIONS` (line 3835) — authoritative labels/formulas/thresholds — plus render code:

| Metric | Formula | Thresholds (G/A/R) |
|---|---|---|
| **LEC Delivery Rate** (`lec_delivery`) | Σ(schools_with_lecN over term LECs) ÷ (total_target_schools × #LECs) ×100 | ≥80 / 60–79 / <60 |
| **Individual LEC Delivery** (`lec_single`) | schools_with_lecN ÷ total_target_schools ×100 | ≥80 / 60–79 / <60 |
| **Scholar Recruitment Rate** (`recruitment`) | total_scholars_recruited(T1) ÷ (total_target_schools ×45) ×100 | ≥95 / 80–94 / <80 |
| **Avg Scholars per LEC** (`avg_scholars`) | Σ lecN_scholars(delivered) ÷ Σ schools_with_lecN(delivered), 1dp | ≥45 / 35–44 / <35 |
| **Passbook Quality Rate** (`pb_quality`) | (m1_quality_rated+m2_quality_rated) ÷ (m1_total_rated+m2_total_rated) ×100 (T1). T2→M3+M4, All→M1–M4 | ≥80 / 60–79 / <60 |
| **PB Quality Score** (`calculatePBQualityScore(r0,r1,r2,r3)`) | (r2+r3) ÷ (r0+r1+r2+r3) ×100 | 70 / 50 (table RAG) |
| **Mentor Observation Coverage** (`observations`) | min(total_observed_mentors, total_active_mentors) ÷ total_active_mentors ×100 | ≥80 / 50–79 / <50 |
| **Scholar Retention** (`retention`) | lec{lastLEC}_scholars ÷ lec2_scholars ×100. If lastLEC=0 → project: avg(scholars/school over last 2 delivered LECs) × total_schools ÷ retBase | ≥95 / 80–94 / <80 |
| **Activation** (funnel) | lec2_scholars ÷ total_scholars_recruited ×100 | — |
| **Avg LEC Session Duration** (`lec_duration`) | AVG(avg_lec_session_duration) across schools | 70–90 on track |
| **Report Timeliness** (`report_timeliness`) | (reports_early + reports_on_schedule) ÷ total_reports ×100 | ≥70 / 50–69 / <50 |
| **Non-Scholar Participation** (`non_scholar`) | %schools with any lecN_non_scholars>0; avg = Σ non_scholars ÷ delivered LEC count; buckets 0/1–10/11–20/21–30/31+ | no formal target |

Helper functions: `formatPercentage(v,total)` = round(v/total×100) (0 if total 0); `getPercentageClass(p)` → high≥80/medium≥60/low; `getTermMetrics(year,term,cuFilter)` returns `{lecPct, avgScholars, recruited, activated, lastLec, lastLecScholars, isProjected, retention, qualityPct}` (recruitment/activation/PB always read T1 rows). `generatePBQualityBar(r0..r3)` renders the stacked rating bar. `delta(cur,prev,unit,decimals)` for term-comparison arrows.

Retention/recruitment always sourced from **term1** rows regardless of selected term (T1 is the static baseline). Recruitment target = **45 scholars/school**. "On Track" schools (CU) = ≥60% LECs delivered AND ≥30 recruited.

---

## 7. Access Control

`ACCESS_CONFIG` shape (loaded from API `accessConfig`, else `buildFallbackAccessConfig()` at line 2318):
```
{ national: [email, ...],
  regional: { 'Central':[emails], 'West':[...], 'South':[...], 'East':[...], 'North':[...] },
  cu:       { 'entebbe':[emails], 'mbarara':[...], ... } }   // CU keys lowercase
```
All emails normalized to trimmed-lowercase. The fallback hardcodes ~15 national users, 5 regions, and ~45 CUs (see lines 2320–2394 for the full lists).

`checkUserAccess(email)` (2398) returns `{hasNational, nationalOnly, regions:[], cus:[]}` resolved in order:
1. Email in `national` list → **hasNational=true**, regions = all region keys, cus = all CUs in data (full access: National tab; regional/CU reached via drill).
2. Email in a `regional[region]` list → **regions=[matched]**, cus = all CUs in those regions.
3. Email in a `cu[cu]` list → **cus=[matched]** (FOA).
4. Any other `@experienceeducate.org` email → **hasNational=true, nationalOnly=true** (National view only; no regional/CU tabs).
5. Unknown email → no access (login error), unless demo/offline with data loaded → temporary full access.

Tab visibility (`buildViewTabs`): hasNational → National tab only; regional (not nationalOnly) → Regional + CU; FOA → CU only. Row-level filtering enforced again in `filterData` and dropdown scoping in `populateFilters`/`switchToView`.

---

## 8. API Contract

`API_URL` = a Google Apps Script `/exec` endpoint (currently `https://script.google.com/macros/s/AKfycbw…/exec`). Two GET calls:

**`GET {API_URL}?view=summary`** → consumed by `loadDataFromAPI()` (2471):
```json
{ "status": "ok",
  "data": [ { "level":"cu"|"school", ...all fields from §5 } ],
  "accessConfig": { "national":[...], "regional":{...}, "cu":{...} } }
```
Client splits `data` by `level` into `summaryData` (cu) and `schoolData` (school); `rawData=summaryData`. Non-"ok" status throws → demo fallback. Missing/empty accessConfig → `buildFallbackAccessConfig()`. On success sets `window._dataSource='bigquery'`, `_dataLoadedAt`, then `autoSelectTerm()` + `buildDataIndex()`.

**`GET {API_URL}?view=cu&cu={NAME}`** → `loadCUData(cuName)` (2569):
```json
{ "status":"ok", "data":[ { school-level rows for that CU } ] }
```
Stored in `cuRawData`. On failure falls back to demo CU data.

`refreshData()` re-runs `loadDataFromAPI()` and re-renders. For the React app: replace with a data layer (React Query/SWR) hitting the same or a new backend; `accessConfig` should come from the server. `setLoadingProgress(pct,msg)` drives the overlay.

---

## 9. Other Behaviors

- **PDF export** (`exportDashboardPDF`, 10344): builds `#printHeader` (title + view/scope + year/term + exporter email + timestamp "Educate! Uganda"), for National forces every `nat-tab-panel` to render + inserts print headers, marks current view `.print-active`, calls `window.print()`, and restores state on `afterprint`. Relies on `@media print` CSS (line 1860). React: replicate via a print stylesheet or a headless PDF service.
- **Issue tracker** (localStorage key `exp_issue_tracker`): `getIssueTracker/saveIssueTracker`, `getIssueKey(cu,category,title)` (lowercased, spaces→`_`), `updateIssueStatus(key,status,notes,user)` appends `{timestamp,status,notes,user}` to a per-issue `timeline` array + `created`/`lastUpdated`, `getIssueStatus(key)` (default `{status:'open',timeline:[]}`). Wired into CU priority alerts via `openIssueResolution*` / `submitIssueResolution`. React: persist to backend or keep localStorage.
- **Status/format helpers:** `getSchoolTypeTag` (O/A/Mixed pills), `getMentorStatusTag` (New/Experienced), `getSchoolStatusTag` (New MOU / Renewal), `getObsQualityLabel`/`Color` (🟢/🟡/🔴 by score), `getGMLabel`, `getNonLECActivityLabel`, `getPercentageClass`, `formatPercentage`, `calculatePBQualityScore`, `generatePBQualityBar`, `renderTimelinessBars`/`renderTimelinessLegend`, `getReportTimelinessSummary`.
- **Deep-linking:** `showDashboard` reads `window.location.hash` (e.g. `#national`) to pick the initial view.
- **Section insight engine:** `buildSectionInsight(type,data,ctx)` + `setSectionTitle(headerId,title,subtitle)` dynamically rewrite section headers with computed narrative summaries.
- **Global state to model in React:** `currentUser {email, access}`, `currentView`, `summaryData`, `schoolData`, `cuRawData`, `rawData`, `ACCESS_CONFIG`, the four `_*Idx` maps, `LEC_WEEK_MATRIX(_REGIONAL)`, `kpiDrill {stack, metric}`, `window._dataSource/_dataLoadedAt`.

---

## React 19 + Vite rewrite notes
- Replace imperative `innerHTML` string-building with components; each `render*` function → a component. Recharts (or similar) for the heatmaps/bars/funnel (see `dataviz` skill).
- Move `TERM_CONFIG`, `METRIC_DEFINITIONS`, RAG palette, and all metric formulas into pure util modules (they are the business logic and must match exactly).
- Data layer: fetch `?view=summary` once (cache), derive `summaryData`/`schoolData` + indexes with `useMemo`; fetch `?view=cu&cu=` on CU selection.
- Auth/access: resolve `checkUserAccess` after data+config load; drive routing (React Router) off `{hasNational,nationalOnly,regions,cus}`; guard views + scope dropdowns.
- Preserve exact column headers (see extracted list) and KPI tile labels/thresholds for parity.
