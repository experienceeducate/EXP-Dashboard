// Slide-in drill panel (Mewaka-style right drawer). Supports a multi-level
// region → CU → mentor drill for the selected metric, plus the
// "How this is calculated" card from METRIC_DEFINITIONS.
import { useState } from 'react';
import { METRIC_DEFINITIONS, getLECsForTerm, C } from '../lib/config.js';
import { sum, resolveLastLecScholars, avgScholarsPerLec, getReportTimelinessSummary } from '../lib/metrics.js';
import { ragColor } from '../lib/format.js';

const N = (v) => Number(v) || 0;

const METRIC_LABELS = {
  lec_delivery: 'LEC Delivery',
  recruitment: 'Scholar Recruitment',
  avg_scholars: 'Avg Scholars / LEC',
  pb_quality: 'PB Quality',
  pb_completion: 'PB Milestone Completion',
  observations: 'Mentor Observation Coverage',
  retention: 'Scholar Retention',
  lec_single: 'Individual LEC',
  report_timeliness: 'Report Timeliness',
  non_scholar: 'Non-Scholar Participation',
  gm: 'Group Mentoring',
  community_day: 'Community Day',
  skills_day: 'Skills Day',
  lec_duration: 'Avg Session Duration',
  total_schools: 'Total Schools',
  lec_clustering: 'LEC Clustering',
  club_milestone: 'Club Milestone',
};

const PCT_METRICS = new Set(['lec_delivery', 'lec_single', 'recruitment', 'pb_quality', 'pb_completion', 'observations', 'retention', 'report_timeliness', 'gm', 'community_day', 'skills_day', 'club_milestone']);

// Evaluate a metric for a group of rows. `schoolCount`/`t1SchoolCount` are the
// denominators (CU rows use total_target_schools; a single-entity drill level —
// one school, or a mentor on the Mentor Quality tab's own drill — uses its own
// row count). `pbTerm`/`milestoneNum` pin pb_quality/pb_completion to the exact
// term or milestone the user clicked, rather than whatever term happens to be
// selected globally — several PB tiles (e.g. "T1 M1+M2" and "T2 M3+M4") are
// shown side by side regardless of the ambient term filter.
function evalMetric(metric, { rows, t1Rows, obsRows, schoolCount, t1SchoolCount, lecNums, lecNum, singleEntity, milestoneKey, pbTerm, milestoneNum, term }) {
  if (metric === 'lec_delivery') {
    const del = sum(rows, (d) => lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
    const exp = schoolCount * lecNums.length;
    return { val: exp > 0 ? Math.round((del / exp) * 100) : 0, sub: `${del.toLocaleString()} / ${exp.toLocaleString()} sessions` };
  }
  if (metric === 'lec_single') {
    const del = sum(rows, (d) => N(d[`schools_with_lec${lecNum}`]));
    return { val: schoolCount > 0 ? Math.round((del / schoolCount) * 100) : 0, sub: `${del} of ${schoolCount} delivered LEC ${lecNum}` };
  }
  if (metric === 'recruitment') {
    const rec = sum(t1Rows, (d) => N(d.total_scholars_recruited));
    const tar = t1SchoolCount * 45;
    return { val: tar > 0 ? Math.round((rec / tar) * 100) : 0, sub: `${rec.toLocaleString()} of ${tar.toLocaleString()} target` };
  }
  if (metric === 'avg_scholars') {
    return { val: avgScholarsPerLec(rows, lecNums), sub: 'per school per session' };
  }
  if (metric === 'pb_quality') {
    // Never T1-only: M3/M4 quality is genuinely carried on each row's own T2
    // data, unlike recruitment (see the `recruitment` branch above) — borrowing
    // t1Rows here was the bug (every drill showed T1's M1+M2 number even when
    // "T2 M3+M4" was the tile clicked).
    const pt = pbTerm || term;
    const pbFields = pt === 'term1' ? ['m1', 'm2'] : pt === 'term2' ? ['m3', 'm4'] : ['m1', 'm2', 'm3', 'm4'];
    const src = pt === 'term1' ? (t1Rows.length > 0 ? t1Rows : rows) : rows;
    const q = sum(src, (d) => pbFields.reduce((s, m) => s + N(d[`${m}_quality_rated`]), 0));
    const t = sum(src, (d) => pbFields.reduce((s, m) => s + N(d[`${m}_total_rated`]), 0));
    return { val: t > 0 ? Math.round((q / t) * 100) : 0, sub: `${q.toLocaleString()} of ${t.toLocaleString()} rated ≥2` };
  }
  if (metric === 'pb_completion') {
    const pt = pbTerm || term;
    const num = milestoneNum || (pt === 'term2' ? 3 : 1);
    const src = num <= 2 ? (t1Rows.length > 0 ? t1Rows : rows) : rows;
    const done = sum(src, (d) => N(d[`schools_completed_m${num}`]));
    return { val: t1SchoolCount > 0 ? Math.round((done / t1SchoolCount) * 100) : 0, sub: `${done} of ${t1SchoolCount} schools reported M${num}` };
  }
  if (metric === 'observations') {
    if (singleEntity) {
      const obs = Math.max(0, ...rows.map((d) => N(d.total_mentor_observations)));
      const scores = rows.map((d) => Number(d.avg_cu_observation_score)).filter((v) => v > 0);
      const avgScore = scores.length > 0 ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2) : null;
      const foas = [...new Set(rows.map((d) => d.foa_name).filter(Boolean))];
      const sub = `${obs} observation${obs !== 1 ? 's' : ''}${avgScore ? ` · avg score ${avgScore}/3.0` : ''}${foas.length ? ` · Observed by: ${foas.join(', ')}` : ''}`;
      return { val: obs > 0 ? 100 : 0, sub };
    }
    const mentors = sum(obsRows, (d) => N(d.total_active_mentors));
    const observed = sum(obsRows, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
    return { val: mentors > 0 ? Math.round((observed / mentors) * 100) : 0, sub: `${observed} of ${mentors} mentors observed` };
  }
  if (metric === 'retention') {
    const activated = sum(t1Rows, (d) => N(d.lec2_scholars));
    const { lastLecScholars } = resolveLastLecScholars(rows, lecNums);
    const base = activated > 0 ? activated : sum(t1Rows, (d) => N(d.total_scholars_recruited));
    return { val: base > 0 ? Math.round((lastLecScholars / base) * 100) : 0, sub: `${lastLecScholars.toLocaleString()} of ${base.toLocaleString()} activated` };
  }
  if (metric === 'report_timeliness') {
    const s = getReportTimelinessSummary(rows);
    return { val: s.onTrackPct, sub: `${s.onTrack} on track of ${s.total} reports` };
  }
  if (metric === 'gm') {
    const gm = sum(rows, (d) => N(d.schools_with_gm));
    return { val: schoolCount > 0 ? Math.round((gm / schoolCount) * 100) : 0, sub: `${gm} of ${schoolCount} schools` };
  }
  if (metric === 'community_day') {
    const cd = sum(rows, (d) => N(d.schools_with_community_day));
    return { val: schoolCount > 0 ? Math.round((cd / schoolCount) * 100) : 0, sub: `${cd} of ${schoolCount} schools` };
  }
  if (metric === 'skills_day') {
    const sd = sum(rows, (d) => N(d.schools_with_skills_day));
    return { val: schoolCount > 0 ? Math.round((sd / schoolCount) * 100) : 0, sub: `${sd} of ${schoolCount} schools` };
  }
  if (metric === 'club_milestone') {
    const done = sum(rows, (d) => N(d[milestoneKey]));
    return { val: schoolCount > 0 ? Math.round((done / schoolCount) * 100) : 0, sub: `${done} of ${schoolCount} schools` };
  }
  // total_schools / fallback
  return { val: schoolCount, sub: '' };
}

// Region-level rows (from CU summaryData).
function regionRows(metric, summaryData, year, term, lecNum, milestoneKey, pbTerm, milestoneNum) {
  const lecNums = getLECsForTerm(year, term);
  const data = summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
  const t1 = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const obsSrc = term === 'all' ? t1 : data;
  const regions = [...new Set(summaryData.filter((d) => d.year == year).map((d) => String(d.region || '').trim()).filter(Boolean))].sort();
  const match = (d, reg) => String(d.region || '').trim().toLowerCase() === reg.trim().toLowerCase();
  return regions.map((reg) => {
    const rd = data.filter((d) => match(d, reg));
    const rdT1 = t1.filter((d) => match(d, reg));
    const rdObs = obsSrc.filter((d) => match(d, reg));
    const forSchools = rd.length > 0 ? rd : rdT1;
    const { val, sub } = evalMetric(metric, {
      rows: rd, t1Rows: rdT1, obsRows: rdObs, lecNums, lecNum, milestoneKey, term, pbTerm, milestoneNum,
      schoolCount: sum(forSchools, (d) => N(d.total_target_schools)),
      t1SchoolCount: sum(rdT1, (d) => N(d.total_target_schools)),
    });
    return { key: reg, name: reg, val, sub };
  });
}

// CU-level rows within a region.
function cuRows(metric, summaryData, year, term, region, lecNum, milestoneKey, pbTerm, milestoneNum) {
  const lecNums = getLECsForTerm(year, term);
  const inRegion = (d) => String(d.region || '').trim().toLowerCase() === String(region).trim().toLowerCase();
  const data = summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && inRegion(d));
  const t1 = summaryData.filter((d) => d.year == year && d.term === 'term1' && inRegion(d));
  const obsSrc = term === 'all' ? t1 : data;
  const cus = [...new Set(summaryData.filter((d) => d.year == year && inRegion(d)).map((d) => d.cu).filter(Boolean))].sort();
  const byCu = (rows, c) => rows.filter((d) => String(d.cu || '').toLowerCase() === String(c).toLowerCase());
  return cus.map((c) => {
    const rd = byCu(data, c);
    const rdT1 = byCu(t1, c);
    const rdObs = byCu(obsSrc, c);
    const forSchools = rd.length > 0 ? rd : rdT1;
    const { val, sub } = evalMetric(metric, {
      rows: rd, t1Rows: rdT1, obsRows: rdObs, lecNums, lecNum, milestoneKey, term, pbTerm, milestoneNum,
      schoolCount: sum(forSchools, (d) => N(d.total_target_schools)),
      t1SchoolCount: sum(rdT1, (d) => N(d.total_target_schools)),
    });
    return { key: c, name: c, val, sub };
  });
}

// School-level rows within a CU for per-school ✓/✗ indicators (GM, club milestones,
// BMP) — legacy _kpiDrillCU "school-level" branch, not a mentor aggregate.
function schoolFieldRows(schoolData, year, term, cu, fieldKey) {
  const inCu = (d) => String(d.cu || '').toLowerCase() === String(cu).toLowerCase();
  const rows = (schoolData || []).filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && inCu(d));
  const map = new Map();
  rows.forEach((r) => {
    const name = r.school_name || r.school_id || 'Unknown';
    if (!map.has(name)) map.set(name, r);
  });
  return [...map.entries()]
    .map(([name, r]) => ({ key: name, name, mentor: r.mentor_name || '—', held: N(r[fieldKey]) > 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// School-level rows within a CU (each school's own row(s), evaluated as a
// single-entity group) — the drill floor for every metric except Mentor
// Observation Coverage (below) and the Mentor Quality tab, which has its own
// separate region → CU → mentor drill.
function schoolAggRows(metric, schoolData, year, term, cu, lecNum, pbTerm, milestoneNum) {
  const lecNums = getLECsForTerm(year, term);
  const inCu = (d) => String(d.cu || '').toLowerCase() === String(cu).toLowerCase();
  const rows = (schoolData || []).filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && inCu(d));
  const t1All = (schoolData || []).filter((d) => d.year == year && d.term === 'term1' && inCu(d));
  const map = new Map();
  rows.forEach((r) => {
    const sid = String(r.school_id || r.school_name || 'unknown');
    if (!map.has(sid)) map.set(sid, { name: r.school_name || r.school_id || 'Unknown', mentor: r.mentor_name || '—', rows: [] });
    map.get(sid).rows.push(r);
  });
  return [...map.entries()].map(([sid, s]) => {
    const t1Rows = t1All.filter((d) => String(d.school_id || d.school_name || 'unknown') === sid);
    const { val, sub } = evalMetric(metric, {
      rows: s.rows, t1Rows, obsRows: s.rows, lecNums, lecNum, singleEntity: true, term, pbTerm, milestoneNum,
      schoolCount: s.rows.length,
      t1SchoolCount: t1Rows.length > 0 ? t1Rows.length : s.rows.length,
    });
    return { key: sid, name: s.name, val, sub: sub || `Mentor: ${s.mentor}` };
  }).sort((a, b) => b.val - a.val);
}

// Mentor-level rows within a CU — used only for Mentor Observation Coverage.
// Coverage is fundamentally about whether an individual mentor was observed,
// so grouping by school (which double-counts a mentor across their schools)
// would misrepresent it; this also surfaces the FOA who conducted the
// observation, which a per-school view can't (a school row doesn't carry that).
function mentorObsRows(schoolData, year, term, cu) {
  const inCu = (d) => String(d.cu || '').toLowerCase() === String(cu).toLowerCase();
  const rows = (schoolData || []).filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && inCu(d));
  const map = new Map();
  rows.forEach((r) => {
    const mid = String(r.mentor_id || r.mentor_name || 'unknown');
    if (!map.has(mid)) map.set(mid, { name: r.mentor_name || '—', schools: [] });
    map.get(mid).schools.push(r);
  });
  return [...map.entries()].map(([mid, m]) => {
    const { val, sub } = evalMetric('observations', { rows: m.schools, singleEntity: true });
    return { key: mid, name: `${m.name} (${m.schools.length} school${m.schools.length !== 1 ? 's' : ''})`, val, sub };
  }).sort((a, b) => b.val - a.val);
}

function MetricDefCard({ metric }) {
  const [open, setOpen] = useState(false);
  const d = METRIC_DEFINITIONS[metric];
  if (!d) return null;
  return (
    <div style={{ marginTop: '1.25rem', border: '.5px solid #dee2e6', borderRadius: 8, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.6rem .9rem', background: '#f8f9fa', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: '.75rem', fontWeight: 700, color: C.navy }}>📖 How this is calculated</span>
        <span style={{ fontSize: '.75rem', color: '#888' }}>{open ? 'tap to collapse' : 'tap to expand'}</span>
      </div>
      {open ? (
        <div style={{ padding: '.85rem .9rem', background: '#fff', fontSize: '.78rem', lineHeight: 1.7, color: '#444' }}>
          <div style={{ marginBottom: '.6rem' }}><strong style={{ color: C.navy }}>{d.label}</strong></div>
          <div style={{ marginBottom: '.5rem' }}><span style={{ fontWeight: 600, color: '#555' }}>What it measures: </span>{d.what}</div>
          <div style={{ marginBottom: '.5rem', background: '#f0f4f8', borderRadius: 5, padding: '.4rem .65rem', fontFamily: 'monospace', fontSize: '.74rem', color: '#1a1a2e' }}>
            <span style={{ fontWeight: 700 }}>Formula: </span>{d.formula}
          </div>
          <div style={{ marginBottom: '.5rem' }}><span style={{ fontWeight: 600, color: '#555' }}>Data source: </span><span style={{ fontFamily: 'monospace', fontSize: '.73rem' }}>{d.source}</span></div>
          <div style={{ marginBottom: '.5rem' }}><span style={{ fontWeight: 600, color: '#555' }}>Thresholds: </span>{d.threshold}</div>
          <div style={{ borderTop: '.5px dashed #dee2e6', paddingTop: '.5rem', color: '#666', fontStyle: 'italic' }}>💡 {d.note}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function DrillPanel({ drill, summaryData, schoolData, year, term, onClose }) {
  // stack: [] = regions · [region] = CUs · [region, cu] = mentors (or schools, for GM / club milestones).
  const [stack, setStack] = useState(() => (drill && drill.initialRegion ? [drill.initialRegion] : []));
  if (!drill) return null;
  const { metric, lecNum, milestoneKey, pbTerm, milestoneNum } = drill;
  // Region → CU → School for every metric here (the Mentor Quality tab has its
  // own separate region → CU → mentor drill, not this panel). GM and club
  // milestones show a per-school ✓/✗ against a single field; Mentor Observation
  // Coverage stops at Mentor (coverage is inherently about the mentor, not the
  // school they happen to be observed at); everything else shows the metric's
  // own value re-evaluated for that one school.
  const isBooleanSchoolField = metric === 'gm' || metric === 'club_milestone';
  const isMentorLevel = metric === 'observations';

  // LEC clustering is a flat schools list (legacy openClusterDrill), not a
  // region → CU → mentor aggregate — handle it separately.
  if (metric === 'lec_clustering') {
    const clusters = drill.clusters || [];
    return (
      <>
        <div className="drill-backdrop" onClick={onClose} />
        <aside className="drill-panel" role="dialog" aria-label="LEC Clustering breakdown">
          <div className="drill-head">
            <button className="drill-close" onClick={onClose} aria-label="Close">×</button>
            <div className="drill-title">LEC Clustering — Schools Delivering 3+ LECs in a Week</div>
            <div className="drill-subtitle">{clusters.length} school{clusters.length !== 1 ? 's' : ''} flagged</div>
          </div>
          <div className="drill-body">
            <p style={{ fontSize: '.82rem', color: '#555', marginBottom: '.75rem' }}>
              Schools are sorted by highest LECs delivered in a single week. Review pacing with FOAs in highlighted CUs.
            </p>
            <table className="breakdown-table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>CU</th>
                  <th>Region</th>
                  <th className="center">Max LECs / Week</th>
                  <th>Week</th>
                </tr>
              </thead>
              <tbody>
                {clusters.length === 0 ? (
                  <tr><td colSpan={5} style={{ color: '#888', padding: '1rem' }}>No clustering flagged.</td></tr>
                ) : clusters.map((c, i) => (
                  <tr key={`${c.schoolId}-${i}`}>
                    <td className="item-name">{c.school}</td>
                    <td style={{ color: '#555' }}>{c.cu}</td>
                    <td style={{ color: '#555' }}>{c.region}</td>
                    <td className="center" style={{ fontWeight: 700, color: c.maxLecs >= 4 ? '#c0392b' : '#e67e22' }}>{c.maxLecs}</td>
                    <td style={{ color: '#555' }}>{c.week}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </aside>
      </>
    );
  }

  // Heatmap cell drill — schools that delivered a given LEC in a given week
  // (legacy drillHeatmapCell), grouped by region → CU.
  if (metric === 'lec_heatmap_cell') {
    const { week, region } = drill;
    const weekLabel = `Week ${week}`;
    const matched = (schoolData || []).filter((d) => {
      if (d.year != year) return false;
      if (term !== 'all' && d.term !== term) return false;
      if (region && String(d.region || '').toLowerCase() !== String(region).toLowerCase()) return false;
      if (N(d[`schools_with_lec${lecNum}`]) !== 1) return false;
      return String(d[`lec${lecNum}_max_week`] || '').trim() === weekLabel;
    });
    const totalScholars = sum(matched, (d) => N(d[`lec${lecNum}_scholars`]));
    const totalNonScholars = sum(matched, (d) => N(d[`lec${lecNum}_non_scholars`]));

    const byRegion = new Map();
    matched.forEach((d) => {
      const reg = d.region || 'Unknown';
      const cu = d.cu || 'Unknown';
      if (!byRegion.has(reg)) byRegion.set(reg, new Map());
      const cus = byRegion.get(reg);
      if (!cus.has(cu)) cus.set(cu, { schools: [], scholars: 0, nonScholars: 0 });
      const entry = cus.get(cu);
      entry.schools.push(d.school_name || `School ${d.school_id}`);
      entry.scholars += N(d[`lec${lecNum}_scholars`]);
      entry.nonScholars += N(d[`lec${lecNum}_non_scholars`]);
    });

    return (
      <>
        <div className="drill-backdrop" onClick={onClose} />
        <aside className="drill-panel" role="dialog" aria-label={`LEC ${lecNum} — Week ${week} breakdown`}>
          <div className="drill-head">
            <button className="drill-close" onClick={onClose} aria-label="Close">×</button>
            <div className="drill-title">LEC {lecNum} — Week {week}</div>
            <div className="drill-subtitle">
              {matched.length} school{matched.length !== 1 ? 's' : ''} delivered LEC {lecNum} in Week {week} · {totalScholars.toLocaleString()} scholars reached
            </div>
          </div>
          <div className="drill-body">
            {matched.length === 0 ? (
              <p style={{ color: '#888', padding: '1rem' }}>No school-level records found for this cell.</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <div style={{ background: '#eef2ff', borderRadius: 8, padding: '.6rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Schools</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: C.navy }}>{matched.length}</div>
                  </div>
                  <div style={{ background: '#e8f5e9', borderRadius: 8, padding: '.6rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Scholars</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: C.green }}>{totalScholars.toLocaleString()}</div>
                  </div>
                  {totalNonScholars > 0 ? (
                    <div style={{ background: '#fff8e1', borderRadius: 8, padding: '.6rem 1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Non-Scholars</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: C.yellow }}>{totalNonScholars.toLocaleString()}</div>
                    </div>
                  ) : null}
                </div>
                {[...byRegion.keys()].sort().map((reg) => {
                  const cus = byRegion.get(reg);
                  return (
                    <div key={reg} style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.06em', color: C.navy, borderBottom: `2px solid ${C.navy}`, paddingBottom: '.3rem', marginBottom: '.5rem' }}>
                        📍 {reg}
                      </div>
                      <table className="breakdown-table">
                        <thead>
                          <tr>
                            <th>CU</th>
                            <th className="center">Schools</th>
                            <th className="center">Scholars</th>
                            <th className="center">Non-Scholars</th>
                            <th>School Names</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...cus.keys()].sort().map((cu) => {
                            const d = cus.get(cu);
                            const list = d.schools.slice(0, 5).join(', ') + (d.schools.length > 5 ? ` +${d.schools.length - 5} more` : '');
                            return (
                              <tr key={cu}>
                                <td className="item-name">{cu}</td>
                                <td className="center">{d.schools.length}</td>
                                <td className="center" style={{ color: C.green, fontWeight: 700 }}>{d.scholars.toLocaleString()}</td>
                                <td className="center" style={{ color: '#888' }}>{d.nonScholars > 0 ? d.nonScholars.toLocaleString() : '—'}</td>
                                <td style={{ fontSize: '.8rem', color: '#555' }}>{list}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </aside>
      </>
    );
  }

  const label = metric === 'lec_single' ? `LEC ${lecNum || ''}`
    : metric === 'club_milestone' ? (drill.milestoneLabel || METRIC_LABELS.club_milestone)
      : METRIC_LABELS[metric] || metric;
  const isPct = PCT_METRICS.has(metric);

  const level = stack.length === 0 ? 'region' : stack.length === 1 ? 'cu' : (isMentorLevel ? 'mentor' : 'school');
  let rows;
  let colHeader;
  if (level === 'region') {
    rows = regionRows(metric, summaryData, year, term, lecNum, milestoneKey, pbTerm, milestoneNum);
    colHeader = 'Region';
  } else if (level === 'cu') {
    rows = cuRows(metric, summaryData, year, term, stack[0], lecNum, milestoneKey, pbTerm, milestoneNum);
    colHeader = 'Cluster Unit';
  } else if (level === 'mentor') {
    rows = mentorObsRows(schoolData, year, term, stack[1]);
    colHeader = 'Mentor';
  } else if (isBooleanSchoolField) {
    const fieldKey = metric === 'gm' ? 'schools_with_gm' : milestoneKey;
    rows = schoolFieldRows(schoolData, year, term, stack[1], fieldKey).map((r) => ({ key: r.key, name: r.name, val: r.held ? '✓' : '✗', sub: r.mentor, held: r.held }));
    colHeader = 'School';
  } else {
    rows = schoolAggRows(metric, schoolData, year, term, stack[1], lecNum, pbTerm, milestoneNum);
    colHeader = 'School';
  }

  const crumbLabels = ['All Regions', stack[0], stack[1]].filter(Boolean);
  const subtitle = level === 'region' ? 'Regional breakdown — click a region to drill into CUs'
    : level === 'cu' ? `CUs in ${stack[0]} — click a CU to drill into ${isMentorLevel ? 'mentors' : 'schools'}`
      : level === 'mentor' ? `Mentors in ${stack[1]}`
        : `Schools in ${stack[1]}`;

  const drillInto = (name) => {
    if (level === 'region') setStack([name]);
    else if (level === 'cu') setStack([stack[0], name]);
  };
  const goTo = (idx) => setStack(stack.slice(0, idx));

  return (
    <>
      <div className="drill-backdrop" onClick={onClose} />
      <aside className="drill-panel" role="dialog" aria-label={`${label} breakdown`}>
        <div className="drill-head">
          <button className="drill-close" onClick={onClose} aria-label="Close">×</button>
          <div className="drill-crumbs">
            {crumbLabels.map((c, i) => (
              <span key={i}>
                {i > 0 ? <span style={{ color: '#aaa' }}> › </span> : null}
                <span
                  onClick={i < crumbLabels.length - 1 ? () => goTo(i) : undefined}
                  style={{ color: C.navy, fontWeight: 600, cursor: i < crumbLabels.length - 1 ? 'pointer' : 'default', textDecoration: i < crumbLabels.length - 1 ? 'underline' : 'none' }}
                >
                  {c}
                </span>
              </span>
            ))}
            <span style={{ color: '#888' }}> — {label}</span>
          </div>
          <div className="drill-title">{label}</div>
          <div className="drill-subtitle">{subtitle}</div>
        </div>
        <div className="drill-body">
          {stack.length > 0 ? (
            <button
              type="button"
              onClick={() => goTo(stack.length - 1)}
              style={{ marginBottom: '.75rem', background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600, color: C.navy }}
            >
              ← Back
            </button>
          ) : null}
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>{colHeader}</th>
                <th className="center">Value</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3} style={{ color: '#888', padding: '1rem' }}>No data at this level.</td></tr>
              ) : rows.map((r) => {
                const clickable = level !== 'school' && level !== 'mentor';
                const isBooleanRow = level === 'school' && isBooleanSchoolField;
                const valueColor = isBooleanRow ? (r.held ? C.green : C.red) : (isPct ? ragColor(r.val) : C.navy);
                return (
                  <tr key={r.key} className={clickable ? 'clickable' : undefined} onClick={clickable ? () => drillInto(r.name) : undefined}>
                    <td className="item-name">{r.name}{clickable ? <span style={{ fontSize: '.65rem', color: '#0077b6' }}> ⌕</span> : null}</td>
                    <td className="center" style={{ fontWeight: 800, color: valueColor }}>{r.val}{!isBooleanRow && isPct ? '%' : ''}</td>
                    <td style={{ color: '#555' }}>{r.sub}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <MetricDefCard metric={metric} />
        </div>
      </aside>
    </>
  );
}
