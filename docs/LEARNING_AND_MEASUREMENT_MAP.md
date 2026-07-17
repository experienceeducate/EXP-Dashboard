# Learning and Measurement Map — Reference

**Source file:** `EXP 2026 Learning and Measurement Map (8).xlsx` (repo root, gitignored —
not committed; a planning artefact, not app data). Sheet used: `Learning and
Measurement Map -`. This doc is a **point-in-time snapshot** (converted 2026-07-18)
of that sheet, restructured for the dashboard's "Learning & Measurement Map" tab
(`frontend/src/data/learningMeasurementMap.js`) and as a standalone reference.

> **This is not BigQuery data.** The spreadsheet is a manually curated OKR/Learning
> Agenda planning doc, **updated by the user monthly** — regenerate
> `learningMeasurementMap.js` every time it changes, don't let this snapshot
> drift (see "Keeping this in sync" below).
>
> OKR objective/KR text (shown alongside the Investment Memo metrics in the
> dashboard) comes from a second reference file, also gitignored:
> `APPROVED_ E! EXP Investment Memo_Jan 2026 (2).pdf` → `frontend/src/data/okrDescriptions.js`.
>
> **8 metrics are "live" with dynamic Term 1 vs. Term 2 numbers** (national +
> region + CU drill), computed by `frontend/src/lib/lmmLiveMetrics.js` from data
> already loaded elsewhere in the app — not by querying BigQuery again. The rest
> show the spreadsheet's own Term 1 Achieved / Mid Year Review narrative
> unchanged, per user decision (no live source exists for those yet).

## Purpose (from the sheet)

> To bridge the gap between our strategic intent and the data systems, ensuring
> every metric tracked has a clear owner, a decision trigger, and a connection
> back to the Investment Memo / Theory of Change.

## Structure

Every row (metric) carries:

| Column | Meaning |
|---|---|
| Strategic Pillar (Anchor) | Top-level grouping — see the 4 pillars below |
| Anchor Traceability | The specific OKR / objective / sub-theme within the pillar |
| Metric / KPI Name | Short name |
| Metric Category | `Performance Management` (are we doing the work?) or `Product Learning` (is the model working?) |
| Learning Question (So What?) | The question this metric answers |
| Metric Definition | Precise definition (numerator/denominator where applicable) |
| Priority Level | P1 / P2 / P3 |
| Baseline / Mid-point Target / End-point Target | Targets across the year |
| Source of Truth for Target | Where the target was approved (IM page, ToC doc, etc.) |
| Data Source | What system/survey/table this is collected from |
| Collection Frequency | Weekly / Termly / etc. |
| Owner | Responsible person/team |
| Decision Trigger (Action if Red) | What changes if the metric goes red |
| Pivot Cycle | When this gets reviewed against the plan |
| Term 1 Achieved / Mid Year Review (Jun 02 2026) | Narrative status, prefixed with an emoji (✅ on track · ⚠ monitor/needs attention · ⏳ pending/in progress · 🔴 critical) |

### The 4 Strategic Pillars

1. **Investment Memo** (13 metrics) — the OKR tree: Product OKRs (Objective 1: KR1/KR2,
   Objective 2: KR1/KR2/KR3), Implementation OKRs (incl. Objective 1: KR1/KR2), Delivery
   OKRs (Objective 1: KR1). **This is the pillar the Investment Memo/OKRs respond to** —
   the dashboard tab groups it by OKR (`Anchor Traceability`), not as a flat list.
2. **Learning Agenda** (4 unique metrics — one row, "Reduction in the average learners in
   class", is duplicated verbatim in the source sheet and deduped here) — open questions
   the programme is actively testing: class size, mentor transport/refund app, FOA
   supervision capacity, SBC (club) formation.
3. **Product Health Metrics** (4 metrics) — the standing operational health dashboard:
   mentor input quality, scholar engagement (activation/retention), scholar behavior
   (SBC project participation).
4. **Theory of Change** (15 metrics) — the 2026 ToC's tracked assumptions (`Product TOC
   2026 Draft`), labelled P1–P5 / M1–M4 / E2–E3 / PR1–PR4 in the source doc.

## Cross-reference: what's live in the dashboard today

The dashboard has two BigQuery sources: `gold_exp.exp_ai_dashboard_model` (the
"gold model" — see `docs/METRICS.md` §7 and `docs/ARCHITECTURE.md` for the full
field catalogue) and, since the Mentor Quality tab (ADR-008), the mentor
observation source (`silver_exp.exp_2026_lec_observation_form` +
`bronze_exp.mentor_2026`). Status legend: **Live** (real BigQuery number, already
or newly surfaced), **Partial/Proxy** (a related field stands in for the exact
ask), **Not available** (survey/RCT/qualitative — not in BigQuery).

### Investment Memo

| Metric | Status | Notes |
|---|---|---|
| 36,000 scholars recruited and activated | **Live** | `total_scholars_recruited`, `lec2_scholars` — Executive Summary Scholar Funnel (METRICS.md §6, §2.2) |
| Milestone Quality Rate | **Live** | `mN_quality_rated`/`mN_total_rated` — Passbook Quality tab (§2.4) |
| Passbook Feedback Rate | **Live** (proxy) | No direct "feedback received" field; per user decision, live Term 1 vs. Term 2 proxy = scholars completing passbook milestones (MAX of the term's two milestone `_total_rated` counts, not summed — summing double-counts) ÷ scholars activated (LEC2) |
| Scholar LX NPS | Not available | Termly Scholar Centricity Survey — not in BigQuery |
| Admin Satisfaction NPS | Not available | Patron/Admin Feedback Survey (external Google Sheet, linked in Notes) |
| Scholar Perceived LX Usability Rate | Not available | Scholar Centricity Survey |
| Patron Quality Mentor Rating | Not available | Patron Feedback Survey (admin-rated; distinct from the FOA-rated observation source) |
| Growth Mindset / Agency Experiment Completion | Not available | RCT (810 treatment / 810 control), external |
| Micro-Intervention Test + Agency Drivers Research | Not available | Qualitative outcome harvesting |
| ≥3 validated TOC assumptions | Not available | Derived/qualitative synthesis |
| % Change in Frontline Hallmark Index | Not available | Staff brand-hallmark survey |
| Culture Rating Quality | Not available | Mentor Culture Assessment tool — a *different* rubric ("meeting/exceeding/below expectations") from the Mentor Quality tab's 1–3 facilitation scores; not the same data |
| Improvement in Team Culture/Performance Index | Not available | Staff survey, pre/post restructure |

### Learning Agenda

| Metric | Status | Notes |
|---|---|---|
| Reduction in average learners in class | **Live** | `lecN_scholars` / `schools_with_lecN` (school + CU level) — Avg Scholars/LEC already on LEC Delivery tab (§2.3); per-school >60-scholar buckets computable from `schoolData` |
| Mentor Refund Processing Time | Not available | Refund app logs + Budget-vs-Actual — finance systems, not BigQuery |
| **FOA Supervision Coverage Rate** | **Live** | Best-covered metric in the map — gold model `total_active_mentors`/`total_observed_mentors` (§2.6) **and** the new Mentor Quality tab's per-mentor/per-CU drill (ADR-008) both answer this directly |
| SBC Structural Readiness Rate | **Live** (proxy) | No 3-element (leadership + schedule + enrollment) tracking; live Term 1 vs. Term 2 proxy = Community Day (T1) / Skills Day (T2) completion rate, `schools_with_community_day`/`schools_with_skills_day` ÷ `total_target_schools` |

### Product Health Metrics

| Metric | Status | Notes |
|---|---|---|
| **Mentor Facilitation Quality Rate** | **Live** | Direct match — Mentor Quality tab's 6-dimension scores + Exceeding/Meeting/Below Expectations buckets (ADR-008); gold model's `avg_cu_observation_score` as a coarser cross-check |
| Scholar Activation Rate | **Live** | `lec2_scholars`/`total_scholars_recruited` — Executive Summary funnel |
| Scholar Retention Rate | **Live** | `lec14_scholars`/`lec2_scholars` — Executive Summary funnel (§2.7) |
| SBC Scholar Project Participation Rate | **Live** (proxy) | Per-scholar club participation % not tracked; live proxy = Community Day (T1) / Skills Day (T2) scholar attendance ÷ scholars activated |

### Theory of Change

| Metric | Status | Notes |
|---|---|---|
| % scholars with no baseline income | Not available | Baseline survey |
| LEC attendance rate + passbook completion rate | **Live** | `schools_with_lecN` + PB completion fields — LEC Delivery / Passbook Quality tabs |
| Hope Scale score (treatment vs. control) | Not available | Growth Mindset RCT |
| Soft skills composite | Not available | Baseline/endline survey |
| All primary metrics disaggregated by gender | **Live** (partial) | Gender fields exist for Skills Day (`sd_male/female_scholars`) and pitch attendance but **not** on general scholar records — matches the sheet's own flagged gap. Live proxy shows the Skills Day (T2) gender split; Term 1 (Community Day) has no gender field at all |
| Business model quality score (rubric) | Not available | LEC assessment rubric, T2/T3 |
| Mentor coaching behavior score (coaching vs. checklist mode) | **Partial** | Related but distinct from the Mentor Quality tab's 1–3 numeric scores — no resolver (the categorical rating itself isn't fielded), but the tab links through to the closest available data |
| Mentor mindset score | Not available | BML probe items, not yet fielded |
| Brand hallmark survey score | Not available | Same staff survey as the Investment Memo Hallmark Index |
| Role clarity index | Not available | Staff survey, pre/post restructure |
| Earn-save-act + soft skills dual tracking | **Partial** | Endline survey not in BigQuery; PB Quality + Scholar Retention (both live elsewhere in this map) serve as in-program proxies, per the sheet's own text |
| Scholar centricity survey admin/action rate | Not available | Survey not yet administered as of T1 |
| Club leadership activity + non-scholar engagement | **Live** (Part B only) | Non-scholar engagement — `lecN_non_scholars` (school-level), live Term 1 vs. Term 2 % of schools with any non-scholar attendance; Part A (club-visit-to-milestone correlation) not formally linked |
| Session duration fidelity % | **Live** (proxy) | Live **median** (not mean — `avg_session_duration_mins` has extreme per-CU outliers that blow up a simple average, see METRICS.md §2.12) session duration, plus share of CUs whose own average falls in the 75–85 min window as a fidelity proxy |
| Gender-disaggregated agency scores at endline/follow-up | Not available | T+6m follow-up survey (2027) |

**Rough tally:** ~14 metrics fully live, ~2 partial (related-but-not-exact data,
linked through rather than computed), ~20 not available (mostly surveys, RCTs,
and qualitative synthesis work that sits outside BigQuery by design).
That imbalance is expected — the Learning Agenda and Theory of Change pillars are
deliberately testing things the delivery pipeline doesn't measure on its own.

## Keeping this in sync

**The user updates the source spreadsheet monthly.** When a new version shows
up in the repo root (same filename, or a new numbered copy), refresh this
content — don't let the dashboard tab drift from the current map:

1. Re-open `EXP 2026 Learning and Measurement Map (8).xlsx` (or its successor
   file) and re-export the `Learning and Measurement Map -` sheet's data rows.
2. Regenerate `frontend/src/data/learningMeasurementMap.js` from the new rows
   (same column mapping as this doc's table above). Re-run the same
   `liveStatus`/`jumpTab` overlay for any metric ids that didn't change; decide
   fresh for new/renamed metrics.
3. If the Investment Memo itself is revised, re-transcribe
   `frontend/src/data/okrDescriptions.js` from the new PDF.
4. Update this doc's cross-reference tables if metric definitions or data
   sources changed, and bump the snapshot date at the top.
5. If a newly-added metric can now be computed from BigQuery, add a resolver
   to `frontend/src/lib/lmmLiveMetrics.js` and flip its `liveStatus` to `live`.

There's no automated pipeline for this — it's a manual, monthly refresh, not
a per-request query (unlike the two BigQuery sources).
