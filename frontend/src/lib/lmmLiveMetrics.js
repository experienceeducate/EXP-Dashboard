// Term 1 vs. Term 2 (+ region/CU drill) resolvers for the Learning & Measurement
// Map tab's "live" metrics. Reuses the same formulas as the rest of the app
// (getTermMetrics, avgScholarsPerLec) rather than re-deriving them, so numbers
// here always match the Executive Summary / LEC Delivery / Passbook tabs.
//
// Every resolver takes (summaryData, year) — summaryData is the CU-level rows
// already loaded by NationalView, unfiltered by term — and returns:
//   { metricLabel, national: {term1, term2}, byRegion: [{name,term1,term2}], byCu: (region) => [...] }
// term1/term2 are pre-formatted display strings (each metric formats its own
// numbers; there's no single numeric shape that fits all 8 of these).
import { getLECsForTerm } from './config.js';
import { getTermMetrics, avgScholarsPerLec, computeNonScholar, sum } from './metrics.js';

const N = (v) => Number(v) || 0;

function pct(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}
function fmtPct(num, den) {
  const p = pct(num, den);
  return p == null ? '—' : `${p}%`;
}
function fmtNum(v) {
  return Number(v || 0).toLocaleString();
}

// Session duration specifically has extreme per-CU outliers that blow up a
// simple mean (see docs/METRICS.md §2.12) — median is the documented fix.
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function filterRows(summaryData, year, term, cuFilter) {
  const cuSet = cuFilter ? new Set(cuFilter.map((c) => String(c).toLowerCase().trim())) : null;
  return summaryData.filter((d) => (
    String(d.year) === String(year)
    && d.term === term
    && (!cuSet || cuSet.has(String(d.cu || '').toLowerCase().trim()))
  ));
}

// schoolData uses the same filter shape as summaryData (both carry year/term/cu),
// just at school-level granularity — needed for fields only populated per-school
// (e.g. lecN_non_scholars).
const filterSchoolRows = filterRows;

function buildLiveMetric(summaryData, year, metricLabel, computeDisplay) {
  const baseRows = summaryData.filter((d) => String(d.year) === String(year));
  const regions = [...new Set(baseRows.map((d) => d.region).filter(Boolean))].sort();
  const cusInRegion = (region) => [...new Set(
    baseRows.filter((d) => d.region === region).map((d) => d.cu).filter(Boolean),
  )].sort();

  return {
    metricLabel,
    national: {
      term1: computeDisplay(null, 'term1'),
      term2: computeDisplay(null, 'term2'),
    },
    byRegion: regions.map((region) => ({
      name: region,
      term1: computeDisplay(cusInRegion(region), 'term1'),
      term2: computeDisplay(cusInRegion(region), 'term2'),
    })),
    byCu: (region) => cusInRegion(region).map((cu) => ({
      name: cu,
      term1: computeDisplay([cu], 'term1'),
      term2: computeDisplay([cu], 'term2'),
    })),
  };
}

function pbQualityPct(rows, term) {
  const isT2 = term === 'term2';
  const q = sum(rows, (d) => (isT2 ? N(d.m3_quality_rated) + N(d.m4_quality_rated) : N(d.m1_quality_rated) + N(d.m2_quality_rated)));
  const t = sum(rows, (d) => (isT2 ? N(d.m3_total_rated) + N(d.m4_total_rated) : N(d.m1_total_rated) + N(d.m2_total_rated)));
  return fmtPct(q, t);
}

function pbCompletionPct(rows, term) {
  const totalSchools = sum(rows, (d) => N(d.total_target_schools));
  const completed = term === 'term2' ? sum(rows, (d) => N(d.schools_completed_m3)) : sum(rows, (d) => N(d.schools_completed_m1));
  return fmtPct(completed, totalSchools);
}

const RESOLVERS = {
  '36000-scholars-recruited-and-activated': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Scholars Recruited / Activated',
    (cuFilter, term) => {
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      return m ? `${fmtNum(m.recruited)} recruited · ${fmtNum(m.activated)} activated` : '—';
    },
  ),

  'milestone-quality-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Milestone Quality Rate',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      return rows.length ? pbQualityPct(rows, term) : '—';
    },
  ),

  // Proxy per user decision: no direct "feedback received" survey exists, so
  // this reads scholars completing passbook milestones against scholars
  // activated (LEC2) — activation is always sourced from T1 rows, same
  // convention as the rest of the app (see getTermMetrics).
  // Numerator is MAX(first milestone, second milestone) of the term, not the
  // sum — summing double-counts scholars rated on both (confirmed against
  // real data: M1+M2 summed gave >180%). Max, not "always the later one",
  // because the later milestone (M4) may simply not have happened yet within
  // the term — using it alone would read as a collapse rather than "in
  // progress" (real data: M3=34,058 rated vs M4=1,773 rated mid-Term 2).
  'passbook-feedback-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Passbook Feedback Rate (proxy: milestone completion ÷ activated)',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      if (!rows.length || !m || !m.activated) return '—';
      const isT2 = term === 'term2';
      const firstMilestone = sum(rows, (d) => N(isT2 ? d.m3_total_rated : d.m1_total_rated));
      const secondMilestone = sum(rows, (d) => N(isT2 ? d.m4_total_rated : d.m2_total_rated));
      const completed = Math.max(firstMilestone, secondMilestone);
      return `${fmtPct(completed, m.activated)} (${fmtNum(completed)}/${fmtNum(m.activated)} activated)`;
    },
  ),

  'foa-supervision-coverage-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'FOA Supervision Coverage Rate',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      if (!rows.length) return '—';
      const active = sum(rows, (d) => N(d.total_active_mentors));
      const observed = sum(rows, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
      return `${fmtPct(observed, active)} (${fmtNum(observed)}/${fmtNum(active)})`;
    },
  ),

  'reduction-in-the-average-learners-in-class': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Avg Scholars per LEC',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      if (!rows.length) return '—';
      const lecNums = getLECsForTerm(year, term);
      return `${avgScholarsPerLec(rows, lecNums)} avg/LEC`;
    },
  ),

  'mentor-facilitation-quality-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Mentor Facilitation Quality Rate',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      const scores = rows.map((d) => Number(d.avg_cu_observation_score)).filter((v) => v > 0);
      if (!scores.length) return '—';
      const avg = (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2);
      const pctGood = Math.round((scores.filter((v) => v >= 2.5).length / scores.length) * 100);
      return `${avg}/3.0 avg (${pctGood}% CUs ≥2.5)`;
    },
  ),

  'scholar-activation-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Scholar Activation Rate',
    (cuFilter, term) => {
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      return m && m.recruited > 0 ? `${fmtPct(m.activated, m.recruited)} (${fmtNum(m.activated)}/${fmtNum(m.recruited)})` : '—';
    },
  ),

  'scholar-retention-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Scholar Retention Rate',
    (cuFilter, term) => {
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      return m ? `${m.retention}% retained (to LEC${m.lastLec})` : '—';
    },
  ),

  'lec-attendance-rate-passbook-completion-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'LEC Attendance + Passbook Completion',
    (cuFilter, term) => {
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      const rows = filterRows(summaryData, year, term, cuFilter);
      return m ? `LEC ${m.lecPct}% · PB completion ${pbCompletionPct(rows, term)}` : '—';
    },
  ),

  // Proxy: no 3-element (leadership+schedule+enrollment) SBC tracking exists;
  // Community Day (T1) / Skills Day (T2) completion is the closest live signal.
  'sbc-structural-readiness-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'SBC Readiness (proxy: Community Day / Skills Day completion)',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      if (!rows.length) return '—';
      const totalSchools = sum(rows, (d) => N(d.total_target_schools));
      const isT2 = term === 'term2';
      const completed = sum(rows, (d) => (isT2 ? N(d.schools_with_skills_day) : N(d.schools_with_community_day)));
      const label = isT2 ? 'Skills Day' : 'Community Day';
      return `${fmtPct(completed, totalSchools)} ${label} (${fmtNum(completed)}/${fmtNum(totalSchools)} schools)`;
    },
  ),

  // Proxy: per-scholar SBC/club participation isn't tracked; Community Day
  // (T1) / Skills Day (T2) scholar attendance against activated scholars is
  // the closest live signal (same activities used for SBC Readiness above).
  'sbc-scholar-project-participation-rate': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'SBC Participation (proxy: Community/Skills Day attendance ÷ activated)',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      const m = getTermMetrics(summaryData, year, term, cuFilter);
      if (!rows.length || !m || !m.activated) return '—';
      const isT2 = term === 'term2';
      const attendance = sum(rows, (d) => (isT2 ? N(d.sd_total_scholars) : N(d.cd_scholar_attendance)));
      const label = isT2 ? 'Skills Day' : 'Community Day';
      return `${fmtPct(attendance, m.activated)} ${label} (${fmtNum(attendance)}/${fmtNum(m.activated)} activated)`;
    },
  ),

  // Partial: gender is only captured for Skills Day attendance (T2) and pitch
  // attendance — not on general scholar records (the sheet flags this same
  // gap itself). Shown here so it's at least visible, not to claim full
  // gender disaggregation across every metric.
  'all-primary-metrics-disaggregated-by-gender': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Gender Split — Skills Day Attendance (only field with gender captured)',
    (cuFilter, term) => {
      if (term !== 'term2') return 'No gender field for Term 1 (Community Day has none)';
      const rows = filterRows(summaryData, year, term, cuFilter);
      if (!rows.length) return '—';
      const male = sum(rows, (d) => N(d.sd_male_scholars));
      const female = sum(rows, (d) => N(d.sd_female_scholars));
      const total = male + female;
      return total > 0 ? `${fmtPct(female, total)} female (${fmtNum(female)}F / ${fmtNum(male)}M)` : '—';
    },
  ),

  // Part B (non-scholar engagement) only — Part A (club-visit-to-milestone
  // correlation) isn't formally linked. Needs school-level rows (schoolData),
  // not the CU-level summaryData every other resolver uses.
  'club-leadership-activity-level-scholar-reported-non-scholar-': (summaryData, year, schoolData) => buildLiveMetric(
    summaryData, year, 'Non-Scholar Engagement (Part B proxy)',
    (cuFilter, term) => {
      if (!schoolData || !schoolData.length) return '—';
      const rows = filterSchoolRows(schoolData, year, term, cuFilter);
      if (!rows.length) return '—';
      const r = computeNonScholar(rows, year, term);
      return `${r.pctWith}% schools w/ non-scholars (${r.withNS}/${r.total})`;
    },
  ),

  // Median (not mean) session duration is live; the specific "% of sessions in
  // the 75–85 min window" fidelity bucket the sheet asks for isn't precomputed
  // per-session at CU level, so this shows the median plus a CU-level proxy
  // for the fidelity window (share of CUs whose own average falls in it).
  // Mean, not median, blows up on real data — docs/METRICS.md §2.12 documents
  // extreme per-CU outliers in this exact field (confirmed: one Term 1 CU's
  // raw average pushed a simple mean to 259 min nationally / 773 min for one
  // region, vs. a sane ~78 min median).
  'session-duration-fidelity': (summaryData, year) => buildLiveMetric(
    summaryData, year, 'Median LEC Session Duration',
    (cuFilter, term) => {
      const rows = filterRows(summaryData, year, term, cuFilter);
      const durations = rows.map((d) => Number(d.avg_session_duration_mins)).filter((v) => v > 0);
      if (!durations.length) return '—';
      const med = median(durations).toFixed(1);
      const inWindowPct = Math.round((durations.filter((v) => v >= 75 && v <= 85).length / durations.length) * 100);
      return `${med} min median (${inWindowPct}% of CUs in 75–85min window)`;
    },
  ),
};

export function resolveLiveMetric(metricId, summaryData, year, schoolData) {
  const resolver = RESOLVERS[metricId];
  return resolver ? resolver(summaryData, year, schoolData) : null;
}
