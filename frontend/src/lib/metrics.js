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
      // lecN_max_week is a string like "Week 3", not a bare number — pull the digits out.
      const raw = d[`lec${n}_max_week`] || d[`lec${n}_week`];
      const wk = parseInt(String(raw || '').replace(/\D/g, ''), 10);
      if (!wk) return;
      const label = `Wk ${wk}`;
      matrix[key][label] = (matrix[key][label] || 0) + N(d[`schools_with_lec${n}`]);
    });
  });
  return matrix;
}

// ── Skills Lab heatmap dynamic title (shared by National + Regional views) ──
export function computeHeatmapHeader(matrix, lecNums, totalSchools) {
  let leadLec = null;
  let leadPct = 0;
  let trailLec = null;
  let trailPct = 100;
  let peakWeek = null;
  let peakCount = 0;
  lecNums.forEach((n) => {
    const lecData = matrix[`lec${n}`] || {};
    const tot = Object.values(lecData).reduce((s, v) => s + v, 0);
    const pct = totalSchools > 0 ? Math.round((tot / totalSchools) * 100) : 0;
    if (pct > leadPct) { leadPct = pct; leadLec = n; }
    if (tot > 0 && pct < trailPct) { trailPct = pct; trailLec = n; }
    Object.entries(lecData).forEach(([wk, cnt]) => { if (cnt > peakCount) { peakCount = cnt; peakWeek = wk; } });
  });
  const dropStr = leadLec && trailLec && leadLec !== trailLec ? ` — drops to ${trailPct}% at LEC ${trailLec}` : '';
  const title = leadLec ? `📅 LEC ${leadLec} leads at ${leadPct}%${dropStr}` : '📅 Skills Lab Activity Heatmap';
  const subtitle = peakWeek
    ? `${peakCount} schools delivered in ${peakWeek} (busiest week) · click any cell for school-level detail`
    : 'LEC × Week delivery timeline across all CUs';
  return { title, subtitle };
}

// ── LEC clustering (bad sequencing) ──────────────────────────────────────────
// Schools that delivered ≥3 LECs sharing the same lecN_max_week (compressed
// pacing). Mirrors legacy renderCUAlerts clustering + openClusterDrill.
// Returns [{ school, cu, region, maxLecs, week, schoolId }] sorted worst-first.
export function computeLecClusters(schoolData, year, term, minLecs = 3) {
  const lecNums = getLECsForTerm(year, term === 'all' ? 'term1' : term);
  const rows = schoolData.filter((d) => String(d.year) == year && (term === 'all' ? true : d.term === term));
  const out = [];
  rows.forEach((d) => {
    const weekCounts = {};
    lecNums.forEach((n) => {
      if (!N(d[`schools_with_lec${n}`])) return;
      const wk = String(d[`lec${n}_max_week`] || '').trim();
      if (wk) weekCounts[wk] = (weekCounts[wk] || 0) + 1;
    });
    const vals = Object.values(weekCounts);
    const maxInWeek = vals.length ? Math.max(...vals) : 0;
    if (maxInWeek >= minLecs) {
      const worst = Object.entries(weekCounts).sort((a, b) => b[1] - a[1])[0];
      out.push({
        school: d.school_name || d.school_id || 'Unknown',
        schoolId: d.school_id,
        cu: d.cu || '—',
        region: d.region || '—',
        maxLecs: maxInWeek,
        week: worst ? worst[0] : '—',
      });
    }
  });
  return out.sort((a, b) => b.maxLecs - a.maxLecs);
}

// ── National Key Insights & Flags (legacy renderNationalKeyInsights) ─────────
// CU-level threshold rollups. Returns [{ type, icon, title, metric, cus }].
export function computeNationalInsights(summaryData, data, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const isT1 = term === 'term1';
  const insights = [];
  if (data.length === 0) return insights;

  // 1. LEC delivery pace — CUs > 1 LEC/school below national average.
  const natAvgLECs = data.reduce((s, d) => s
    + lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0) / Math.max(1, N(d.total_target_schools) || 1), 0) / data.length;
  if (natAvgLECs >= 1) {
    const lowLEC = data.filter((d) => {
      const n = N(d.total_target_schools);
      if (!n) return false;
      const avg = lecNums.reduce((s, ln) => s + N(d[`schools_with_lec${ln}`]), 0) / n;
      return avg < natAvgLECs - 1;
    });
    if (lowLEC.length > 0) {
      insights.push({
        type: 'warning', icon: '📉', metric: 'lec_delivery',
        title: `${lowLEC.length} CU${lowLEC.length > 1 ? 's' : ''} behind national pace (avg ${natAvgLECs.toFixed(1)} LECs/school)`,
        cus: lowLEC.map((d) => {
          const avg = lecNums.reduce((s, ln) => s + N(d[`schools_with_lec${ln}`]), 0) / Math.max(1, N(d.total_target_schools) || 1);
          return { cu: d.cu, region: d.region, note: `${avg.toFixed(1)} LECs/school` };
        }),
      });
    }
  }

  // 2. Recruitment — T1 only, CUs below 80% of target.
  if (isT1) {
    const t1src = summaryData.filter((d) => d.year == year && d.term === 'term1');
    const recSrc = t1src.length > 0 ? t1src : data;
    const lowRec = recSrc.filter((d) => {
      const n = N(d.total_target_schools);
      return n > 0 && N(d.total_scholars_recruited) / (n * 45) < 0.8;
    });
    if (lowRec.length > 0) {
      insights.push({
        type: 'info', icon: '🎓', metric: 'recruitment',
        title: `${lowRec.length} CU${lowRec.length > 1 ? 's' : ''} below 80% recruitment target`,
        cus: lowRec.map((d) => ({ cu: d.cu, region: d.region, note: `${Math.round(N(d.total_scholars_recruited) / (N(d.total_target_schools) || 1) / 45 * 100)}%` })),
      });
    }
  }

  // 3. PB Milestones — no milestone reported, else low PB quality (<70%). Uses T1.
  const t1pb = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const pbSrc = t1pb.length > 0 ? t1pb : data;
  const noPB = pbSrc.filter((d) => N(d.total_target_schools) > 0 && (N(d.schools_completed_m1) + N(d.schools_completed_m2)) === 0);
  if (noPB.length > 0) {
    insights.push({
      type: 'warning', icon: '📋', metric: 'pb_completion',
      title: `${noPB.length} CU${noPB.length > 1 ? 's' : ''} with no PB milestones reported`,
      cus: noPB.map((d) => ({ cu: d.cu, region: d.region })),
    });
  } else {
    const lowPB = pbSrc.filter((d) => {
      const tot = [0, 1, 2, 3].reduce((s, r) => s + N(d[`m1_total_rating_${r}`]) + N(d[`m2_total_rating_${r}`]), 0);
      const good = N(d.m1_total_rating_2) + N(d.m1_total_rating_3) + N(d.m2_total_rating_2) + N(d.m2_total_rating_3);
      return tot > 0 && good / tot < 0.7;
    });
    if (lowPB.length > 0) {
      insights.push({
        type: 'info', icon: '📗', metric: 'pb_quality',
        title: `${lowPB.length} CU${lowPB.length > 1 ? 's' : ''} with PB quality below 70%`,
        cus: lowPB.map((d) => {
          const tot = [0, 1, 2, 3].reduce((s, r) => s + N(d[`m1_total_rating_${r}`]) + N(d[`m2_total_rating_${r}`]), 0);
          const good = N(d.m1_total_rating_2) + N(d.m1_total_rating_3) + N(d.m2_total_rating_2) + N(d.m2_total_rating_3);
          return { cu: d.cu, region: d.region, note: `${Math.round(good / tot * 100)}%` };
        }),
      });
    }
  }

  // 4. Mentor observations — CUs with zero observed mentors.
  const noObs = data.filter((d) => N(d.total_active_mentors) > 0 && N(d.total_observed_mentors) === 0);
  if (noObs.length > 0) {
    insights.push({
      type: 'alert', icon: '👁️', metric: 'observations',
      title: `${noObs.length} CU${noObs.length > 1 ? 's' : ''} with zero mentor observations`,
      cus: noObs.map((d) => ({ cu: d.cu, region: d.region })),
    });
  }
  return insights;
}

const NATIONAL_REGIONS = ['Central', 'East', 'North', 'South', 'West'];

// ── Executive Summary — Performance Insights (legacy renderNationalDynamicInsights) ─
// Auto-generated narrative insights. Each item carries a `kind` discriminator
// plus the raw values needed to render its specific body text.
export function computeExecutiveInsights(summaryData, data, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const lastLec = lecNums[lecNums.length - 1];
  const t1Data = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const t2Data = summaryData.filter((d) => d.year == year && d.term === 'term2');
  const curData = data;

  const avgScholarsPerSession = (rows, lecs) => {
    let s = 0;
    let d = 0;
    lecs.forEach((n) => {
      const sc = sum(rows, (r) => N(r[`lec${n}_scholars`]));
      const dl = sum(rows, (r) => N(r[`schools_with_lec${n}`]));
      if (dl > 0) { s += sc; d += dl; }
    });
    return d > 0 ? s / d : 0;
  };

  const insights = [];

  // 1. Projected retention explanation (T2 only).
  if (term === 'term2' && t1Data.length > 0 && t2Data.length > 0) {
    const t1Lecs = getLECsForTerm(year, 'term1');
    const t2Lecs = getLECsForTerm(year, 'term2');
    const t1Avg = avgScholarsPerSession(t1Data, t1Lecs);
    const deliveredT2 = t2Lecs.filter((n) => t2Data.some((d) => N(d[`schools_with_lec${n}`]) > 0));
    const recent2 = deliveredT2.slice(-2);
    const t2Avg = avgScholarsPerSession(t2Data, recent2);
    const t1Activated = sum(t1Data, (d) => N(d.lec2_scholars));
    const schoolCount = sum(curData, (d) => N(d.total_target_schools));
    const projLEC14 = t2Avg > 0 && schoolCount > 0 ? Math.round(t2Avg * schoolCount) : 0;
    const projRetPct = t1Activated > 0 && projLEC14 > 0 ? Math.round((projLEC14 / t1Activated) * 100) : 0;

    if (t1Avg > 0 && t2Avg > 0 && projRetPct > 0) {
      insights.push({
        kind: 'retention_projection', icon: '📈',
        level: projRetPct >= 90 ? 'good' : projRetPct >= 75 ? 'warn' : 'risk',
        lastLec, projRetPct, t1Avg, t2Avg, recent2, schoolCount, projLEC14, t1Activated,
        abovePct: projRetPct >= 100,
      });
    }
  }

  // 2. LEC delivery pace drop-off.
  if (lecNums.length >= 3) {
    const totalTargetSchools = sum(curData, (d) => N(d.total_target_schools));
    const deliveredByLec = lecNums.map((n) => ({
      n,
      pct: Math.round((sum(curData, (d) => N(d[`schools_with_lec${n}`])) / Math.max(totalTargetSchools, 1)) * 100),
    })).filter((x) => x.pct > 0);

    if (deliveredByLec.length >= 2) {
      const first = deliveredByLec[0];
      const last = deliveredByLec[deliveredByLec.length - 1];
      const gap = first.pct - last.pct;
      const stillPending = totalTargetSchools - sum(curData, (d) => N(d[`schools_with_lec${last.n}`]));

      if (gap >= 20) {
        insights.push({
          kind: 'lec_pace_dropoff', icon: '📉',
          level: gap >= 50 ? 'risk' : 'warn',
          firstLec: first.n, firstPct: first.pct, lastLec: last.n, lastPct: last.pct, gap, stillPending,
        });
      }
    }
  }

  // 3. Non-scholar attendance trend.
  if (term !== 'all' && t1Data.length > 0) {
    const t1Lecs = getLECsForTerm(year, 'term1');
    let t1S = 0;
    let t1NS = 0;
    t1Lecs.forEach((n) => {
      t1S += sum(t1Data, (d) => N(d[`lec${n}_scholars`]));
      t1NS += sum(t1Data, (d) => N(d[`lec${n}_non_scholars`]));
    });
    let curS = 0;
    let curNS = 0;
    lecNums.forEach((n) => {
      curS += sum(curData, (d) => N(d[`lec${n}_scholars`]));
      curNS += sum(curData, (d) => N(d[`lec${n}_non_scholars`]));
    });
    const t1NSRatio = t1S > 0 ? (t1NS / t1S) * 100 : 0;
    const curNSRatio = curS > 0 ? (curNS / curS) * 100 : 0;
    if (t1NSRatio > 0 && curNSRatio > 0) {
      const termLabel = term === 'term2' ? 'Term 2' : term === 'term3' ? 'Term 3' : 'this term';
      insights.push({
        kind: 'non_scholar_trend', icon: '👥', level: 'info',
        curNSRatio, t1NSRatio, curNS, termLabel, diff: curNSRatio - t1NSRatio,
      });
    }
  }

  // 4. Observation coverage flag.
  const obsRows = term === 'all' ? summaryData.filter((d) => d.year == year && d.term === 'term1') : curData;
  const totalMen = sum(obsRows, (d) => Math.max(N(d.total_active_mentors), 0));
  const obsMen = sum(obsRows, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
  const obsPct = totalMen > 0 ? Math.round((obsMen / totalMen) * 100) : 0;
  const unobsMen = totalMen - obsMen;
  if (totalMen > 0 && obsPct < 100) {
    const zeroObsCUs = obsRows.filter((d) => N(d.total_observed_mentors) === 0 && N(d.total_active_mentors) > 0);
    insights.push({
      kind: 'observation_flag', icon: '👁️',
      level: obsPct >= 80 ? 'good' : obsPct >= 50 ? 'warn' : 'risk',
      obsPct, obsMen, totalMen, unobsMen, zeroObsCUs: zeroObsCUs.map((d) => d.cu),
    });
  }

  // 5. PB quality regional flag.
  const pbSrc = t1Data.length > 0 ? t1Data : curData;
  const pbQ = sum(pbSrc, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
  const pbT = sum(pbSrc, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
  const pbPct = pbT > 0 ? Math.round((pbQ / pbT) * 100) : 0;
  const regPB = NATIONAL_REGIONS.map((reg) => {
    const rRows = pbSrc.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
    const rQ = sum(rRows, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
    const rT = sum(rRows, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
    return { reg, pct: rT > 0 ? Math.round((rQ / rT) * 100) : null };
  }).filter((r) => r.pct !== null);
  const belowAvg = regPB.filter((r) => r.pct < pbPct - 5).sort((a, b) => a.pct - b.pct);
  if (pbPct > 0 && belowAvg.length > 0) {
    insights.push({
      kind: 'pb_quality_flag', icon: '📋',
      level: belowAvg[0].pct < 70 ? 'risk' : 'warn',
      pbPct, belowAvg,
    });
  }

  return insights;
}

// ── Regional Issue Summary (legacy renderRegionalIssueSummary) ───────────────
// data = CU rows for the region/term. Returns { issues, bottom5 }.
export function computeRegionalIssues(data, summaryData, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const isT1 = term === 'term1';
  const issues = [];

  const avgs = data.map((cu) => lecNums.reduce((s, n) => s + N(cu[`schools_with_lec${n}`]), 0) / Math.max(1, N(cu.total_target_schools) || 1));
  const sorted = [...avgs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAvg = sorted.length === 0 ? 0 : (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);

  data.forEach((cu) => {
    const n = N(cu.total_target_schools);
    const del = lecNums.reduce((s, ln) => s + N(cu[`schools_with_lec${ln}`]), 0);
    const avg = n > 0 ? del / n : 0;
    if (medianAvg >= 1 && avg < medianAvg - 1) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'LEC Behind Pace', value: `${avg.toFixed(1)} vs median ${medianAvg.toFixed(1)} LECs/school`, severity: 'high' });
    }
    if (N(cu.total_active_mentors) > 0 && N(cu.total_observed_mentors) === 0) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'No Observations', value: '0 mentors observed', severity: 'high' });
    }
    if (isT1) {
      const rec = N(cu.total_scholars_recruited);
      const tgt = n * 45;
      if (tgt > 0 && rec / tgt < 0.8) {
        issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Recruitment', value: `${rec}/${tgt} (${Math.round(rec / tgt * 100)}%)`, severity: 'medium' });
      }
    }
    const cuT1row = summaryData.find((d) => d.term === 'term1' && d.year == year && String(d.cu || '').trim().toLowerCase() === String(cu.cu || '').trim().toLowerCase());
    const pbSchools = cuT1row
      ? N(cuT1row.schools_completed_m1) + N(cuT1row.schools_completed_m2)
      : N(cu.schools_completed_m1) + N(cu.schools_completed_m2);
    if (n > 0 && pbSchools === 0) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'No PB Milestones', value: '0 schools reported', severity: 'medium' });
    }
  });

  const bottom5 = [...data]
    .filter((d) => N(d.total_target_schools) > 0)
    .map((d) => {
      const n = N(d.total_target_schools);
      const del = lecNums.reduce((s, ln) => s + N(d[`schools_with_lec${ln}`]), 0);
      const lecsExp = n * lecNums.length;
      return { cu: d.cu, foa: d.foa_name || '–', n, del, lecsExp, pct: lecsExp > 0 ? Math.round(del / lecsExp * 100) : 0 };
    })
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  return { issues, bottom5 };
}

// ── LEC delivery schedule (legacy renderCUPriorityAlerts SCHEDULE) ───────────
const LEC_SCHEDULE = {
  term1: { start: new Date('2026-02-09'), lecWeeks: { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 } },
  term2: { start: new Date('2026-05-25'), lecWeeks: { 6: 1, 7: 2, 8: 3, 9: 4, 10: 5, 11: 6, 12: 7, 13: 8, 14: 9 } },
};

export function getLECsDueByToday(termKey) {
  const sched = LEC_SCHEDULE[termKey];
  if (!sched) return { lecs: 0, week: 0 };
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekElapsed = Math.floor((Date.now() - sched.start.getTime()) / msPerWeek) + 1;
  if (weekElapsed < 1) return { lecs: 0, week: 0 };
  const lecs = Object.values(sched.lecWeeks).filter((wk) => wk <= weekElapsed).length;
  return { lecs, week: weekElapsed };
}

// ── CU Priority Alerts (legacy renderCUPriorityAlerts) ───────────────────────
// data = the CU's school rows (deduped internally). Returns { alerts, bottom5 }.
export function computeCuPriorityAlerts(data, year, term) {
  const lecNums = getLECsForTerm(year, term);
  const isT1 = term === 'term1';
  const byId = new Map();
  data.forEach((d) => { if (!byId.has(String(d.school_id))) byId.set(String(d.school_id), d); });
  const schools = [...byId.values()];
  const mentorMap = new Map();
  data.forEach((d) => { const m = String(d.mentor_id || ''); if (m && m !== 'null' && !mentorMap.has(m)) mentorMap.set(m, d); });
  const mentors = [...mentorMap.values()];
  const alerts = [];

  const lecCount = (s) => lecNums.filter((n) => N(s[`schools_with_lec${n}`])).length;
  const { lecs: lecsDue, week } = getLECsDueByToday(term === 'all' ? 'term2' : term);

  // 1. Schools behind delivery schedule.
  const behind = lecsDue <= 0 ? [] : schools.filter((s) => lecCount(s) < lecsDue);
  if (behind.length > 0) {
    alerts.push({
      priority: behind.length > schools.length * 0.4 ? 'critical' : 'high',
      category: 'LEC Sequencing',
      title: `${behind.length} Schools Behind Delivery Schedule`,
      description: `As of Week ${week} of the programme, ${lecsDue} LEC${lecsDue !== 1 ? 's' : ''} should have been delivered per the programme calendar. These schools are yet to meet that milestone.`,
      metrics: [
        { value: behind.length, label: 'Schools Behind Schedule' },
        { value: `${schools.length ? Math.round(behind.length / schools.length * 100) : 0}%`, label: 'Of Total Schools' },
        { value: `${lecsDue} LEC${lecsDue !== 1 ? 's' : ''}`, label: `Due by Week ${week}` },
      ],
      action: 'Review School Details',
      schools: behind.map((s) => ({ name: `${s.school_name} (${lecCount(s)}/${lecsDue} LECs)`, mentor: s.mentor_name || '—' })),
    });
  }

  // 2. Mentors not observed.
  const notObserved = mentors.filter((m) => !N(m.total_mentor_observations));
  if (notObserved.length > 0) {
    alerts.push({
      priority: 'high', category: 'Mentor Observation',
      title: `${notObserved.length} Mentor${notObserved.length > 1 ? 's' : ''} Not Yet Observed`,
      description: 'These mentors have not received any LEC observations this term. Schedule visits to ensure programme quality.',
      metrics: [
        { value: notObserved.length, label: 'Mentors Unobserved' },
        { value: `${mentors.length ? Math.round(notObserved.length / mentors.length * 100) : 0}%`, label: 'Of Total Mentors' },
        { value: '0', label: 'Observations Done' },
      ],
      action: 'Schedule Observations',
      schools: notObserved.map((m) => ({ name: `${m.mentor_name || '—'} (${m.school_name})`, mentor: m.mentor_name || '—' })),
    });
  }

  // 3. Mentors who haven't attended a peer circle.
  const noPeerCircle = mentors.filter((m) => !(N(m.unique_peer_circle_meetings_held) > 0));
  if (noPeerCircle.length > 0) {
    alerts.push({
      priority: noPeerCircle.length === mentors.length ? 'high' : 'medium',
      category: 'Peer Circle',
      title: `${noPeerCircle.length} Mentor${noPeerCircle.length > 1 ? 's' : ''} Have Not Attended a Peer Circle`,
      description: 'Peer circle attendance is required for mentor development. Follow up with these mentors to schedule participation.',
      metrics: [
        { value: noPeerCircle.length, label: 'Mentors Missing' },
        { value: `${mentors.length ? Math.round(noPeerCircle.length / mentors.length * 100) : 0}%`, label: 'Of Total Mentors' },
        { value: mentors.length - noPeerCircle.length, label: 'Attended' },
      ],
      action: 'Schedule Peer Circles',
      schools: noPeerCircle.map((m) => ({ name: `${m.mentor_name || '—'} (${m.school_name})`, mentor: m.mentor_name || '—' })),
    });
  }

  // 4. Schools with no PB milestone reported (only when some have).
  const noPB = schools.filter((s) => !N(s.schools_completed_m1));
  if (noPB.length > 0 && noPB.length < schools.length) {
    alerts.push({
      priority: 'medium', category: 'PB Milestone',
      title: `${noPB.length} School${noPB.length > 1 ? 's' : ''} Yet to Report a PB Milestone`,
      description: 'These schools have not submitted any Passbook milestone reports. Follow up with mentors on passbook completion status.',
      metrics: [
        { value: noPB.length, label: 'Schools Without PB' },
        { value: `${schools.length - noPB.length}/${schools.length}`, label: 'Schools Reported' },
        { value: `${schools.length ? Math.round((schools.length - noPB.length) / schools.length * 100) : 0}%`, label: 'Completion Rate' },
      ],
      action: 'Follow Up on PB Milestones',
      schools: noPB.slice(0, 10).map((s) => ({ name: s.school_name, mentor: s.mentor_name || '—' })),
    });
  }

  // 5. Low recruitment (T1 only, < 35 scholars).
  if (isT1) {
    const lowRec = schools.filter((s) => { const r = N(s.total_scholars_recruited); return r > 0 && r < 35; });
    if (lowRec.length > 0) {
      alerts.push({
        priority: 'medium', category: 'Recruitment',
        title: `${lowRec.length} School${lowRec.length > 1 ? 's' : ''} with Low Recruitment (<35 scholars)`,
        description: 'These schools recruited fewer than 35 scholars, below the minimum expected. Understand barriers and consider re-recruitment activities.',
        metrics: [
          { value: lowRec.length, label: 'Schools Flagged' },
          { value: '35', label: 'Min Target' },
          { value: 'T1', label: 'Term' },
        ],
        action: 'Review Recruitment',
        schools: lowRec.map((s) => ({ name: `${s.school_name} (${N(s.total_scholars_recruited)} recruited)`, mentor: s.mentor_name || '—' })),
      });
    }
  }

  // 6. LEC clustering (>60% of LECs in one week, ≥3 LECs).
  const clustered = mentors.map((m) => {
    const wks = {};
    lecNums.forEach((n) => { const w = m[`lec${n}_max_week`]; if (w) wks[w] = (wks[w] || 0) + 1; });
    const vals = Object.values(wks);
    const maxW = vals.length ? Math.max(...vals) : 0;
    const tot = vals.reduce((a, b) => a + b, 0);
    return { m, rate: tot > 0 ? maxW / tot : 0, tot };
  }).filter((x) => x.rate > 0.6 && x.tot >= 3);
  if (clustered.length > 0) {
    alerts.push({
      priority: 'medium', category: 'Programme Quality',
      title: `${clustered.length} Mentor${clustered.length > 1 ? 's' : ''} with LEC Clustering`,
      description: 'Over 60% of LECs delivered in a single week. Verify actual delivery dates and advise on spreading sessions.',
      metrics: [
        { value: clustered.length, label: 'Mentors Flagged' },
        { value: '>60%', label: 'LECs in 1 Week' },
        { value: 'Quality', label: 'Risk' },
      ],
      action: 'Verify Delivery Dates',
      schools: clustered.map((x) => ({ name: `${x.m.mentor_name || '—'} (${x.m.school_name})`, mentor: x.m.mentor_name || '—' })),
    });
  }

  const denom = lecNums.length;
  const bottom5 = schools
    .map((s) => { const cnt = lecCount(s); return { s, cnt, pct: denom > 0 ? Math.round(cnt / denom * 100) : 0 }; })
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  return { alerts, bottom5, denom };
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

const NS_BUCKETS = ['0', '1-10', '11-20', '21-30', '31+'];

// ── Non-Scholar distribution by region (legacy renderNationalNonScholarBreakdown) ─
// Buckets each school by its AVERAGE non-scholars per delivered LEC (not the sum
// across the term), matching the legacy calculation exactly.
export function computeNonScholarBreakdown(schoolData, year, term) {
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
  const rows = schoolData.filter((d) => String(d.year) == year && (term === 'all' ? true : d.term === term));

  const bucketOf = (v) => (v === 0 ? '0' : v <= 10 ? '1-10' : v <= 20 ? '11-20' : v <= 30 ? '21-30' : '31+');
  const avgFor = (s) => {
    let totalNS = 0;
    let totalDel = 0;
    lecNums.forEach((n) => {
      if (N(s[`schools_with_lec${n}`])) { totalNS += N(s[`lec${n}_non_scholars`]); totalDel += 1; }
    });
    return totalDel > 0 ? totalNS / totalDel : 0;
  };

  const schoolAvgs = rows.map((s) => ({ region: s.region, avgNS: avgFor(s) }));
  const natCounts = Object.fromEntries(NS_BUCKETS.map((b) => [b, 0]));
  schoolAvgs.forEach((s) => { natCounts[bucketOf(s.avgNS)] += 1; });
  const natTotal = schoolAvgs.length;
  const natMaxAvg = natTotal > 0 ? Math.max(...schoolAvgs.map((s) => s.avgNS)) : 0;

  const regions = [...new Set(schoolAvgs.map((s) => s.region).filter(Boolean))].sort();
  const regionData = regions.map((region) => {
    const rSchools = schoolAvgs.filter((s) => s.region === region);
    const counts = Object.fromEntries(NS_BUCKETS.map((b) => [b, 0]));
    rSchools.forEach((s) => { counts[bucketOf(s.avgNS)] += 1; });
    const maxAvg = rSchools.length > 0 ? Math.max(...rSchools.map((s) => s.avgNS)) : 0;
    return { region, counts, total: rSchools.length, maxAvg };
  });

  return { buckets: NS_BUCKETS, natCounts, natTotal, natMaxAvg, regionData };
}
