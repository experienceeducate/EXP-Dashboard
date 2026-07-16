// ─────────────────────────────────────────────────────────────────────────────
// Business-logic metric formulas ported EXACTLY from the legacy dashboard (spec §6).
// All functions are pure — they take data + year/term rather than reading the DOM.
// ─────────────────────────────────────────────────────────────────────────────
import { getLECsForTerm } from './config.js';

const N = (v) => Number(v) || 0;
export const sum = (rows, fn) => rows.reduce((s, d) => s + fn(d), 0);

// ── Retention projection (shared by score cards, funnel, term metrics) ────────
// Given a set of rows + LEC numbers, resolve last-LEC scholars, projecting when 0.
export function resolveLastLecScholars(rows, lecNums) {
  const lastLec = lecNums[lecNums.length - 1];
  const actual = sum(rows, (d) => N(d[`lec${lastLec}_scholars`]));
  if (actual > 0) return { lastLec, lastLecScholars: actual, isProjected: false };

  const deliveredLecs = lecNums.filter((n) => rows.some((d) => N(d[`schools_with_lec${n}`]) > 0));
  const recentLecs = deliveredLecs.slice(-2);
  if (recentLecs.length > 0) {
    let recentS = 0;
    let recentDel = 0;
    recentLecs.forEach((n) => {
      const s = sum(rows, (d) => N(d[`lec${n}_scholars`]));
      const d = sum(rows, (r) => N(r[`schools_with_lec${n}`]));
      if (d > 0) {
        recentS += s;
        recentDel += d;
      }
    });
    if (recentDel > 0) {
      const avgPerSchool = recentS / recentDel;
      const schoolCount = sum(rows, (d) => N(d.total_target_schools));
      return { lastLec, lastLecScholars: Math.round(avgPerSchool * schoolCount), isProjected: true };
    }
  }
  return { lastLec, lastLecScholars: 0, isProjected: false };
}

// ── Avg scholars per delivered LEC ───────────────────────────────────────────
export function avgScholarsPerLec(rows, lecNums) {
  let totalS = 0;
  let totalDel = 0;
  lecNums.forEach((n) => {
    const s = sum(rows, (d) => N(d[`lec${n}_scholars`]));
    const d = sum(rows, (r) => N(r[`schools_with_lec${n}`]));
    if (d > 0) {
      totalS += s;
      totalDel += d;
    }
  });
  return totalDel > 0 ? (totalS / totalDel).toFixed(1) : 0;
}

// ── getTermMetrics (legacy line 2697) ────────────────────────────────────────
// Returns metrics for a given term/year for term-on-term comparison.
export function getTermMetrics(summaryData, year, term, cuFilter) {
  const lecNums = getLECsForTerm(year, term);
  let termRows = summaryData.filter((d) => d.year == year && d.term == term);
  const cuSet = cuFilter && cuFilter.length > 0
    ? new Set(cuFilter.map((c) => String(c).toLowerCase().trim()))
    : null;
  if (cuSet) termRows = termRows.filter((d) => cuSet.has(String(d.cu || '').toLowerCase().trim()));
  if (termRows.length === 0) return null;

  const totalSchools = sum(termRows, (d) => N(d.total_target_schools));
  const lecsDelivered = sum(termRows, (d) => lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
  const lecsExpected = totalSchools * lecNums.length;

  const { lastLec, lastLecScholars, isProjected } = resolveLastLecScholars(termRows, lecNums);

  // Activation and recruitment are always T1 metrics.
  const t1Rows = summaryData.filter((d) => {
    if (d.year != year) return false;
    if (cuSet && !cuSet.has(String(d.cu || '').toLowerCase().trim())) return false;
    return d.term === 'term1';
  });
  const t1Src = t1Rows.length > 0 ? t1Rows : termRows;
  const recruited = sum(t1Src, (d) => N(d.total_scholars_recruited));
  const activated = sum(t1Src, (d) => N(d.lec2_scholars));
  const retBase = activated > 0 ? activated : recruited;

  // PB quality: always T1 milestone data (M1+M2).
  const pbSrcRows = t1Rows.length > 0 ? t1Rows : termRows;
  const pb2 = sum(pbSrcRows, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
  const totalPB = sum(pbSrcRows, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));

  return {
    lecNums,
    lecsDelivered,
    lecsExpected,
    totalSchools,
    lecPct: lecsExpected > 0 ? Math.round((lecsDelivered / lecsExpected) * 100) : 0,
    avgScholars: avgScholarsPerLec(termRows, lecNums),
    recruited,
    activated,
    lastLec,
    lastLecScholars,
    isProjected,
    retention: !retBase || !totalSchools ? 0 : Math.round((lastLecScholars / retBase) * 100),
    qualityPct: totalPB > 0 ? Math.round((pb2 / totalPB) * 100) : 0,
  };
}

// ── National KPI hero strip metrics (legacy renderNationalScoreCards) ─────────
export function computeNationalKpis(summaryData, data, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const t1 = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const src = t1.length > 0 ? t1 : data;

  const totalSchools = sum(data, (d) => N(d.total_target_schools));
  const recSchools = sum(src, (d) => N(d.total_target_schools));
  const totalRecruited = sum(src, (d) => N(d.total_scholars_recruited));
  const totalTarget = (recSchools > 0 ? recSchools : totalSchools) * 45;
  const recruitmentRate = totalTarget > 0 ? Math.round((totalRecruited / totalTarget) * 100) : 0;

  const lecsDelivered = sum(data, (d) => lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
  const lecsExpected = totalSchools * lecNums.length;
  const lecDeliveryPct = lecsExpected > 0 ? Math.round((lecsDelivered / lecsExpected) * 100) : 0;

  const avgScholars = avgScholarsPerLec(data, lecNums);

  const { lastLec, lastLecScholars, isProjected: retProjected } = resolveLastLecScholars(data, lecNums);
  const activated = sum(src, (d) => N(d.lec2_scholars));
  const retBase = activated > 0 ? activated : totalRecruited;
  const retentionPct = retBase > 0 ? Math.round((lastLecScholars / retBase) * 100) : 0;

  // PB quality — term sensitive.
  const pbT1 = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const pbT2 = summaryData.filter((d) => d.year == year && d.term === 'term2');
  let pb2;
  let totalPB;
  let pbTermLabel = '';
  if (term === 'term2') {
    const s = pbT2.length > 0 ? pbT2 : data;
    pb2 = sum(s, (d) => N(d.m3_quality_rated) + N(d.m4_quality_rated));
    totalPB = sum(s, (d) => N(d.m3_total_rated) + N(d.m4_total_rated));
    pbTermLabel = '(T2 M3+M4)';
  } else if (term === 'all') {
    const s = [...pbT1, ...pbT2].length > 0 ? [...pbT1, ...pbT2] : data;
    pb2 = sum(s, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated) + N(d.m3_quality_rated) + N(d.m4_quality_rated));
    totalPB = sum(s, (d) => N(d.m1_total_rated) + N(d.m2_total_rated) + N(d.m3_total_rated) + N(d.m4_total_rated));
    pbTermLabel = '(All M1–M4)';
  } else {
    const s = pbT1.length > 0 ? pbT1 : data;
    pb2 = sum(s, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
    totalPB = sum(s, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
  }
  const qualityRate = totalPB > 0 ? Math.round((pb2 / totalPB) * 100) : null;

  // Observations.
  const obsSrc = term === 'all' ? summaryData.filter((d) => d.year == year) : data;
  const totalMentors = sum(obsSrc, (d) => Math.max(N(d.total_active_mentors), 0));
  const observedMentors = sum(obsSrc, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
  const totalObsCount = sum(obsSrc, (d) => N(d.total_mentor_observations));
  const observationRate = totalMentors > 0 ? Math.round((observedMentors / totalMentors) * 100) : 0;
  const unobserved = totalMentors - observedMentors;

  return {
    lecNums,
    totalSchools,
    totalRecruited,
    totalTarget,
    recruitmentRate,
    lecsDelivered,
    lecsExpected,
    lecDeliveryPct,
    avgScholars,
    lastLec,
    lastLecScholars,
    retProjected,
    activated,
    retentionPct,
    pb2,
    totalPB,
    qualityRate,
    pbTermLabel,
    totalMentors,
    observedMentors,
    totalObsCount,
    observationRate,
    unobserved,
  };
}

// ── Scholar funnel (legacy renderNationalScholarFunnel) ──────────────────────
export function computeScholarFunnel(summaryData, data, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const isT2plus = term !== 'term1';
  const t1Rows = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const useT1 = t1Rows.length > 0 ? t1Rows : data;
  const recruited = sum(useT1, (d) => N(d.total_scholars_recruited));
  const recTarget = sum(useT1, (d) => N(d.total_target_schools)) * 45;
  const activated = sum(useT1, (d) => N(d.lec2_scholars));
  const t1Complete = sum(useT1, (d) => N(d.lec5_scholars));

  const { lastLec, lastLecScholars, isProjected: retProjected } = resolveLastLecScholars(data, lecNums);
  const retBase = activated > 0 ? activated : recruited;
  const retentionPct = retBase > 0 ? Math.round((lastLecScholars / retBase) * 100) : 0;
  const activationPct = recruited > 0 ? ((activated / recruited) * 100).toFixed(1) : 0;
  const t1RetPct = recruited > 0 ? ((t1Complete / recruited) * 100).toFixed(1) : 0;

  return {
    isT2plus, recruited, recTarget, activated, t1Complete,
    lastLec, lastLecScholars, retProjected, retBase, retentionPct, activationPct, t1RetPct,
  };
}

// ── Report timeliness summary (legacy line 8124) ─────────────────────────────
export function getReportTimelinessSummary(rows) {
  const total = sum(rows, (d) => N(d.total_reports_submitted));
  const early = sum(rows, (d) => N(d.reports_early));
  const onTime = sum(rows, (d) => N(d.reports_on_schedule));
  const week1 = sum(rows, (d) => N(d.reports_1_week_delay));
  const late = sum(rows, (d) => N(d.reports_late));
  const unsched = sum(rows, (d) => N(d.reports_unscheduled));
  const onTrack = early + onTime;
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return {
    total, early, onTime, week1, late, unsched, onTrack,
    earlyPct: pct(early), onTimePct: pct(onTime), onTrackPct: pct(onTrack),
    week1Pct: pct(week1), latePct: pct(late), unschedPct: pct(unsched),
  };
}

// ── Observation coverage by region (legacy renderNationalObservationCoverage) ─
export function computeObsCoverageByRegion(data) {
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();
  const rows = regions.map((region) => {
    const rd = data.filter((d) => d.region === region);
    const mentors = sum(rd, (d) => N(d.total_active_mentors));
    const observed = sum(rd, (d) => N(d.total_observed_mentors));
    const obsCount = sum(rd, (d) => N(d.total_mentor_observations));
    const scores = rd.map((d) => Number(d.avg_cu_observation_score)).filter((v) => v > 0);
    const avgScore = scores.length > 0 ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2) : '—';
    const covPct = mentors > 0 ? Math.round((observed / mentors) * 100) : 0;
    return { region, mentors, observed, obsCount, covPct, avgScore };
  });
  const totalMentors = rows.reduce((s, r) => s + r.mentors, 0);
  const totalObserved = rows.reduce((s, r) => s + r.observed, 0);
  const totalObs = rows.reduce((s, r) => s + r.obsCount, 0);
  const totalCovPct = totalMentors > 0 ? Math.round((totalObserved / totalMentors) * 100) : 0;
  return { rows, totalMentors, totalObserved, totalObs, totalCovPct };
}

// ── LEC × week matrix for the Skills Lab heatmap (legacy buildDataIndex) ──────
// Returns { lecKey: { week: count } } from school rows' schools_with_lecN +
// lecN_max_week (or lecN_week school variant).
export function buildLecWeekMatrix(schoolData, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const rows = schoolData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
  const matrix = {};
  lecNums.forEach((n) => {
    const key = `lec${n}`;
    matrix[key] = {};
    rows.forEach((d) => {
      if (!N(d[`schools_with_lec${n}`])) return;
      const wk = N(d[`lec${n}_max_week`]) || N(d[`lec${n}_week`]);
      if (!wk) return;
      const label = `Wk ${wk}`;
      matrix[key][label] = (matrix[key][label] || 0) + N(d[`schools_with_lec${n}`]);
    });
  });
  return matrix;
}

// ── Non-scholar participation buckets (spec §6) ──────────────────────────────
export function computeNonScholar(schoolData, year, term) {
  const rows = schoolData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
  const lecNums = getLECsForTerm(year, term === 'all' ? 'term1' : term);
  const withNS = rows.filter((d) => lecNums.some((n) => N(d[`lec${n}_non_scholars`]) > 0)).length;
  const pctWith = rows.length > 0 ? Math.round((withNS / rows.length) * 100) : 0;
  const buckets = { '0': 0, '1-10': 0, '11-20': 0, '21-30': 0, '31+': 0 };
  rows.forEach((d) => {
    const total = lecNums.reduce((s, n) => s + N(d[`lec${n}_non_scholars`]), 0);
    if (total === 0) buckets['0'] += 1;
    else if (total <= 10) buckets['1-10'] += 1;
    else if (total <= 20) buckets['11-20'] += 1;
    else if (total <= 30) buckets['21-30'] += 1;
    else buckets['31+'] += 1;
  });
  return { total: rows.length, withNS, pctWith, buckets };
}
