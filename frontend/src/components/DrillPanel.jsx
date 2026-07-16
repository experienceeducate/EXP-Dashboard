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
};

const PCT_METRICS = new Set(['lec_delivery', 'lec_single', 'recruitment', 'pb_quality', 'pb_completion', 'observations', 'retention', 'report_timeliness', 'gm', 'community_day', 'skills_day']);

// Evaluate a metric for a group of rows. `schoolCount`/`t1SchoolCount` are the
// denominators (CU rows use total_target_schools; mentor uses school-row count).
function evalMetric(metric, { rows, t1Rows, obsRows, schoolCount, t1SchoolCount, lecNums, lecNum, mentorLevel }) {
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
    const src = t1Rows.length > 0 ? t1Rows : rows;
    const q = sum(src, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
    const t = sum(src, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
    return { val: t > 0 ? Math.round((q / t) * 100) : 0, sub: `${q.toLocaleString()} of ${t.toLocaleString()} rated ≥2` };
  }
  if (metric === 'pb_completion') {
    const src = t1Rows.length > 0 ? t1Rows : rows;
    const done = sum(src, (d) => N(d.schools_completed_m1));
    return { val: t1SchoolCount > 0 ? Math.round((done / t1SchoolCount) * 100) : 0, sub: `${done} of ${t1SchoolCount} schools reported M1` };
  }
  if (metric === 'observations') {
    if (mentorLevel) {
      const obs = Math.max(0, ...rows.map((d) => N(d.total_mentor_observations)));
      return { val: obs > 0 ? 100 : 0, sub: `${obs} observation${obs !== 1 ? 's' : ''}` };
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
  // total_schools / fallback
  return { val: schoolCount, sub: '' };
}

// Region-level rows (from CU summaryData).
function regionRows(metric, summaryData, year, term, lecNum) {
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
      rows: rd, t1Rows: rdT1, obsRows: rdObs, lecNums, lecNum,
      schoolCount: sum(forSchools, (d) => N(d.total_target_schools)),
      t1SchoolCount: sum(rdT1, (d) => N(d.total_target_schools)),
    });
    return { key: reg, name: reg, val, sub };
  });
}

// CU-level rows within a region.
function cuRows(metric, summaryData, year, term, region, lecNum) {
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
      rows: rd, t1Rows: rdT1, obsRows: rdObs, lecNums, lecNum,
      schoolCount: sum(forSchools, (d) => N(d.total_target_schools)),
      t1SchoolCount: sum(rdT1, (d) => N(d.total_target_schools)),
    });
    return { key: c, name: c, val, sub };
  });
}

// Mentor-level rows within a CU (aggregate school rows).
function mentorRows(metric, schoolData, year, term, cu, lecNum) {
  const lecNums = getLECsForTerm(year, term);
  const inCu = (d) => String(d.cu || '').toLowerCase() === String(cu).toLowerCase();
  const rows = (schoolData || []).filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && inCu(d));
  const t1All = (schoolData || []).filter((d) => d.year == year && d.term === 'term1' && inCu(d));
  const map = new Map();
  rows.forEach((r) => {
    const mid = String(r.mentor_id || r.mentor_name || 'unknown');
    if (!map.has(mid)) map.set(mid, { name: r.mentor_name || '—', schools: [] });
    map.get(mid).schools.push(r);
  });
  return [...map.entries()].map(([mid, m]) => {
    const t1Rows = t1All.filter((d) => String(d.mentor_id || d.mentor_name || 'unknown') === mid);
    const { val, sub } = evalMetric(metric, {
      rows: m.schools, t1Rows, obsRows: m.schools, lecNums, lecNum, mentorLevel: true,
      schoolCount: m.schools.length,
      t1SchoolCount: t1Rows.length > 0 ? t1Rows.length : m.schools.length,
    });
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
  // stack: [] = regions · [region] = CUs · [region, cu] = mentors.
  const [stack, setStack] = useState([]);
  if (!drill) return null;
  const { metric, lecNum } = drill;

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

  const label = metric === 'lec_single' ? `LEC ${lecNum || ''}` : METRIC_LABELS[metric] || metric;
  const isPct = PCT_METRICS.has(metric);

  const level = stack.length === 0 ? 'region' : stack.length === 1 ? 'cu' : 'mentor';
  let rows;
  let colHeader;
  if (level === 'region') {
    rows = regionRows(metric, summaryData, year, term, lecNum);
    colHeader = 'Region';
  } else if (level === 'cu') {
    rows = cuRows(metric, summaryData, year, term, stack[0], lecNum);
    colHeader = 'Cluster Unit';
  } else {
    rows = mentorRows(metric, schoolData, year, term, stack[1], lecNum);
    colHeader = 'Mentor';
  }

  const crumbLabels = ['All Regions', stack[0], stack[1]].filter(Boolean);
  const subtitle = level === 'region' ? 'Regional breakdown — click a region to drill into CUs'
    : level === 'cu' ? `CUs in ${stack[0]} — click a CU to drill into mentors`
      : `Mentors in ${stack[1]}`;

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
                const clickable = level !== 'mentor';
                return (
                  <tr key={r.key} className={clickable ? 'clickable' : undefined} onClick={clickable ? () => drillInto(r.name) : undefined}>
                    <td className="item-name">{r.name}{clickable ? <span style={{ fontSize: '.65rem', color: '#0077b6' }}> ⌕</span> : null}</td>
                    <td className="center" style={{ fontWeight: 800, color: isPct ? ragColor(r.val) : C.navy }}>{r.val}{isPct ? '%' : ''}</td>
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
