import { useMemo, useState } from 'react';
import { getLECsForTerm, C, TERM_CONFIG } from '../lib/config.js';
import {
  computeNationalKpis,
  computeScholarFunnel,
  getTermMetrics,
  computeObsCoverageByRegion,
  getReportTimelinessSummary,
  computeNonScholar,
  buildLecWeekMatrix,
  computeNationalInsights,
  computeLecClusters,
  avgScholarsPerLec,
  sum,
} from '../lib/metrics.js';
import { ragColor, ragKpiClass, delta, num, getGMLabel } from '../lib/format.js';
import { Section, KpiHeroCard, MetricTile, ProgressCell, StackedBar, Placeholder } from '../components/ui.jsx';

const REGIONS = ['Central', 'East', 'North', 'South', 'West'];

const N = (v) => Number(v) || 0;
const TABS = [
  { id: 'exec', label: '📊 Executive Summary' },
  { id: 'lec', label: '📚 LEC Delivery' },
  { id: 'pb', label: '📋 Passbook Quality' },
  { id: 'quality', label: '🏅 Programme Quality' },
];

// ── Executive Summary ────────────────────────────────────────────────────────
function ExecTab({ summaryData, data, year, term, onDrill }) {
  const k = useMemo(() => computeNationalKpis(summaryData, data, year, term), [summaryData, data, year, term]);
  const funnel = useMemo(() => computeScholarFunnel(summaryData, data, year, term), [summaryData, data, year, term]);
  const staticNote = term !== 'term1' ? ' (T1)' : '';

  // Term comparison
  const TERM_ORDER = ['term1', 'term2', 'term3'];
  const ti = TERM_ORDER.indexOf(term);
  let prevTerm;
  let prevYear;
  let prevLabel;
  if (ti === 0) {
    prevTerm = 'term3';
    prevYear = String(parseInt(year, 10) - 1);
    prevLabel = `Term 3 ${prevYear}`;
  } else if (ti > 0) {
    prevTerm = TERM_ORDER[ti - 1];
    prevYear = year;
    prevLabel = `Term ${ti} ${prevYear}`;
  }
  const cur = useMemo(() => (term === 'all' ? null : getTermMetrics(summaryData, year, term, null)), [summaryData, year, term]);
  const prev = useMemo(() => (prevTerm ? getTermMetrics(summaryData, prevYear, prevTerm, null) : null), [summaryData, prevYear, prevTerm]);
  const t1cmp = useMemo(() => (term === 'term2' ? getTermMetrics(summaryData, year, 'term1', null) : null), [summaryData, year, term]);
  const compareWith = t1cmp || prev;

  return (
    <>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">Executive Summary — Key Takeaways</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${k.lecDeliveryPct >= 80 ? '' : k.lecDeliveryPct >= 60 ? 'amber' : 'red'}`} />
            <div>
              LEC delivery at <strong>{k.lecDeliveryPct}%</strong> — {num(k.lecsDelivered)} of {num(k.lecsExpected)} sessions delivered.
            </div>
          </div>
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${k.recruitmentRate >= 95 ? '' : k.recruitmentRate >= 80 ? 'amber' : 'red'}`} />
            <div>
              Recruitment at <strong>{k.recruitmentRate}%</strong> of a {num(k.totalTarget)} scholar target (45/school).
            </div>
          </div>
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${k.observationRate >= 80 ? '' : k.observationRate >= 50 ? 'amber' : 'red'}`} />
            <div>
              Mentor observation coverage at <strong>{k.observationRate}%</strong> — {k.unobserved} unobserved.
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-hero-strip">
        <KpiHeroCard
          label="LEC Delivery"
          valueClass={ragKpiClass(k.lecDeliveryPct)}
          value={k.lecDeliveryPct}
          unit="%"
          trend={`${num(k.lecsDelivered)} of ${num(k.lecsExpected)} sessions`}
          sub={`${k.lecNums.length} LEC${k.lecNums.length !== 1 ? 's' : ''} this term · ${k.totalSchools} schools`}
          drill="⌕ Regional breakdown"
          onClick={() => onDrill({ metric: 'lec_delivery' })}
        />
        <KpiHeroCard
          label={`Scholar Recruitment${staticNote}`}
          valueClass={ragKpiClass(k.recruitmentRate, 95, 80)}
          value={k.recruitmentRate}
          unit="%"
          trend={`${num(k.totalRecruited)} recruited`}
          sub={<>Target: <strong>{num(k.totalTarget)}</strong> (45/school)</>}
          drill="⌕ Regional breakdown"
          onClick={() => onDrill({ metric: 'recruitment' })}
        />
        <KpiHeroCard
          label="Avg Scholars / LEC"
          valueClass="kpi-blue"
          value={k.avgScholars}
          trend="Per school per session"
          sub={<>Target: <strong>45</strong> scholars per school</>}
          drill="⌕ Regional breakdown"
          onClick={() => onDrill({ metric: 'avg_scholars' })}
        />
        <KpiHeroCard
          label={`PB Quality ${k.pbTermLabel}`.trim()}
          valueClass={k.qualityRate == null ? 'kpi-blue' : ragKpiClass(k.qualityRate)}
          value={k.qualityRate == null ? '—' : k.qualityRate}
          unit={k.qualityRate == null ? '' : '%'}
          trend={k.qualityRate == null ? 'No T2 milestone data yet' : 'Good + Excellent ratings'}
          sub={k.qualityRate == null ? 'M3/M4 data not yet collected' : <><strong>{num(k.pb2)}</strong> of {num(k.totalPB)} passbooks rated ≥2</>}
          drill="⌕ Regional breakdown"
          onClick={() => onDrill({ metric: 'pb_quality' })}
        />
        <KpiHeroCard
          label="Mentor Observation Coverage"
          valueClass={ragKpiClass(k.observationRate, 80, 50)}
          value={k.observationRate}
          unit="%"
          trend={`${k.observedMentors} of ${k.totalMentors} mentors observed`}
          sub={<>{k.unobserved > 0 ? <><strong style={{ color: '#F4A8A0' }}>{k.unobserved} unobserved</strong> · </> : null}{k.totalObsCount} total visits</>}
          drill="⌕ CU → mentor detail"
          onClick={() => onDrill({ metric: 'observations' })}
        />
        <KpiHeroCard
          label={`${k.retProjected ? 'Projected ' : ''}Scholar Retention`}
          valueClass={ragKpiClass(k.retentionPct, 95, 80)}
          value={k.retentionPct}
          unit="%"
          trend={k.retProjected ? 'Est. from last 2 LECs' : `LEC ${k.lastLec} vs activation`}
          sub={<>Activated: <strong>{num(k.activated)}</strong> at LEC 2</>}
          drill="⌕ View funnel"
          onClick={() => onDrill({ metric: 'retention' })}
        />
      </div>

      {cur ? (
        <Section title="📈 Term-on-Term Comparison" subtitle={`${term.replace('term', 'Term ')} ${year} vs ${t1cmp ? `Term 1 ${year}` : prevLabel}${!compareWith ? ' — no prior term data available' : ''}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
            <CompareCard label="LEC Delivery" cur={`${cur.lecPct}%`} compare={compareWith ? `${compareWith.lecPct}%` : '–'} compareLabel={t1cmp ? `Term 1 ${year}` : prevLabel} tr={delta(cur.lecPct, compareWith?.lecPct)} metric="lec_delivery" onDrill={onDrill} termYear={`${term.replace('term', 'Term ')} ${year}`} />
            <CompareCard label="Avg Scholars / LEC" cur={cur.avgScholars} compare={compareWith ? compareWith.avgScholars : '–'} compareLabel={t1cmp ? `Term 1 ${year}` : prevLabel} tr={delta(cur.avgScholars, compareWith?.avgScholars)} metric="avg_scholars" onDrill={onDrill} termYear={`${term.replace('term', 'Term ')} ${year}`} />
            <CompareCard label={`${cur.isProjected ? '📈 Projected Retention' : 'Scholar Retention'} (LEC ${cur.lastLec})`} cur={`${cur.retention}%${cur.isProjected ? ' (projected)' : ''}`} compare={compareWith ? `${compareWith.retention}%` : '–'} compareLabel={t1cmp ? `Term 1 ${year}` : prevLabel} tr={delta(cur.retention, compareWith?.retention)} metric="retention" onDrill={onDrill} termYear={`${term.replace('term', 'Term ')} ${year}`} />
            <CompareCard label="PB Quality" cur={`${cur.qualityPct}%`} compare={compareWith ? `${compareWith.qualityPct}%` : '–'} compareLabel={t1cmp ? `Term 1 ${year}` : prevLabel} tr={delta(cur.qualityPct, compareWith?.qualityPct)} metric="pb_quality" onDrill={onDrill} termYear={`${term.replace('term', 'Term ')} ${year}`} />
          </div>
        </Section>
      ) : null}

      <Section title="🎓 Scholar Participation Funnel" subtitle={`Recruited ${num(funnel.recruited)} · Activated ${num(funnel.activated)} · T1 baseline`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <FunnelStat title="Recruited" value={num(funnel.recruited)} note={`${funnel.recTarget > 0 ? ((funnel.recruited / funnel.recTarget) * 100).toFixed(0) : 0}% of ${num(funnel.recTarget)} target`} border={C.blue} bg="#f0f4ff" onClick={() => onDrill({ metric: 'recruitment' })} />
          <FunnelStat title="Activated (LEC 2)" value={num(funnel.activated)} note={`${funnel.activationPct}% of recruited`} border={C.yellow} bg="#fffbeb" onClick={() => onDrill({ metric: 'recruitment' })} />
          {funnel.isT2plus ? <FunnelStat title="T1 Completed (LEC 5)" value={num(funnel.t1Complete)} note={`${funnel.t1RetPct}% of recruited`} border={C.green} bg="#f0fdf4" onClick={() => onDrill({ metric: 'retention' })} /> : null}
          <FunnelStat title={`${funnel.retProjected ? '📈 Projected ' : ''}Retention (LEC ${funnel.lastLec})`} value={`${funnel.retentionPct}%`} note={`${funnel.retProjected ? '~' : ''}${num(funnel.lastLecScholars)} of ${num(funnel.retBase)} activated`} border={funnel.retentionPct >= 85 ? C.green : funnel.retentionPct >= 70 ? C.yellow : C.red} bg="#f0fdf4" onClick={() => onDrill({ metric: 'retention' })} />
        </div>
        <FunnelBar label={`Recruited (target: ${num(funnel.recTarget)})`} val={funnel.recruited} denom={funnel.recTarget} color={C.blue} onClick={() => onDrill({ metric: 'recruitment' })} />
        <FunnelBar label="Activated — attended LEC 2" val={funnel.activated} denom={funnel.recruited} color={C.yellow} onClick={() => onDrill({ metric: 'retention' })} />
        {funnel.isT2plus ? <FunnelBar label="T1 Completed — attended LEC 5" val={funnel.t1Complete} denom={funnel.activated} color={C.green} onClick={() => onDrill({ metric: 'retention' })} /> : null}
        <FunnelBar label={`${funnel.retProjected ? '📈 Projected ' : ''}Retention — LEC ${funnel.lastLec}`} val={funnel.lastLecScholars} denom={funnel.retBase} color={funnel.retentionPct >= 85 ? C.green : funnel.retentionPct >= 70 ? C.yellow : C.red} onClick={() => onDrill({ metric: 'retention' })} />
      </Section>
    </>
  );
}

function CompareCard({ label, cur, compare, compareLabel, tr, metric, onDrill, termYear }) {
  return (
    <div
      style={{ background: '#f8f9fa', borderRadius: 8, padding: '1.25rem', borderLeft: `4px solid ${C.blue}`, cursor: 'pointer' }}
      onClick={() => onDrill({ metric })}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.75rem' }}>
        <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: C.navy }}>{label}</div>
        <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕ drill</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '.7rem', color: '#888' }}>{termYear}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: C.navy }}>{cur}</div>
        </div>
        <div>
          <div style={{ fontSize: '.7rem', color: '#888' }}>{compareLabel}</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#777' }}>{compare}</div>
        </div>
        <div style={{ fontSize: '1.3rem', fontWeight: 700, color: tr.color }}>
          {tr.icon} <span style={{ fontSize: '.85rem' }}>{tr.text}</span>
        </div>
      </div>
    </div>
  );
}

function FunnelStat({ title, value, note, border, bg, onClick }) {
  return (
    <div onClick={onClick} style={{ background: bg, borderRadius: 8, padding: '1rem', borderLeft: `4px solid ${border}`, textAlign: 'center', cursor: 'pointer' }}>
      <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: C.navy }}>{title} <span style={{ fontSize: '.6rem', color: '#0077b6' }}>⌕</span></div>
      <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{value}</div>
      <div style={{ fontSize: '.8rem', color: '#555' }}>{note}</div>
    </div>
  );
}

function FunnelBar({ label, val, denom, color, onClick }) {
  const pct = denom > 0 ? Math.round((val / denom) * 100) : 0;
  return (
    <div style={{ marginBottom: '1.25rem', cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.3rem' }}>
        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{num(val)} <small>({pct}%)</small></span>
      </div>
      <div style={{ height: 20, background: '#e9ecef', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 10 }} />
      </div>
    </div>
  );
}

// ── LEC Delivery tab ─────────────────────────────────────────────────────────
function LecTab({ summaryData, schoolData, data, year, term, onDrill }) {
  const lecNums = term === 'all'
    ? [...(TERM_CONFIG.term1?.lecs || []), ...(TERM_CONFIG.term2?.lecs || [])]
    : getLECsForTerm(year, term);
  const uniqueCURows = term === 'all' ? [...new Map(data.map((d) => [d.cu, d])).values()] : data;
  const totalSchools = sum(uniqueCURows, (d) => N(d.total_target_schools));

  const lecRows = lecNums.map((n) => {
    const schoolsWith = sum(data, (d) => N(d[`schools_with_lec${n}`]));
    const scholars = sum(data, (d) => N(d[`lec${n}_scholars`]));
    const nonScholars = sum(data, (d) => N(d[`lec${n}_non_scholars`]));
    const compPct = totalSchools > 0 ? Math.round((schoolsWith / totalSchools) * 100) : 0;
    const avgS = schoolsWith > 0 ? (scholars / schoolsWith).toFixed(1) : '—';
    return { label: `LEC ${n}`, lecNum: n, schoolsWith, scholars, nonScholars, compPct, avgS };
  });

  const insights = useMemo(() => computeNationalInsights(summaryData, data, year, term === 'all' ? 'term1' : term), [summaryData, data, year, term]);
  const clusters = useMemo(() => computeLecClusters(schoolData, year, term), [schoolData, year, term]);

  const matrix = useMemo(() => buildLecWeekMatrix(schoolData, year, term === 'all' ? 'term1' : term), [schoolData, year, term]);
  const weeks = [...new Set(lecNums.flatMap((n) => Object.keys(matrix[`lec${n}`] || {})))].sort(
    (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0),
  );
  const allVals = lecNums.flatMap((n) => Object.values(matrix[`lec${n}`] || {}));
  const globalMax = Math.max(...allVals, 1);

  return (
    <>
      <LecTabInsights data={data} year={year} term={term} onDrill={onDrill} />
      <Section title="✅ Activity Completion & Participation" subtitle="Skills Lab sessions delivered with scholar participation">
        <div className="metric-tiles">
          {lecRows.map((r) => {
            const status = r.compPct >= 80 ? 'on' : r.compPct >= 60 ? 'near' : 'off';
            const statusLabel = r.compPct >= 80 ? 'On Track' : r.compPct >= 60 ? 'Near Target' : 'Behind';
            return (
              <MetricTile
                key={r.lecNum}
                label={r.label}
                value={r.schoolsWith}
                valueSuffix={`/ ${totalSchools}`}
                status={status}
                statusLabel={statusLabel}
                pct={r.compPct}
                fill={r.compPct >= 80 ? '#2e7d5a' : r.compPct >= 60 ? '#C38A1F' : '#C9554A'}
                diag={r.scholars > 0 ? `${num(r.scholars)} scholars · avg ${r.avgS}/school${r.nonScholars > 0 ? ` · ${num(r.nonScholars)} non-scholars` : ''}` : 'No attendance data yet'}
                onClick={() => onDrill({ metric: 'lec_single', lecNum: r.lecNum })}
              />
            );
          })}
        </div>
      </Section>

      <Section title="📅 Skills Lab Activity Heatmap" subtitle="LEC × Week delivery timeline (#schools)">
        {weeks.length === 0 ? (
          <Placeholder label="No LEC delivery data yet for this term." />
        ) : (
          <div className="table-wrap">
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '.5rem .75rem', background: '#f8f9fa', fontWeight: 700, color: C.navy }}>LEC</th>
                  {weeks.map((w) => (
                    <th key={w} style={{ minWidth: 56, textAlign: 'center', padding: '.4rem .25rem', fontSize: '.72rem', color: '#555', background: '#f8f9fa' }}>{w}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lecNums.map((n) => {
                  const lecData = matrix[`lec${n}`] || {};
                  return (
                    <tr key={n} style={{ borderBottom: '1px solid #e9ecef' }}>
                      <th style={{ textAlign: 'left', padding: '.45rem .75rem', fontWeight: 700, color: C.navy, background: '#fafbff' }}>LEC {n}</th>
                      {weeks.map((w) => {
                        const count = lecData[w] || 0;
                        const intensity = count ? Math.max(0.12, (count / globalMax) * 0.85 + 0.1) : 0;
                        const bg = count ? `rgba(13,71,161,${intensity.toFixed(2)})` : '#f8f9fa';
                        const fg = count / globalMax > 0.55 ? '#fff' : '#0d47a1';
                        return (
                          <td key={w} style={{ padding: 3 }}>
                            <div style={{ background: bg, borderRadius: 5, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '.85rem', color: fg }}>{count > 0 ? count : ''}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <LecKeyInsights onDrill={onDrill} clusters={clusters} insights={insights} />
    </>
  );
}

// ── LEC tab · Key Insights & Flags (legacy renderNationalKeyInsights + clustering) ─
function LecKeyInsights({ onDrill, clusters, insights }) {
  const colors = { warning: '#fff3cd', alert: '#f8d7da', info: '#e7f3ff' };
  const borders = { warning: C.yellow, alert: C.red, info: C.blue };
  return (
    <>
      <Section title="🔑 Key Insights & Flags" subtitle={insights.length > 0 ? `${insights.length} issue${insights.length > 1 ? 's' : ''} flagged` : 'CUs needing attention'}>
        {insights.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: C.green }}>✅ No critical issues detected across all CUs.</div>
        ) : (
          insights.map((ins, idx) => (
            <div
              key={idx}
              onClick={() => onDrill({ metric: ins.metric })}
              style={{ background: colors[ins.type], borderLeft: `4px solid ${borders[ins.type]}`, borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, marginBottom: '.35rem' }}>{ins.icon} {ins.title} <span style={{ fontSize: '.7rem', color: '#0077b6' }}>⌕ drill</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                {ins.cus.map((c, i) => (
                  <span key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 999, padding: '.15rem .6rem', fontSize: '.78rem', color: '#333' }}>
                    {c.cu}{c.note ? ` (${c.note})` : ''}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title="⚡ LEC Sequencing Flags" subtitle="Schools delivering 3+ LECs in a single week (compressed pacing)">
        {clusters.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', color: C.green }}>✅ No LEC clustering detected this term.</div>
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead>
                <tr>
                  <th>School</th>
                  <th>CU</th>
                  <th>Region</th>
                  <th className="center">Max LECs / Week</th>
                  <th>Worst Week</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c, i) => (
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
        )}
      </Section>
    </>
  );
}

function LecTabInsights({ data, year, term, onDrill }) {
  const lecNums = getLECsForTerm(year, term);
  const totalS = sum(data, (d) => N(d.total_target_schools));
  const delivered = sum(data, (d) => lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
  const expected = totalS * lecNums.length;
  const lecPct = expected > 0 ? Math.round((delivered / expected) * 100) : 0;
  const durVals = data.map((d) => N(d.avg_lec_session_duration)).filter((v) => v > 0);
  const avgDur = durVals.length > 0 ? Math.round(durVals.reduce((s, v) => s + v, 0) / durVals.length) : 0;
  const lec6 = sum(data, (d) => N(d.schools_with_lec6));
  const lec6Pct = totalS > 0 ? Math.round((lec6 / totalS) * 100) : 0;
  const lec14 = sum(data, (d) => N(d.schools_with_lec14));
  const lec14Pct = totalS > 0 ? Math.round((lec14 / totalS) * 100) : 0;
  const avgSch = avgScholarsPerLec(data, lecNums);

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">📚 LEC Delivery — Key Insights</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${lecPct >= 80 ? '' : 'amber'}`} />
            <div><strong>{lecPct}% sessions delivered</strong> — {num(delivered)} of {num(expected)}.</div>
          </div>
        </div>
      </div>
      <div className="kpi-hero-strip">
        <KpiHeroCard label="LEC Delivery" valueClass={ragKpiClass(lecPct)} value={lecPct} unit="%" sub={`${num(delivered)} / ${num(expected)} sessions`} drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'lec_delivery' })} />
        <KpiHeroCard label="Avg Scholars/LEC" valueClass={ragKpiClass(avgSch, 45, 35)} value={avgSch} sub="across delivered sessions" drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'avg_scholars' })} />
        <KpiHeroCard label="Avg Session Duration" valueClass={avgDur >= 70 && avgDur <= 90 ? 'kpi-green' : avgDur > 0 ? 'kpi-amber' : ''} value={avgDur > 0 ? avgDur : '—'} unit={avgDur > 0 ? ' min' : ''} sub="Target: 70–90 min" drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'lec_duration' })} />
        <KpiHeroCard label="LEC 6 (T2 Start)" valueClass={lec6Pct >= 80 ? 'kpi-green' : lec6Pct >= 60 ? 'kpi-amber' : lec6Pct > 0 ? 'kpi-red' : ''} value={lec6Pct} unit="%" sub={`${lec6} of ${totalS} schools`} drill="⌕ drill" onClick={() => onDrill({ metric: 'lec_single', lecNum: 6 })} />
        <KpiHeroCard label="LEC 14 (Final)" valueClass={lec14Pct >= 80 ? 'kpi-green' : lec14Pct >= 60 ? 'kpi-amber' : lec14Pct > 0 ? 'kpi-red' : ''} value={lec14Pct} unit="%" sub={`${lec14} of ${totalS} schools`} drill="⌕ drill" onClick={() => onDrill({ metric: 'lec_single', lecNum: 14 })} />
      </div>
    </div>
  );
}

// ── Passbook Quality tab ─────────────────────────────────────────────────────
function PbTab({ summaryData, data, year, term, onDrill }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      <PbTabInsights summaryData={summaryData} data={data} year={year} onDrill={onDrill} />
      <Section title="📋 PB Milestone Completion" subtitle="Schools that reported each milestone, by region">
        <PbMilestoneCompletion summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} />
      </Section>
      <Section title="📋 PB Quality by Milestone" subtitle="Good + Excellent ratings (score ≥ 2) by region">
        <PbQualityTable summaryData={summaryData} data={data} year={year} term={term} showAll={showAll} onToggle={() => setShowAll((s) => !s)} onDrill={onDrill} />
      </Section>
      <Section title="👥 Group Mentoring Completion" subtitle="Group Mentoring sessions by region">
        <GmCompletion data={data} />
      </Section>
    </>
  );
}

function PbTabInsights({ summaryData, data, year, onDrill }) {
  const t1 = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const src = t1.length > 0 ? t1 : data;
  const totalS = sum(data, (d) => N(d.total_target_schools));
  const pb2t1 = sum(src, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
  const pbTt1 = sum(src, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
  const pbPctT1 = pbTt1 > 0 ? Math.round((pb2t1 / pbTt1) * 100) : 0;
  const m1done = sum(src, (d) => N(d.schools_completed_m1));
  const m1Pct = totalS > 0 ? Math.round((m1done / totalS) * 100) : 0;
  const t2src = summaryData.filter((d) => d.year == year && d.term === 'term2');
  const pb2t2 = sum(t2src, (d) => N(d.m3_quality_rated) + N(d.m4_quality_rated));
  const pbTt2 = sum(t2src, (d) => N(d.m3_total_rated) + N(d.m4_total_rated));
  const pbPctT2 = pbTt2 > 0 ? Math.round((pb2t2 / pbTt2) * 100) : 0;
  const m3done = sum(t2src, (d) => N(d.schools_completed_m3));
  const m3Pct = totalS > 0 ? Math.round((m3done / totalS) * 100) : 0;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">📋 Passbook Quality — Key Insights</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${pbPctT1 >= 80 ? '' : 'amber'}`} />
            <div>T1 PB quality at <strong>{pbPctT1}%</strong> — {num(pb2t1)} of {num(pbTt1)} rated Good or Excellent.</div>
          </div>
          <div className="kt-strip-item">
            <div className="kt-strip-bar" />
            <div>M1 completion: <strong>{m1done}</strong> of {totalS} schools ({m1Pct}%).</div>
          </div>
        </div>
      </div>
      <div className="kpi-hero-strip">
        <KpiHeroCard label="PB Quality (T1 M1+M2)" valueClass={ragKpiClass(pbPctT1)} value={pbPctT1} unit="%" sub={`${num(pb2t1)} of ${num(pbTt1)} rated ≥2`} drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'pb_quality' })} />
        <KpiHeroCard label="PB Quality (T2 M3+M4)" valueClass={pbTt2 > 0 ? ragKpiClass(pbPctT2) : 'kpi-blue'} value={pbTt2 > 0 ? pbPctT2 : '—'} unit={pbTt2 > 0 ? '%' : ''} sub={pbTt2 > 0 ? `${num(pb2t2)} of ${num(pbTt2)} rated ≥2` : 'No T2 milestone data yet'} drill={pbTt2 > 0 ? '⌕ Regional breakdown' : 'Awaiting M3+M4 data'} onClick={() => onDrill({ metric: 'pb_quality' })} />
        <KpiHeroCard label="M1 Completed (T1)" valueClass={ragKpiClass(m1Pct)} value={m1Pct} unit="%" sub={`${m1done} of ${totalS} schools`} drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'pb_completion' })} />
        <KpiHeroCard label="M3 Completed (T2)" valueClass={m3done > 0 ? ragKpiClass(m3Pct) : 'kpi-blue'} value={m3done > 0 ? m3Pct : '—'} unit={m3done > 0 ? '%' : ''} sub={m3done > 0 ? `${m3done} of ${totalS} schools` : 'No T2 completion data yet'} drill={m3done > 0 ? '⌕ Regional breakdown' : 'Awaiting M3 data'} onClick={() => onDrill({ metric: 'pb_completion' })} />
      </div>
    </div>
  );
}

function PbQualityTable({ summaryData, year, term, showAll, onToggle, onDrill }) {
  const termMsMap = { term1: ['m1', 'm2'], term2: ['m3', 'm4'], term3: ['m5', 'm6'] };
  let msKeys = showAll ? ['m1', 'm2', 'm3', 'm4'].filter((k) => summaryData.some((d) => N(d[`${k}_total_rated`]) > 0)) : (termMsMap[term] || ['m1', 'm2']);
  const dataTerm = msKeys.some((k) => ['m1', 'm2'].includes(k)) ? 'term1' : 'term2';
  let pbSrc = showAll ? summaryData.filter((d) => d.year == year) : summaryData.filter((d) => d.year == year && d.term === dataTerm);
  if (!showAll && pbSrc.length === 0) pbSrc = summaryData.filter((d) => d.year == year);

  const allMs = msKeys.map((k) => ({ key: k, label: `Milestone ${k.slice(1)}` })).filter((m) => pbSrc.some((d) => N(d[`${m.key}_total_rated`]) > 0));
  const regions = [...new Set(pbSrc.map((d) => d.region).filter(Boolean))].sort();
  const qCol = (p) => ragColor(p);

  const bar = (r0, r1, r2, r3) => {
    const tot = r0 + r1 + r2 + r3;
    if (!tot) return { segments: [] };
    const seg = (v, color, label) => (v > 0 ? [{ pct: Math.round((v / tot) * 100), color, label }] : []);
    return { segments: [...seg(r0, '#adb5bd', 'Not Observed'), ...seg(r1, '#dc3545', 'Poor'), ...seg(r2, '#20c997', 'Good'), ...seg(r3, '#198754', 'Excellent')] };
  };

  if (allMs.length === 0) {
    return <Placeholder label={`No passbook milestone data yet for ${showAll ? 'any term' : term.replace('term', 'Term ')}.`} />;
  }

  let natTotal = 0;
  let natQual = 0;
  let natR = [0, 0, 0, 0];
  allMs.forEach((m) => {
    natTotal += sum(pbSrc, (d) => N(d[`${m.key}_total_rated`]));
    natQual += sum(pbSrc, (d) => N(d[`${m.key}_quality_rated`]));
    [0, 1, 2, 3].forEach((r) => {
      natR[r] += sum(pbSrc, (d) => N(d[`${m.key}_total_rating_${r}`]));
    });
  });
  const natQP = natTotal > 0 ? Math.round((natQual / natTotal) * 100) : 0;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={onToggle}
          style={{ padding: '.35rem .9rem', borderRadius: 20, fontSize: '.8rem', fontWeight: 700, border: `1px solid ${C.blue}`, background: !showAll ? C.blue : '#fff', color: !showAll ? '#fff' : C.blue, cursor: 'pointer' }}
        >
          {showAll ? 'Show all terms' : `📌 ${term.replace('term', 'Term ')} Only`}
        </button>
        <span style={{ fontSize: '.8rem', color: '#888' }}>
          Showing: {showAll ? 'All terms combined' : `${term.replace('term', 'Term ')} milestones (${msKeys.map((k) => 'M' + k.slice(1)).join(', ')})`}
        </span>
      </div>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="center">Schools M1</th>
              <th className="center">Quality</th>
              {allMs.map((m) => (
                <th key={m.key} className="center" style={{ minWidth: 100 }}>{m.label}</th>
              ))}
              <th style={{ minWidth: 130 }}>Distribution</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => {
              const rd = pbSrc.filter((d) => d.region === region);
              const r = [0, 1, 2, 3].map((idx) => allMs.reduce((s, m) => s + sum(rd, (d) => N(d[`${m.key}_total_rating_${idx}`])), 0));
              const tot = r[0] + r[1] + r[2] + r[3];
              const qual = tot > 0 ? Math.round(((r[2] + r[3]) / tot) * 100) : null;
              const completionField = msKeys.includes('m3') && !msKeys.includes('m1') ? 'schools_completed_m3' : 'schools_completed_m1';
              const schRep = sum(rd, (d) => N(d[completionField]));
              const schTot = sum(rd, (d) => N(d.total_target_schools));
              return (
                <tr key={region} className="clickable" onClick={() => onDrill({ metric: 'pb_quality' })}>
                  <td style={{ fontWeight: 700 }}>{region} <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
                  <td className="center">{schRep}/{schTot}</td>
                  <td className="center" style={{ fontWeight: 700, color: qual !== null ? qCol(qual) : '#aaa' }}>{qual !== null ? `${qual}%` : '—'}</td>
                  {allMs.map((m) => {
                    const mT = sum(rd, (d) => N(d[`${m.key}_total_rated`]));
                    const mr = [0, 1, 2, 3].map((idx) => sum(rd, (d) => N(d[`${m.key}_total_rating_${idx}`])));
                    const mQ = sum(rd, (d) => N(d[`${m.key}_quality_rated`]));
                    const mQP = mT > 0 ? Math.round((mQ / mT) * 100) : null;
                    return (
                      <td key={m.key} className="center" style={{ minWidth: 100 }}>
                        {mT > 0 ? (
                          <>
                            <StackedBar segments={bar(...mr).segments} />
                            <div style={{ fontSize: '.75rem', fontWeight: 700, color: mQP !== null ? qCol(mQP) : '#aaa', marginTop: 2 }}>{mQP !== null ? `${mQP}%` : '—'}</div>
                          </>
                        ) : <span style={{ color: '#aaa' }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ minWidth: 130 }}><StackedBar segments={bar(r[0], r[1], r[2], r[3]).segments} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f8f9fa', fontWeight: 700, borderTop: '2px solid #dee2e6' }}>
              <td>NATIONAL</td>
              <td className="center">{sum(pbSrc, (d) => N(d.schools_completed_m1))}/{sum(pbSrc, (d) => N(d.total_target_schools))}</td>
              <td className="center" style={{ color: qCol(natQP), fontWeight: 800 }}>{natQP}%</td>
              {allMs.map((m) => {
                const mT = sum(pbSrc, (d) => N(d[`${m.key}_total_rated`]));
                const mQ = sum(pbSrc, (d) => N(d[`${m.key}_quality_rated`]));
                const mQP = mT > 0 ? Math.round((mQ / mT) * 100) : null;
                return <td key={m.key} className="center" style={{ color: mQP !== null ? qCol(mQP) : '#aaa', fontWeight: 700 }}>{mQP !== null ? `${mQP}%` : '—'}</td>;
              })}
              <td><StackedBar segments={bar(natR[0], natR[1], natR[2], natR[3]).segments} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ marginTop: '.5rem', fontSize: '.75rem', color: '#888' }}>
        ○ Not Observed (0) · 🔴 Poor (1) · 🟢 Good (2) · ★ Excellent (3) · Quality: &gt;2.5 Excellent · 2.0–2.5 Good · &lt;2.0 Poor
      </div>
    </>
  );
}

// ── PB Milestone Completion by region (legacy renderNationalPBMilestone, term-aware) ─
function PbMilestoneCompletion({ summaryData, data, year, term, onDrill }) {
  // Term → milestones + source rows. M1/M2 from T1 rows; M3/M4 from T2 rows.
  const t1 = summaryData.filter((d) => d.year == year && d.term === 'term1');
  const t2 = summaryData.filter((d) => d.year == year && d.term === 'term2');
  let milestones;
  if (term === 'term2') milestones = [{ m: 3, src: t2.length ? t2 : data }, { m: 4, src: t2.length ? t2 : data }];
  else if (term === 'all') milestones = [{ m: 1, src: t1 }, { m: 2, src: t1 }, { m: 3, src: t2 }, { m: 4, src: t2 }];
  else milestones = [{ m: 1, src: t1.length ? t1 : data }, { m: 2, src: t1.length ? t1 : data }];
  milestones = milestones.filter((ms) => ms.src.length > 0);
  if (milestones.length === 0) return <Placeholder label="No milestone completion data yet for this term." />;

  const regions = REGIONS.filter((reg) => data.some((d) => String(d.region || '').toLowerCase() === reg.toLowerCase()));
  const cell = (rows, m, regionFilter) => {
    const rd = regionFilter ? rows.filter((d) => String(d.region || '').toLowerCase() === regionFilter.toLowerCase()) : rows;
    const done = sum(rd, (d) => N(d[`schools_completed_m${m}`]));
    const tot = sum(rd, (d) => N(d.total_target_schools));
    const pct = tot > 0 ? Math.round((done / tot) * 100) : 0;
    return { done, tot, pct };
  };

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Region</th>
            {milestones.map((ms) => (
              <th key={ms.m} className="center">Milestone {ms.m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regions.map((region) => (
            <tr key={region} className="clickable" onClick={() => onDrill({ metric: 'pb_completion' })}>
              <td className="item-name">{region} <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
              {milestones.map((ms) => {
                const c = cell(ms.src, ms.m, region);
                return <td key={ms.m} className="center" style={{ fontWeight: 700, color: ragColor(c.pct) }}>{c.done}/{c.tot} ({c.pct}%)</td>;
              })}
            </tr>
          ))}
          <tr style={{ background: '#f8f9fa', fontWeight: 700, borderTop: `2px solid ${C.navy}` }}>
            <td>NATIONAL</td>
            {milestones.map((ms) => {
              const c = cell(ms.src, ms.m, null);
              return <td key={ms.m} className="center" style={{ color: ragColor(c.pct) }}>{c.done}/{c.tot} ({c.pct}%)</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GmCompletion({ data }) {
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Region</th>
            <th className="center">Schools</th>
            <th className="center">{getGMLabel()}</th>
            <th style={{ minWidth: 150 }}>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((region) => {
            const rd = data.filter((d) => d.region === region);
            const schools = sum(rd, (d) => N(d.total_target_schools));
            const gm = sum(rd, (d) => N(d.schools_with_gm));
            const pct = schools > 0 ? Math.round((gm / schools) * 100) : 0;
            return (
              <tr key={region}>
                <td className="item-name">{region}</td>
                <td className="center">{schools}</td>
                <td className="center"><strong>{gm}/{schools}</strong></td>
                <td><ProgressCell pct={pct} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Programme Quality tab ────────────────────────────────────────────────────
function QualityTab({ summaryData, schoolData, data, year, term, onDrill }) {
  const obs = useMemo(() => computeObsCoverageByRegion(data), [data]);
  const rt = useMemo(() => getReportTimelinessSummary(data), [data]);
  const ns = useMemo(() => computeNonScholar(schoolData, year, term), [schoolData, year, term]);
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();

  return (
    <>
      <div className="kpi-hero-strip" style={{ marginBottom: '1.5rem' }}>
        <KpiHeroCard label="Observation Coverage" valueClass={ragKpiClass(obs.totalCovPct, 80, 50)} value={obs.totalCovPct} unit="%" sub={`${obs.totalObserved}/${obs.totalMentors} mentors`} drill="⌕ Drill to mentors" onClick={() => onDrill({ metric: 'observations' })} />
        <KpiHeroCard label="Report Timeliness" valueClass={ragKpiClass(rt.onTrackPct, 70, 50)} value={rt.onTrackPct} unit="%" sub={`${rt.onTrack} on track of ${rt.total}`} drill="⌕ Drill to regions" onClick={() => onDrill({ metric: 'report_timeliness' })} />
        <KpiHeroCard label="Non-Scholar Participation" valueClass="kpi-blue" value={ns.pctWith} unit="%" sub={`${ns.withNS} of ${ns.total} schools`} drill="⌕ Drill to regions" onClick={() => onDrill({ metric: 'non_scholar' })} />
      </div>

      <Section title="👁️ Observation Coverage & Quality by Region" subtitle={`${obs.totalObserved} of ${obs.totalMentors} mentors observed`}>
        <div className="table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
            <thead>
              <tr style={{ background: C.navy, color: '#fff' }}>
                {['Region', 'Total Mentors', 'Observed', 'Coverage', 'Obs Count', 'Avg Score', 'Quality'].map((h, i) => (
                  <th key={h} style={{ padding: '.6rem .75rem', textAlign: i === 0 ? 'left' : 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {obs.rows.map((r) => (
                <tr key={r.region} className="clickable" onClick={() => onDrill({ metric: 'observations' })} style={{ borderBottom: '1px solid #e9ecef' }}>
                  <td style={{ padding: '.6rem .75rem', fontWeight: 700 }}>{r.region} <span style={{ fontSize: '.68rem', color: '#0077b6' }}>⌕</span></td>
                  <td style={{ textAlign: 'center' }}>{r.mentors}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: ragColor(r.covPct, 75, 50) }}>{r.observed}</td>
                  <td style={{ padding: '.5rem .75rem' }}><ProgressCell pct={r.covPct} color={ragColor(r.covPct, 75, 50)} /></td>
                  <td style={{ textAlign: 'center' }}>{r.obsCount}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.avgScore}</td>
                  <td style={{ textAlign: 'center' }}>{r.avgScore !== '—' ? (Number(r.avgScore) > 2.5 ? '🟢 Excellent' : Number(r.avgScore) >= 2.0 ? '🟡 Good' : '🔴 Poor') : '—'}</td>
                </tr>
              ))}
              <tr style={{ background: '#f0f4ff', borderTop: '2px solid #dee2e6', fontWeight: 800 }}>
                <td style={{ padding: '.6rem .75rem' }}>National Total</td>
                <td style={{ textAlign: 'center' }}>{obs.totalMentors}</td>
                <td style={{ textAlign: 'center', color: ragColor(obs.totalCovPct, 75, 50) }}>{obs.totalObserved}</td>
                <td style={{ padding: '.5rem .75rem' }}><ProgressCell pct={obs.totalCovPct} color={ragColor(obs.totalCovPct, 75, 50)} /></td>
                <td style={{ textAlign: 'center' }}>{obs.totalObs}</td>
                <td style={{ textAlign: 'center' }}>—</td>
                <td style={{ textAlign: 'center' }}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="👥 Non-Scholar Participation" subtitle="Distribution of schools by non-scholar attendance bucket">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '1rem' }}>
          {Object.entries(ns.buckets).map(([label, count]) => (
            <div key={label} style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'center', borderTop: `4px solid ${C.blue}` }}>
              <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>{label} non-scholars</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{count}</div>
              <div style={{ fontSize: '.8rem', color: '#888' }}>{ns.total > 0 ? Math.round((count / ns.total) * 100) : 0}% of schools</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`${term === 'term2' ? '🔬 Skills Day' : term === 'all' ? '🎉 Community Day / 🔬 Skills Day' : '🎉 Community Day'}`} subtitle="Delivery and attendance by region">
        <CommunitySkillsDay summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} />
      </Section>

      <Section title="🏛️ Club Milestones & BMP" subtitle="Club meetings and Business Model Presentation by region">
        <ClubMilestones summaryData={summaryData} data={data} year={year} term={term} />
      </Section>

      <Section title="📅 Activity Report Timeliness" subtitle={`${num(rt.total)} reports submitted · early + on-schedule = on track`}>
        <TimelinessLegend />
        <div className="table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
            <thead>
              <tr style={{ background: C.navy, color: '#fff' }}>
                {['Region', 'Total', 'Early', 'On Schedule', '1 Wk Delay', 'Late', 'Unscheduled', 'Breakdown'].map((h, i) => (
                  <th key={h} style={{ padding: '.6rem .75rem', textAlign: i === 0 || i === 7 ? 'left' : 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regions.map((region) => {
                const s = getReportTimelinessSummary(data.filter((d) => d.region === region));
                if (s.total === 0) return null;
                return (
                  <tr key={region} className="clickable" onClick={() => onDrill({ metric: 'report_timeliness' })} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '.5rem .75rem', fontWeight: 700 }}>{region} <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
                    <td style={{ textAlign: 'center' }}>{s.total}</td>
                    <td style={{ textAlign: 'center', color: '#198754', fontWeight: 700 }}>{s.early} ({s.earlyPct}%)</td>
                    <td style={{ textAlign: 'center', color: '#20c997', fontWeight: 700 }}>{s.onTime} ({s.onTimePct}%)</td>
                    <td style={{ textAlign: 'center', color: '#ffc107', fontWeight: 700 }}>{s.week1} ({s.week1Pct}%)</td>
                    <td style={{ textAlign: 'center', color: '#dc3545', fontWeight: 700 }}>{s.late} ({s.latePct}%)</td>
                    <td style={{ textAlign: 'center', color: '#adb5bd' }}>{s.unsched}</td>
                    <td style={{ padding: '.5rem .75rem', minWidth: 120 }}><TimelinessBar s={s} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ── Community Day (T1) / Skills Day (T2) by region (legacy renderNationalCommunityDay) ─
function CommunitySkillsDay({ summaryData, data, year, term, onDrill }) {
  const cuDedup = (rows) => [...new Map(rows.map((d) => [d.cu, d])).values()];
  const blocks = [];

  if (term === 'term1' || term === 'all') {
    const rows = term === 'all' ? summaryData.filter((d) => d.year == year && d.term === 'term1') : data;
    const cuRows = term === 'all' ? cuDedup(rows) : rows;
    const total = sum(cuRows, (d) => N(d.total_target_schools));
    const withCD = sum(cuRows, (d) => N(d.schools_with_community_day));
    const cdSch = sum(rows, (d) => N(d.cd_scholar_attendance));
    const cdNon = sum(rows, (d) => N(d.cd_non_scholar_attendance));
    const pct = total > 0 ? Math.round((withCD / total) * 100) : 0;
    const avg = withCD > 0 ? (cdSch / withCD).toFixed(1) : '—';
    const regRows = REGIONS.map((reg) => {
      const ru = cuRows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
      const rd = rows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
      const rs = sum(ru, (d) => N(d.total_target_schools));
      const rw = sum(ru, (d) => N(d.schools_with_community_day));
      const rP = rs > 0 ? Math.round((rw / rs) * 100) : 0;
      return { reg, rs, rw, rP, sch: sum(rd, (d) => N(d.cd_scholar_attendance)), ns: sum(rd, (d) => N(d.cd_non_scholar_attendance)) };
    });
    blocks.push(
      <div key="cd" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.6rem', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', color: C.navy }}>🎉 Community Day (T1)</div>
          <span style={{ fontSize: '1.4rem', fontWeight: 800, color: ragColor(pct) }}>{pct}%</span>
          <span style={{ fontSize: '.6rem', color: '#0077b6', cursor: 'pointer' }} onClick={() => onDrill({ metric: 'community_day' })}>⌕ drill</span>
          <span style={{ fontSize: '.85rem' }}><strong>{num(cdSch)}</strong> scholars · <strong>{num(cdNon)}</strong> non-scholars · Avg <strong>{avg}</strong>/school</span>
        </div>
        <table className="breakdown-table">
          <thead><tr><th>Region</th><th className="center">Delivery</th><th className="center">Scholars</th><th className="center">Non-Scholars</th></tr></thead>
          <tbody>
            {regRows.map((r) => (
              <tr key={r.reg}><td className="item-name">{r.reg}</td><td className="center" style={{ fontWeight: 700, color: ragColor(r.rP) }}>{r.rw}/{r.rs} ({r.rP}%)</td><td className="center">{num(r.sch)}</td><td className="center" style={{ color: '#888' }}>{num(r.ns)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  if (term === 'term2' || term === 'all') {
    const rows = term === 'all' ? summaryData.filter((d) => d.year == year && d.term === 'term2') : data;
    const cuRows = term === 'all' ? cuDedup(rows) : rows;
    const total = sum(cuRows, (d) => N(d.total_target_schools));
    const withSD = sum(cuRows, (d) => N(d.schools_with_skills_day));
    const sdSch = sum(rows, (d) => N(d.sd_total_scholars));
    const sdMale = sum(rows, (d) => N(d.sd_male_scholars));
    const sdFemale = sum(rows, (d) => N(d.sd_female_scholars));
    const sdNon = sum(rows, (d) => N(d.sd_total_non_scholars));
    const pct = total > 0 ? Math.round((withSD / total) * 100) : 0;
    const avg = withSD > 0 ? (sdSch / withSD).toFixed(1) : '—';
    if (withSD > 0) {
      const regRows = REGIONS.map((reg) => {
        const ru = cuRows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
        const rd = rows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
        const rs = sum(ru, (d) => N(d.total_target_schools));
        const rw = sum(ru, (d) => N(d.schools_with_skills_day));
        const rP = rs > 0 ? Math.round((rw / rs) * 100) : 0;
        const rSch = sum(rd, (d) => N(d.sd_total_scholars));
        const rMale = sum(rd, (d) => N(d.sd_male_scholars));
        const rFemale = sum(rd, (d) => N(d.sd_female_scholars));
        return { reg, rs, rw, rP, rSch, rMale, rFemale };
      });
      blocks.push(
        <div key="sd">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.6rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: C.navy }}>🔬 Skills Day (T2)</div>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: ragColor(pct) }}>{pct}%</span>
            <span style={{ fontSize: '.6rem', color: '#0077b6', cursor: 'pointer' }} onClick={() => onDrill({ metric: 'skills_day' })}>⌕ drill</span>
            <span style={{ fontSize: '.85rem' }}><strong>{withSD}</strong>/{total} schools · <strong>{num(sdSch)}</strong> scholars{sdMale > 0 || sdFemale > 0 ? <> · M <strong>{num(sdMale)}</strong> · F <strong>{num(sdFemale)}</strong></> : null}{sdNon > 0 ? <> · NS <strong>{num(sdNon)}</strong></> : null} · Avg <strong>{avg}</strong>/school</span>
          </div>
          <table className="breakdown-table">
            <thead><tr><th>Region</th><th className="center">Schools</th><th className="center">Scholars</th><th className="center" style={{ color: C.blue }}>Male</th><th className="center" style={{ color: C.red }}>Female</th></tr></thead>
            <tbody>
              {regRows.map((r) => (
                <tr key={r.reg}>
                  <td className="item-name">{r.reg}</td>
                  <td className="center" style={{ fontWeight: 700, color: ragColor(r.rP) }}>{r.rw}/{r.rs} ({r.rP}%)</td>
                  <td className="center">{num(r.rSch)}</td>
                  <td className="center" style={{ color: C.blue }}>{r.rMale > 0 ? `${num(r.rMale)} (${r.rSch > 0 ? Math.round((r.rMale / r.rSch) * 100) : 0}%)` : '—'}</td>
                  <td className="center" style={{ color: C.red }}>{r.rFemale > 0 ? `${num(r.rFemale)} (${r.rSch > 0 ? Math.round((r.rFemale / r.rSch) * 100) : 0}%)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
  }

  if (blocks.length === 0) return <Placeholder label="No community/skills day data for the selected term." />;
  return <div>{blocks}</div>;
}

// ── Club Milestones & BMP by region (legacy renderNationalClubMilestones) ─────
function ClubMilestones({ summaryData, data, year, term }) {
  const all = [
    { key: 'schools_with_club_meeting_1', label: 'Club Meeting 1', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_2', label: 'Club Meeting 2', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_3', label: 'Club Meeting 3', terms: ['term2', 'all'] },
    { key: 'schools_with_club_meeting_4', label: 'Club Meeting 4', terms: ['term2', 'all'] },
    { key: 'schools_with_bmp', label: 'Business Model Presentation', terms: ['term2', 'all'] },
  ];
  const active = all.filter((m) => m.terms.includes(term));
  if (active.length === 0) return <Placeholder label="No club milestones for the selected term." />;

  const rows = term === 'all' ? summaryData.filter((d) => d.year == year) : data;
  const cuRows = [...new Map(rows.map((d) => [d.cu, d])).values()];
  const total = sum(cuRows, (d) => N(d.total_target_schools));
  if (total === 0) return <Placeholder label="No club milestone data yet." />;
  const regions = REGIONS.filter((reg) => rows.some((d) => String(d.region || '').toLowerCase() === reg.toLowerCase()));

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Milestone</th>
            <th className="center">National</th>
            {regions.map((r) => (<th key={r} className="center">{r}</th>))}
          </tr>
        </thead>
        <tbody>
          {active.map((m) => {
            const natCount = sum(rows, (d) => N(d[m.key]));
            const natPct = total > 0 ? Math.round((natCount / total) * 100) : 0;
            return (
              <tr key={m.key}>
                <td className="item-name">{m.label}</td>
                <td className="center" style={{ fontWeight: 700, color: ragColor(natPct) }}>{natCount}/{total} ({natPct}%)</td>
                {regions.map((reg) => {
                  const rr = rows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
                  const rCU = [...new Map(rr.map((d) => [d.cu, d])).values()];
                  const rTot = sum(rCU, (d) => N(d.total_target_schools));
                  const rCount = sum(rr, (d) => N(d[m.key]));
                  const rP = rTot > 0 ? Math.round((rCount / rTot) * 100) : 0;
                  return <td key={reg} className="center" style={{ fontWeight: 600, color: rCount > 0 ? ragColor(rP) : '#ccc' }}>{rCount > 0 ? `${rCount} (${rP}%)` : '—'}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TimelinessBar({ s }) {
  const segments = [
    { label: 'Early', pct: s.earlyPct, color: '#198754' },
    { label: 'On schedule', pct: s.onTimePct, color: '#20c997' },
    { label: '1 wk delay', pct: s.week1Pct, color: '#ffc107' },
    { label: 'Late', pct: s.latePct, color: '#dc3545' },
    { label: 'Unscheduled', pct: s.unschedPct, color: '#adb5bd' },
  ].filter((b) => b.pct > 0);
  return <StackedBar segments={segments} height={12} />;
}

export function TimelinessLegend() {
  const items = [
    ['Early', '#198754'],
    ['On Schedule', '#20c997'],
    ['1 Wk Delay', '#ffc107'],
    ['Late', '#dc3545'],
    ['Unscheduled', '#adb5bd'],
  ];
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '.75rem', marginBottom: '1rem' }}>
      {items.map(([label, color]) => (
        <span key={label}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2, marginRight: 3 }} />
          {label}
        </span>
      ))}
    </div>
  );
}

export default function NationalView({ summaryData, schoolData, year, term, onDrill }) {
  const [tab, setTab] = useState('exec');
  const data = useMemo(
    () => summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term)),
    [summaryData, year, term],
  );

  if (data.length === 0) {
    return <Placeholder label="No data for the selected year / term." />;
  }

  return (
    <div>
      <div className="nat-tab-bar">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`nat-tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'exec' ? <ExecTab summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} /> : null}
      {tab === 'lec' ? <LecTab summaryData={summaryData} schoolData={schoolData} data={data} year={year} term={term} onDrill={onDrill} /> : null}
      {tab === 'pb' ? <PbTab summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} /> : null}
      {tab === 'quality' ? <QualityTab summaryData={summaryData} schoolData={schoolData} data={data} year={year} term={term} onDrill={onDrill} /> : null}
    </div>
  );
}
