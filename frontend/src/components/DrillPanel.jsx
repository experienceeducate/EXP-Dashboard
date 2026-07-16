// Slide-in drill panel (Mewaka-style right drawer). Shows a regional breakdown
// for the selected metric plus the "How this is calculated" card from
// METRIC_DEFINITIONS. A simplified-but-real drill (spec priority 7 / MEDIUM).
import { useState } from 'react';
import { METRIC_DEFINITIONS, getLECsForTerm } from '../lib/config.js';
import { sum, resolveLastLecScholars, avgScholarsPerLec, getReportTimelinessSummary } from '../lib/metrics.js';
import { ragColor } from '../lib/format.js';
import { C } from '../lib/config.js';

const N = (v) => Number(v) || 0;

const METRIC_LABELS = {
  lec_delivery: 'LEC Delivery',
  recruitment: 'Scholar Recruitment',
  avg_scholars: 'Avg Scholars / LEC',
  pb_quality: 'PB Quality',
  observations: 'Mentor Observation Coverage',
  retention: 'Scholar Retention',
  lec_single: 'Individual LEC',
  report_timeliness: 'Report Timeliness',
  non_scholar: 'Non-Scholar Participation',
  gm: 'Group Mentoring',
  lec_duration: 'Avg Session Duration',
  total_schools: 'Total Schools',
  pb_completion: 'PB Milestone Completion',
};

function computeRegionalRows(metric, summaryData, year, term, lecNum) {
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
    const totalS = sum(forSchools, (d) => N(d.total_target_schools));
    let val = 0;
    let sub = '';

    if (metric === 'lec_delivery') {
      const del = sum(rd, (d) => lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
      const exp = totalS * lecNums.length;
      val = exp > 0 ? Math.round((del / exp) * 100) : 0;
      sub = `${del.toLocaleString()} / ${exp.toLocaleString()} sessions`;
    } else if (metric === 'lec_single') {
      const n = lecNum;
      const del = sum(rd, (d) => N(d[`schools_with_lec${n}`]));
      val = totalS > 0 ? Math.round((del / totalS) * 100) : 0;
      sub = `${del} of ${totalS} schools delivered LEC ${n}`;
    } else if (metric === 'recruitment') {
      const rec = sum(rdT1, (d) => N(d.total_scholars_recruited));
      const tar = totalS * 45;
      val = tar > 0 ? Math.round((rec / tar) * 100) : 0;
      sub = `${rec.toLocaleString()} of ${tar.toLocaleString()} target`;
    } else if (metric === 'avg_scholars') {
      val = avgScholarsPerLec(rd, lecNums);
      sub = 'per school per session';
    } else if (metric === 'pb_quality') {
      const src = rdT1.length > 0 ? rdT1 : rd;
      const q = sum(src, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
      const t = sum(src, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
      val = t > 0 ? Math.round((q / t) * 100) : 0;
      sub = `${q.toLocaleString()} of ${t.toLocaleString()} rated ≥2`;
    } else if (metric === 'observations') {
      const mentors = sum(rdObs, (d) => N(d.total_active_mentors));
      const observed = sum(rdObs, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
      val = mentors > 0 ? Math.round((observed / mentors) * 100) : 0;
      sub = `${observed} of ${mentors} mentors observed`;
    } else if (metric === 'retention') {
      const activated = sum(rdT1, (d) => N(d.lec2_scholars));
      const { lastLecScholars } = resolveLastLecScholars(rd, lecNums);
      const base = activated > 0 ? activated : sum(rdT1, (d) => N(d.total_scholars_recruited));
      val = base > 0 ? Math.round((lastLecScholars / base) * 100) : 0;
      sub = `${lastLecScholars.toLocaleString()} of ${base.toLocaleString()} activated`;
    } else if (metric === 'report_timeliness') {
      const s = getReportTimelinessSummary(rd);
      val = s.onTrackPct;
      sub = `${s.onTrack} on track of ${s.total} reports`;
    } else if (metric === 'gm') {
      const gm = sum(rd, (d) => N(d.schools_with_gm));
      val = totalS > 0 ? Math.round((gm / totalS) * 100) : 0;
      sub = `${gm} of ${totalS} schools`;
    } else if (metric === 'total_schools') {
      val = totalS;
      sub = `${new Set(forSchools.map((d) => d.cu).filter(Boolean)).size} CUs`;
    } else {
      val = totalS;
      sub = '';
    }
    return { region: reg, val, sub };
  });
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
          <div style={{ marginBottom: '.6rem' }}>
            <strong style={{ color: C.navy }}>{d.label}</strong>
          </div>
          <div style={{ marginBottom: '.5rem' }}>
            <span style={{ fontWeight: 600, color: '#555' }}>What it measures: </span>
            {d.what}
          </div>
          <div style={{ marginBottom: '.5rem', background: '#f0f4f8', borderRadius: 5, padding: '.4rem .65rem', fontFamily: 'monospace', fontSize: '.74rem', color: '#1a1a2e' }}>
            <span style={{ fontWeight: 700 }}>Formula: </span>
            {d.formula}
          </div>
          <div style={{ marginBottom: '.5rem' }}>
            <span style={{ fontWeight: 600, color: '#555' }}>Data source: </span>
            <span style={{ fontFamily: 'monospace', fontSize: '.73rem' }}>{d.source}</span>
          </div>
          <div style={{ marginBottom: '.5rem' }}>
            <span style={{ fontWeight: 600, color: '#555' }}>Thresholds: </span>
            {d.threshold}
          </div>
          <div style={{ borderTop: '.5px dashed #dee2e6', paddingTop: '.5rem', color: '#666', fontStyle: 'italic' }}>💡 {d.note}</div>
        </div>
      ) : null}
    </div>
  );
}

export default function DrillPanel({ drill, summaryData, year, term, onClose }) {
  if (!drill) return null;
  const { metric, lecNum } = drill;
  const label = metric === 'lec_single' ? `LEC ${lecNum || ''}` : METRIC_LABELS[metric] || metric;
  const isPct = !['avg_scholars', 'total_schools'].includes(metric);
  const rows = computeRegionalRows(metric, summaryData, year, term, lecNum);

  return (
    <>
      <div className="drill-backdrop" onClick={onClose} />
      <aside className="drill-panel" role="dialog" aria-label={`${label} breakdown`}>
        <div className="drill-head">
          <button className="drill-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="drill-crumbs">
            <span style={{ color: C.navy, fontWeight: 600 }}>{label} — All Regions</span>
          </div>
          <div className="drill-title">{label}</div>
          <div className="drill-subtitle">Regional breakdown</div>
        </div>
        <div className="drill-body">
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Region</th>
                <th className="center">Value</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.region}>
                  <td className="item-name">{r.region}</td>
                  <td className="center" style={{ fontWeight: 800, color: isPct ? ragColor(r.val) : C.navy }}>
                    {r.val}
                    {isPct ? '%' : ''}
                  </td>
                  <td style={{ color: '#555' }}>{r.sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MetricDefCard metric={metric} />
        </div>
      </aside>
    </>
  );
}
