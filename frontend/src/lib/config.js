// ─────────────────────────────────────────────────────────────────────────────
// Design tokens, RAG palette, TERM_CONFIG and METRIC_DEFINITIONS.
// Pure data ported from the legacy single-file dashboard (spec §1, §4, §6).
// ─────────────────────────────────────────────────────────────────────────────

export const DASHBOARD_VERSION = 'v1.0';
export const BUILD_DATE = '2026-06-06';

// Exact Educate! design tokens (spec §1)
export const TOKENS = {
  educateRed: '#870101',
  educateBlue: '#0F6A8C',
  educateYellow: '#F1A01B',
  educateGrey: '#666666',
  educateGreen: '#008148',
  educateNavy: '#0e313e',
  educateRedLight: '#A03434',
  educateBlueLight: '#4D889D',
  educateYellowLight: '#f4b14d',
  educateGreenLight: '#4F9262',
  bgLight: '#f5f7fa',
  white: '#ffffff',
  border: '#e5e9ed',
  textDark: '#2c3e50',
  textMuted: '#95a5a6',
};

// RAG palette (hardcoded throughout the legacy app)
export const RAG = {
  // KPI hero value colors
  kpiGreen: '#8FD48A',
  kpiAmber: '#E6C474',
  kpiRed: '#F4A8A0',
  kpiBlue: '#90CAF9',
  // Insight / takeaway RAG
  insightGreen: '#2e7d5a',
  insightGreenBg: '#EEF5ED',
  insightAmber: '#C38A1F',
  insightAmberBg: '#FBF1DD',
  insightRed: '#C9554A',
  insightRedBg: '#FCF3F1',
  // PB rating segment colors (rating 0..3)
  rating0: '#dc3545',
  rating1: '#ffc107',
  rating2: '#20c997',
  rating3: '#198754',
};

// Convenience CSS-var-equivalent hexes for use in inline styles
export const C = {
  navy: TOKENS.educateNavy,
  red: TOKENS.educateRed,
  green: TOKENS.educateGreen,
  yellow: TOKENS.educateYellow,
  blue: TOKENS.educateBlue,
  grey: TOKENS.educateGrey,
  muted: TOKENS.textMuted,
};

// term → LEC numbers & milestones (legacy TERM_CONFIG line 2108)
export const TERM_CONFIG = {
  term1: { lecs: [1, 2, 3, 4, 5], milestones: [1, 2], label: 'Term 1' },
  term2: { lecs: [6, 7, 8, 9, 10, 11, 12, 13, 14], milestones: [3, 4], label: 'Term 2' },
  term3: { lecs: [15, 16, 17, 18, 19, 20], milestones: [5, 6], label: 'Term 3' },
};

// METRIC_DEFINITIONS (legacy line 3835) — authoritative labels/formulas/thresholds
export const METRIC_DEFINITIONS = {
  lec_delivery: {
    label: 'LEC Delivery Rate',
    what: 'The percentage of expected Skills Lab sessions (LECs) that have been delivered by mentors across all schools in scope.',
    formula: '(Schools that delivered LEC n) ÷ (Total target schools) — summed across all LECs for the term, then divided by (total schools × number of LECs in term).',
    source: 'CU summary table — fields: schools_with_lec1 … schools_with_lec14 (BigQuery: exp_cu_summary)',
    threshold: '≥ 80% = On Track (Green) · 60–79% = Near (Amber) · < 60% = Behind (Red)',
    note: 'LEC delivery resets each term — T2 LECs are numbered 6–14. A school is counted as "delivered" for LEC n if schools_with_lecN > 0 for its CU row.',
  },
  lec_single: {
    label: 'Individual LEC Delivery',
    what: 'Delivery rate for a single LEC session (e.g. LEC 6) across all schools — what % of schools have delivered this specific session.',
    formula: '(Schools that delivered LEC n) ÷ (Total target schools) × 100',
    source: 'CU summary — field: schools_with_lecN where N is the LEC number',
    threshold: '≥ 80% = On Track · 60–79% = Near · < 60% = Behind',
    note: 'Use this to identify sequencing gaps — when LEC 6 is at 97% but LEC 12 is at 1%, that is a scheduling backlog, not non-delivery.',
  },
  recruitment: {
    label: 'Scholar Recruitment Rate',
    what: 'The % of the target scholar cohort that has been recruited into the programme. Always calculated from Term 1 data as recruitment is a T1 activity.',
    formula: '(total_scholars_recruited T1) ÷ (total_target_schools × 45) × 100',
    source: 'CU summary T1 rows — field: total_scholars_recruited · Target = 45 scholars per school',
    threshold: '≥ 95% = On Track · 80–94% = Near · < 80% = Below target',
    note: 'Target of 45 scholars per school is the national standard. Recruitment figures from T2 reflect the T1 baseline — they do not change mid-year.',
  },
  avg_scholars: {
    label: 'Average Scholars per LEC Session',
    what: 'Average number of scholars attending per Skills Lab session delivered. Measures participation intensity — are scholars actually showing up to LECs?',
    formula: 'Sum of (lecN_scholars for all delivered LECs) ÷ Sum of (schools_with_lecN for all delivered LECs)',
    source: 'CU summary — fields: lec1_scholars … lec14_scholars and schools_with_lec1 … schools_with_lec14',
    threshold: '≥ 45 = On Track · 35–44 = Near · < 35 = Low (target is 45/school)',
    note: 'Only LECs with at least one delivery are included in the average to avoid diluting with zeroes from undelivered sessions.',
  },
  pb_quality: {
    label: 'Passbook Quality Rate',
    what: 'Percentage of scholar passbooks rated Good (2) or Excellent (3) at milestone review. Measures whether mentors are providing quality feedback in passbooks.',
    formula: '(m1_quality_rated + m2_quality_rated) ÷ (m1_total_rated + m2_total_rated) × 100 — uses T1 milestone data',
    source: 'CU summary T1 rows — fields: m1_quality_rated, m2_quality_rated, m1_total_rated, m2_total_rated',
    threshold: '≥ 80% = Excellent · 60–79% = Acceptable · < 60% = Needs attention',
    note: 'Quality ratings are collected at M1 and M2 milestone reviews in Term 1. A rating of 2 (Good) or 3 (Excellent) is counted as quality. Rating 1 (Needs Work) is not counted.',
  },
  observations: {
    label: 'Mentor Observation Coverage',
    what: 'Percentage of active mentors who have received at least one FOA observation visit. Measures whether FOAs are conducting their required field supervision.',
    formula: 'Min(total_observed_mentors, total_active_mentors) ÷ total_active_mentors × 100',
    source: 'CU summary — fields: total_observed_mentors, total_active_mentors, total_mentor_observations (T1 for T2/All view)',
    threshold: '≥ 80% = On Track · 50–79% = Near · < 50% = Critical',
    note: 'We use Min(observed, active) to prevent rates over 100% where data entry errors create more observed than active mentors. Drill to CU level to see individual mentor visit counts and scores (out of 3).',
  },
  retention: {
    label: 'Scholar Retention Rate',
    what: 'Percentage of activated scholars (those who attended LEC 2) still attending sessions at the most recent LEC. When LEC 14 has not been delivered, rate is projected from the last 2 delivered LECs.',
    formula: 'LEC14_scholars ÷ lec2_scholars × 100. If LEC 14 = 0: avg(scholars/school for last 2 LECs) × total_schools ÷ lec2_scholars × 100',
    source: 'CU summary — fields: lec14_scholars (or latest LECs), lec2_scholars from T1',
    threshold: '≥ 95% = Excellent · 80–94% = Good · < 80% = Needs attention',
    note: '"Projected" means LEC 14 data is not yet available — the estimate uses the average attendance rate of the 2 most recently delivered LECs extrapolated to the full school cohort. Label shows "(projected)" when this applies.',
  },
  lec_duration: {
    label: 'Average LEC Session Duration',
    what: 'Average time spent per LEC session, measured in minutes. Shows how long each skills lab session runs on average per school.',
    formula: 'AVG(session_duration) for skills_lab records per school, then averaged across schools in the CU/region.',
    source: 'avg_lec_session_duration field from school_lec_summary CTE',
    threshold: '70-90 min = On Track (green). Outside range = Needs Review (amber).',
    note: 'Raw data has a few extreme outliers (max 801,111 mins from data entry errors). School-level averaging mitigates these. Typical median = ~80 min.',
  },
  report_timeliness: {
    label: 'Activity Report Timeliness',
    what: 'How promptly schools are submitting activity reports after LECs are delivered. "On Track" = Early + On Schedule combined.',
    formula: 'On Track % = (early_reports + on_time_reports) ÷ total_reports × 100',
    source: 'CU summary — fields: reports_early, reports_on_time, reports_week1_delay, reports_late, reports_unscheduled',
    threshold: '≥ 70% on track = Good · 50–69% = Monitor · < 50% = Concern',
    note: 'Early = submitted before deadline · On Schedule = submitted within deadline · 1 Week Delay = up to 7 days late · Late = >7 days late · Unscheduled = no submission recorded.',
  },
  non_scholar: {
    label: 'Non-Scholar Participation',
    what: 'Community members or non-enrolled individuals who attend LEC sessions alongside scholars. Measures community spillover and programme reach beyond the enrolled cohort.',
    formula: '% schools with NS attendance = Schools where any LEC has lec_n_non_scholars > 0 ÷ total schools. Avg = total non-scholars across all delivered LECs ÷ delivered LEC count.',
    source: 'School-level data — fields: lec1_non_scholars … lec14_non_scholars',
    threshold: 'No formal target — high non-scholar attendance (10+/school) is positive community engagement',
    note: 'Non-scholar data is captured at school level. Bucket distribution (0, 1–10, 11–20, 21–30, 31+) shows the spread. High buckets indicate strong community interest.',
  },
};

// LEC / milestone helpers -----------------------------------------------------
export function getLECsForTerm(_year, term) {
  return (TERM_CONFIG[term] || TERM_CONFIG.term1).lecs;
}

export function getLECLabels(lecNums) {
  return lecNums.map((n) => 'LEC ' + n);
}

export function getMilestonesForTerm(term) {
  const cfg = TERM_CONFIG[term];
  return cfg && cfg.milestones ? cfg.milestones : [1, 2];
}

export function getTermLabel(term) {
  const cfg = TERM_CONFIG[term];
  return cfg && cfg.label ? cfg.label : term;
}
