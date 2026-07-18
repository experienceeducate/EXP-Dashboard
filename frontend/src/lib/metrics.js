// ─────────────────────────────────────────────────────────────────────────────
// Business-logic metric formulas ported EXACTLY from the legacy dashboard (spec §6).
// All functions are pure — they take data + year/term rather than reading the DOM.
// ─────────────────────────────────────────────────────────────────────────────
import { getLECsForTerm } from './config.js';
import { calculatePBQualityScore, formatPercentage1 } from './format.js';

const N = (v) => Number(v) || 0;
export const sum = (rows, fn) => rows.reduce((s, d) => s + fn(d), 0);

// ── Merge same-entity rows across terms (for "All Terms" views) ─────────────
// Each term's row NULLS OUT the fields that don't apply to it — e.g. a term2
// CU/school row has total_scholars_recruited=null, m1/m2=0, schools_with_lec1-5=0
// (verified directly against BigQuery, not assumed). Naively keeping only one
// row per entity (e.g. `Map.set` on first-seen) silently drops whichever term
// didn't come first — every field that only applies to the OTHER term reads
// as blank/zero, even though real data exists on the row that got discarded.
// This coalesces per field, keeping the larger of the two (numeric) values —
// 0/null always loses to a populated value — so the merged row reflects
// activity from every term. Only safe for "either-or" fields (a term-specific
// count that's 0 elsewhere, or a roster-style static value that's the same
// either way); genuinely additive across-term fields (e.g. report timeliness
// counts) should NOT be merged this way — sum them from the raw per-term rows
// instead.
export function mergeRowsAcrossTerms(rows, keyFn) {
  const merged = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!merged.has(key)) {
      merged.set(key, { ...row });
      return;
    }
    const existing = merged.get(key);
    Object.keys(row).forEach((field) => {
      const newVal = row[field];
      const curVal = existing[field];
      const newNum = newVal == null || newVal === '' ? null : Number(newVal);
      const curNum = curVal == null || curVal === '' ? null : Number(curVal);
      const newIsNum = newNum != null && !Number.isNaN(newNum);
      const curIsNum = curNum != null && !Number.isNaN(curNum);
      if (newIsNum && (!curIsNum || newNum > curNum)) {
        existing[field] = newVal;
      } else if (!newIsNum && curVal == null && newVal != null) {
        existing[field] = newVal;
      }
    });
  });
  return [...merged.values()];
}

// ── Retention projection (shared by score cards, funnel, term metrics) ────────
// Given a set of rows + LEC numbers, resolve last-LEC scholars, projecting when
// delivery of the last LEC isn't complete yet.
//
// BUG FIX (verified against live BigQuery data): this used to trust the raw
// `actual` sum whenever it was merely nonzero (`actual > 0`), which is true
// almost as soon as a single school reports — e.g. with only 373/825 schools
// (45%) having delivered LEC14, `actual` was the scholar count from just
// those 373 schools, yet it was divided by an activation/recruitment
// denominator summed across all 825 — silently understating retention (54%)
// versus the properly school-coverage-scaled projection (~119%, matching the
// separate "Projected retention" insight already shown elsewhere on the same
// Executive Summary page — the two numbers disagreeing was the reported bug).
// Now `actual` is only trusted once delivery is essentially complete
// (>= 90% of target schools); below that, always project via the per-school
// average rate over the last 2 delivered LECs, scaled to the full school
// count — consistent with computeExecutiveInsights' retention_projection.
export function resolveLastLecScholars(rows, lecNums) {
  const lastLec = lecNums[lecNums.length - 1];
  const actual = sum(rows, (d) => N(d[`lec${lastLec}_scholars`]));
  const deliveredSchools = sum(rows, (d) => N(d[`schools_with_lec${lastLec}`]));
  const totalSchools = sum(rows, (d) => N(d.total_target_schools));
  const lastLecCoverage = totalSchools > 0 ? deliveredSchools / totalSchools : 0;
  if (actual > 0 && lastLecCoverage >= 0.9) return { lastLec, lastLecScholars: actual, isProjected: false };

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

  // PB quality — term-aware milestone pair (M1+M2 for term1, M3+M4 for
  // term2+), always read from `termRows` (already scoped to the requested
  // term/year/cuFilter). Unlike recruitment/activation above — genuinely
  // T1-only fields, hence the t1Src fallback — Term 2 rows carry their own
  // M3/M4 quality data, so PB quality must never borrow from Term 1.
  // BUG FIX: this previously always summed M1+M2 regardless of `term`, so
  // the Term-on-Term Comparison card's "PB Quality" showed the identical
  // number for both Term 1 and Term 2 (verified: both read 90%, T2's own
  // M3+M4 quality was never actually used).
  const pbFields = term === 'term1' ? ['m1', 'm2'] : term === 'term2' ? ['m3', 'm4'] : ['m1', 'm2', 'm3', 'm4'];
  const pb2 = sum(termRows, (d) => pbFields.reduce((s, m) => s + N(d[`${m}_quality_rated`]), 0));
  const totalPB = sum(termRows, (d) => pbFields.reduce((s, m) => s + N(d[`${m}_total_rated`]), 0));

  return {
    lecNums,
    lecsDelivered,
    lecsExpected,
    totalSchools,
    lecPct: formatPercentage1(lecsDelivered, lecsExpected),
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
  const lecDeliveryPct = formatPercentage1(lecsDelivered, lecsExpected);

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
// Clamp a CU row's observed-mentor count to its active-mentor count before
// summing. A handful of CUs have total_observed_mentors > total_active_mentors
// (e.g. mayuge, kamwenge — likely a mentor observed before a mid-term
// reassignment dropped them from the active roster) — verified directly
// against BigQuery, not a one-off. Leaving it unclamped let this tab's
// national coverage % disagree with Executive Summary's (which already
// clamped) for the exact same term selection.
const clampedObserved = (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors));

export function computeObsCoverageByRegion(data) {
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();
  const rows = regions.map((region) => {
    const rd = data.filter((d) => d.region === region);
    const mentors = sum(rd, (d) => N(d.total_active_mentors));
    const observed = sum(rd, clampedObserved);
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
// data = CU rows for the region/term (see mergeRowsAcrossTerms — callers pass
// term-merged rows under "All Terms" so a CU isn't evaluated twice, once per
// term-shaped row). schoolData = region-scoped school rows, used only for the
// LEC Clustering check (computeLecClusters needs per-school week data, which
// doesn't exist on the CU-level rows in `data`). Returns { issues, bottom5, achievements }.
export function computeRegionalIssues(data, summaryData, year, term, schoolData = []) {
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
  const issues = [];

  // LEC Clustering — CUs with multiple schools delivering 3+ LECs in a single
  // week (mentor-workload / scholar-burnout risk, same 3+ threshold used by
  // the CU View heatmap's ⚡ marker). Flag CUs with 2+ such schools — a single
  // clustering incident isn't yet a CU-wide pattern worth a regional flag.
  const clusters = computeLecClusters(schoolData, year, term);
  const clusterCountByCu = new Map();
  clusters.forEach((c) => {
    const key = String(c.cu || '').trim().toLowerCase();
    clusterCountByCu.set(key, (clusterCountByCu.get(key) || 0) + 1);
  });

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
    const clusterCount = clusterCountByCu.get(String(cu.cu || '').trim().toLowerCase()) || 0;
    if (clusterCount >= 2) {
      issues.push({
        cu: cu.cu, foa: cu.foa_name || '–', type: 'LEC Clustering',
        value: `${clusterCount} schools with 3+ LECs in one week`,
        severity: clusterCount >= 4 ? 'high' : 'medium',
      });
    }
    const mentorsActive = N(cu.total_active_mentors);
    const mentorsObserved = N(cu.total_observed_mentors);
    const obsPct = mentorsActive > 0 ? Math.round((mentorsObserved / mentorsActive) * 100) : 0;
    if (mentorsActive > 0 && mentorsObserved === 0) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'No Observations', value: '0 mentors observed', severity: 'high' });
    } else if (mentorsActive > 0 && obsPct < 50) {
      // Matches the same <50% red threshold the CU-level observation-coverage
      // table (ObservationByCU) already colors red — so a CU showing red
      // there is never silently absent from this region-level rollup.
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Low Observation Coverage', value: `${mentorsObserved}/${mentorsActive} (${obsPct}%)`, severity: 'medium' });
    }
    if (term === 'term1' || term === 'all') {
      const rec = N(cu.total_scholars_recruited);
      const tgt = n * 45;
      if (tgt > 0 && rec / tgt < 0.8) {
        issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Recruitment', value: `${rec}/${tgt} (${Math.round(rec / tgt * 100)}%)`, severity: 'medium' });
      }
    }
    // Sum across all 4 milestones unconditionally — a term1 row already reads
    // 0 for m3/m4 (and vice versa for term2), so this is correct for every
    // term selection without branching (see mergeRowsAcrossTerms for why the
    // previous term1-only cross-lookup was needed, and wrong, before rows
    // were merged for "All Terms").
    const pbSchools = N(cu.schools_completed_m1) + N(cu.schools_completed_m2) + N(cu.schools_completed_m3) + N(cu.schools_completed_m4);
    if (n > 0 && pbSchools === 0) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'No PB Milestones', value: '0 schools reported', severity: 'medium' });
    } else if (n > 0) {
      // Distinct from "No PB Milestones" above (0 schools reported at all):
      // this CU DOES have milestone reports, but the ratings on them skew poor.
      const pbFields = ['m1', 'm2', 'm3', 'm4'];
      const r = [0, 1, 2, 3].map((idx) => pbFields.reduce((s, m) => s + N(cu[`${m}_total_rating_${idx}`]), 0));
      const ratedTotal = r[0] + r[1] + r[2] + r[3];
      if (ratedTotal > 0) {
        const qual = calculatePBQualityScore(r[0], r[1], r[2], r[3]);
        if (qual < 50) {
          issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Low PB Quality', value: `${qual}% Good/Excellent`, severity: 'high' });
        } else if (qual < 70) {
          issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Low PB Quality', value: `${qual}% Good/Excellent`, severity: 'medium' });
        }
      }
    }

    // Skills Day only exists as a Term 2 activity — gate to term2/all so a
    // Term 1 view doesn't flag every CU for an activity that isn't due yet.
    if (term === 'term2' || term === 'all') {
      const sdSchools = N(cu.schools_with_skills_day);
      const sdPct = n > 0 ? Math.round((sdSchools / n) * 100) : 0;
      if (n > 0 && sdPct < 50) {
        issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'Skills Day Pending', value: `${sdSchools}/${n} schools (${sdPct}%)`, severity: sdSchools === 0 ? 'high' : 'medium' });
      }
    }

    // Club meetings — unconditional sum across all 4 (CM1-4), same
    // all-terms-safe reasoning as the PB milestone check above.
    const cmTotal = N(cu.schools_with_club_meeting_1) + N(cu.schools_with_club_meeting_2)
      + N(cu.schools_with_club_meeting_3) + N(cu.schools_with_club_meeting_4);
    if (n > 0 && cmTotal === 0) {
      issues.push({ cu: cu.cu, foa: cu.foa_name || '–', type: 'No Club Meetings', value: '0 schools reported', severity: 'medium' });
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

  // ── Achievements — celebrate CUs whose Term 2 performance jumped notably
  // above their own Term 1 baseline. Only meaningful once Term 2 data exists,
  // so this is skipped entirely for a Term 1-only view (nothing to compare
  // against yet).
  const achievements = [];
  if (term === 'term2' || term === 'all') {
    const t1Lecs = getLECsForTerm(year, 'term1');
    const t2Lecs = getLECsForTerm(year, 'term2');
    data.forEach((cu) => {
      const n = N(cu.total_target_schools);
      if (n === 0) return;
      const t1Row = summaryData.find((d) => d.term === 'term1' && d.year == year && String(d.cu || '').trim().toLowerCase() === String(cu.cu || '').trim().toLowerCase());
      const t2Row = summaryData.find((d) => d.term === 'term2' && d.year == year && String(d.cu || '').trim().toLowerCase() === String(cu.cu || '').trim().toLowerCase());
      if (!t1Row || !t2Row) return;

      const lecPct = (row, lecs) => {
        const del = lecs.reduce((s, ln) => s + N(row[`schools_with_lec${ln}`]), 0);
        const exp = n * lecs.length;
        return exp > 0 ? (del / exp) * 100 : null;
      };
      const t1LecPct = lecPct(t1Row, t1Lecs);
      const t2LecPct = lecPct(t2Row, t2Lecs);
      if (t1LecPct != null && t2LecPct != null && t2LecPct - t1LecPct >= 15) {
        achievements.push({
          cu: cu.cu, foa: cu.foa_name || '–', type: 'LEC Delivery Improved',
          value: `${Math.round(t1LecPct)}% → ${Math.round(t2LecPct)}%`,
        });
      }

      const t1RatedTotal = ['m1', 'm2'].reduce((s, m) => s + [0, 1, 2, 3].reduce((a, idx) => a + N(t1Row[`${m}_total_rating_${idx}`]), 0), 0);
      const t2RatedTotal = ['m3', 'm4'].reduce((s, m) => s + [0, 1, 2, 3].reduce((a, idx) => a + N(t2Row[`${m}_total_rating_${idx}`]), 0), 0);
      if (t1RatedTotal > 0 && t2RatedTotal > 0) {
        const t1R = [0, 1, 2, 3].map((idx) => N(t1Row[`m1_total_rating_${idx}`]) + N(t1Row[`m2_total_rating_${idx}`]));
        const t2R = [0, 1, 2, 3].map((idx) => N(t2Row[`m3_total_rating_${idx}`]) + N(t2Row[`m4_total_rating_${idx}`]));
        const t1QualPct = calculatePBQualityScore(t1R[0], t1R[1], t1R[2], t1R[3]);
        const t2QualPct = calculatePBQualityScore(t2R[0], t2R[1], t2R[2], t2R[3]);
        if (t2QualPct - t1QualPct >= 15) {
          achievements.push({
            cu: cu.cu, foa: cu.foa_name || '–', type: 'PB Quality Improved',
            value: `${t1QualPct}% → ${t2QualPct}%`,
          });
        }
      }
    });
  }

  return { issues, bottom5, achievements };
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
export function computeCuPriorityAlerts(data, year, term, schoolData = []) {
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

  // 6. Schools with no recruitment data at all — distinct from "low
  // recruitment" above (which only catches 1-34, deliberately excluding 0).
  // Recruitment is only ever captured in Term 1, so this always checks each
  // school's own T1 row regardless of which term is currently selected —
  // otherwise every school would falsely show "missing" whenever Term 2/All
  // is selected, since total_scholars_recruited reads null outside Term 1.
  const cuNameForRec = schools[0] ? String(schools[0].cu || '').trim().toLowerCase() : '';
  const t1BySchool = new Map();
  schoolData
    .filter((d) => d.term === 'term1' && String(d.year) == year && String(d.cu || '').trim().toLowerCase() === cuNameForRec)
    .forEach((d) => { if (!t1BySchool.has(String(d.school_id))) t1BySchool.set(String(d.school_id), d); });
  const missingRec = schools.filter((s) => {
    const t1 = t1BySchool.get(String(s.school_id));
    const r = t1 ? N(t1.total_scholars_recruited) : N(s.total_scholars_recruited);
    return r === 0;
  });
  if (missingRec.length > 0) {
    alerts.push({
      priority: missingRec.length > schools.length * 0.3 ? 'high' : 'medium',
      category: 'Recruitment',
      title: `${missingRec.length} School${missingRec.length > 1 ? 's' : ''} Missing Recruitment Data`,
      description: 'These schools have no Term 1 scholar recruitment figures on record at all. Confirm whether recruitment happened but wasn\'t reported, or whether recruitment itself is still pending.',
      metrics: [
        { value: missingRec.length, label: 'Schools Missing Data' },
        { value: `${schools.length ? Math.round(missingRec.length / schools.length * 100) : 0}%`, label: 'Of Total Schools' },
        { value: 'T1', label: 'Term' },
      ],
      action: 'Confirm Recruitment Status',
      schools: missingRec.map((s) => ({ name: s.school_name, mentor: s.mentor_name || '—' })),
    });
  }

  // 7. LEC clustering (>60% of LECs in one week, ≥3 LECs).
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
  const pctWith = formatPercentage1(withNS, rows.length);
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
