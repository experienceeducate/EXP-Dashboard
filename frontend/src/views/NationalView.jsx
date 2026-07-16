import { useMemo, useState } from 'react';
import { getLECsForTerm, C, TERM_CONFIG } from '../lib/config.js';
import {
  computeNationalKpis,
  computeScholarFunnel,
  getTermMetrics,
  computeObsCoverageByRegion,
  getReportTimelinessSummary,
  computeNonScholar,
  computeNonScholarBreakdown,
  buildLecWeekMatrix,
  computeHeatmapHeader,
  computeNationalInsights,
  computeLecClusters,
  computeExecutiveInsights,
  getLECsDueByToday,
  avgScholarsPerLec,
  sum,
} from '../lib/metrics.js';
import { ragColor, ragKpiClass, delta, num, getGMLabel } from '../lib/format.js';
import { Section, KpiHeroCard, MetricTile, ProgressCell, StackedBar, ScoreCard, Placeholder } from '../components/ui.jsx';

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

  const regLecPcts = REGIONS.map((reg) => {
    const rd = data.filter((d) => String(d.region || '').trim().toLowerCase() === reg.toLowerCase());
    const rs = sum(rd, (d) => N(d.total_target_schools));
    const rd2 = sum(rd, (d) => k.lecNums.reduce((ls, n) => ls + N(d[`schools_with_lec${n}`]), 0));
    return { reg, pct: rs * k.lecNums.length > 0 ? Math.round((rd2 / (rs * k.lecNums.length)) * 100) : 0 };
  });
  const laggingRegions = regLecPcts.filter((r) => r.pct < 60).map((r) => r.reg);

  const takeaways = [];
  if (k.lecDeliveryPct >= 80) {
    takeaways.push({ bar: '', node: <><strong>LEC delivery is strong at {k.lecDeliveryPct}%</strong> — {num(k.lecsDelivered)} of {num(k.lecsExpected)} sessions delivered nationally. Programme is on track.</> });
  } else if (k.lecDeliveryPct >= 50) {
    takeaways.push({
      bar: 'amber',
      node: <><strong>LEC delivery at {k.lecDeliveryPct}%</strong> — {num(k.lecsDelivered)} sessions delivered. {laggingRegions.length > 0 ? <>{laggingRegions.join(', ')} {laggingRegions.length === 1 ? 'is' : 'are'} below 60% — needs targeted follow-up.</> : 'Check CU delivery plans.'}</>,
    });
  } else {
    takeaways.push({ bar: 'red', node: <><strong>LEC delivery critically low at {k.lecDeliveryPct}%</strong> — only {num(k.lecsDelivered)} of {num(k.lecsExpected)} expected sessions delivered. Escalation required.</> });
  }

  if (k.recruitmentRate >= 95) {
    takeaways.push({ bar: '', node: <><strong>Scholar recruitment on track at {k.recruitmentRate}%</strong> — {num(k.totalRecruited)} scholars recruited against a target of {num(k.totalTarget)}.</> });
  } else if (k.recruitmentRate >= 80) {
    takeaways.push({ bar: 'amber', node: <><strong>Scholar recruitment at {k.recruitmentRate}%</strong> ({num(k.totalRecruited)} of {num(k.totalTarget)} target). 1–2 CUs may need top-up recruitment support.</> });
  } else {
    takeaways.push({ bar: 'red', node: <><strong>Scholar recruitment below target at {k.recruitmentRate}%</strong> — {num(k.totalTarget - k.totalRecruited)} scholars short of the {num(k.totalTarget)} goal. Immediate CU follow-up needed.</> });
  }

  if (k.qualityRate != null) {
    if (k.qualityRate >= 80) {
      takeaways.push({ bar: '', node: <><strong>Passbook quality is excellent at {k.qualityRate}%</strong> — {num(k.pb2)} of {num(k.totalPB)} scholars rated Good or Excellent on milestones.</> });
    } else if (k.qualityRate >= 60) {
      takeaways.push({ bar: 'amber', node: <><strong>Passbook quality at {k.qualityRate}%</strong> — some regions may need targeted mentor coaching on passbook feedback practices.</> });
    } else {
      takeaways.push({ bar: 'red', node: <><strong>Passbook quality below threshold at {k.qualityRate}%</strong> — mentor feedback quality requires immediate attention across multiple CUs.</> });
    }
  }

  if (k.observationRate >= 80) {
    takeaways.push({ bar: '', node: <><strong>Mentor observation coverage strong at {k.observationRate}%</strong> — {k.observedMentors} of {k.totalMentors} mentors observed. FOA supervision on track.</> });
  } else if (k.observationRate >= 50) {
    const obsIsHistorical = term === 'term2' || term === 'term3' || term === 'all';
    takeaways.push({
      bar: 'amber',
      node: <><strong>Mentor observation coverage at {k.observationRate}%</strong> — {k.unobserved} mentor{k.unobserved !== 1 ? 's' : ''} {obsIsHistorical ? 'were not observed in Term 1' : 'still unobserved'}. {obsIsHistorical ? '(T1 campaign data — observations are conducted in Term 1)' : 'Prioritise FOA field visits in upcoming weeks.'}</>,
    });
  } else {
    takeaways.push({ bar: 'red', node: <><strong>Mentor observation coverage critically low at {k.observationRate}%</strong> — {k.unobserved} of {k.totalMentors} mentors have not been observed. Immediate FOA visit plan required.</> });
  }

  const execInsights = useMemo(() => computeExecutiveInsights(summaryData, data, year, term), [summaryData, data, year, term]);

  const funnelHeader = (() => {
    const recPct = funnel.recTarget > 0 ? Math.round((funnel.recruited / funnel.recTarget) * 100) : 0;
    const title = funnel.retProjected
      ? `🎓 ${recPct}% recruited · ${funnel.retentionPct}% projected retention (LEC ${funnel.lastLec} est. from avg of last 2 LECs)`
      : funnel.retentionPct >= 85
        ? `🎓 Strong retention — ${funnel.retentionPct}% at LEC ${funnel.lastLec} · ${recPct}% recruited vs target`
        : funnel.retentionPct >= 70
          ? `🎓 ${funnel.retentionPct}% retention at LEC ${funnel.lastLec} — ${100 - funnel.retentionPct}pp below 85% threshold · ${recPct}% recruited`
          : `🔴 Retention at risk — ${funnel.retentionPct}% at LEC ${funnel.lastLec} · ${recPct}% recruited vs target`;
    return { title, subtitle: `Recruited ${num(funnel.recruited)} · Activated ${num(funnel.activated)} · T1 baseline` };
  })();

  return (
    <>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">📋 Key Takeaways — National Overview</div>
        <div className="kt-strip-list">
          {takeaways.map((t, i) => (
            <div className="kt-strip-item" key={i}>
              <div className={`kt-strip-bar ${t.bar}`} />
              <div>{t.node}</div>
            </div>
          ))}
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

      <PerformanceInsights insights={execInsights} />

      <Section title={funnelHeader.title} subtitle={funnelHeader.subtitle}>
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

// ── Executive Summary — Performance Insights (legacy renderNationalDynamicInsights) ─
const INSIGHT_STYLES = {
  good: { bg: '#f0fdf4', border: C.green, icon: '#166534' },
  warn: { bg: '#fffbeb', border: C.yellow, icon: '#92400e' },
  risk: { bg: '#fef2f2', border: C.red, icon: '#991b1b' },
  info: { bg: '#eff6ff', border: C.blue, icon: '#1e3a8a' },
};

function DeltaText({ cur, prev, unit = '', decimals = 1 }) {
  if (!prev) return null;
  const diff = cur - prev;
  const sign = diff >= 0 ? '↑' : '↓';
  const color = diff >= 0 ? C.green : C.red;
  return <span style={{ color, fontWeight: 700 }}>{sign} {Math.abs(diff).toFixed(decimals)}{unit}</span>;
}

function insightContent(ins) {
  switch (ins.kind) {
    case 'retention_projection':
      return {
        title: `Projected retention at LEC ${ins.lastLec}: ${ins.projRetPct}%`,
        body: (
          <>
            Average scholars per session has {ins.t2Avg > ins.t1Avg ? 'increased' : 'decreased'} from <strong>{ins.t1Avg.toFixed(1)}</strong> in Term 1
            to <strong>{ins.t2Avg.toFixed(1)}</strong> in Term 2 (LECs {ins.recent2.join(' & ')}), <DeltaText cur={ins.t2Avg} prev={ins.t1Avg} /> per session.
            Projecting this rate across {ins.schoolCount.toLocaleString()} schools at LEC 14 gives <strong>~{ins.projLEC14.toLocaleString()} scholars</strong> —
            {' '}{ins.abovePct ? 'exceeding' : 'below'} the Term 1 activation baseline of {ins.t1Activated.toLocaleString()}.{' '}
            {ins.abovePct ? 'Schools are attracting more participants per session as the programme progresses.' : 'Some drop-off in attendance is expected; monitor low-delivery schools closely.'}
          </>
        ),
      };
    case 'lec_pace_dropoff':
      return {
        title: `LEC delivery pace: ${ins.firstPct}% → ${ins.lastPct}% from LEC ${ins.firstLec} to LEC ${ins.lastLec}`,
        body: (
          <>
            {ins.gap} percentage points separate the first and most recent LEC delivery rates. <strong>{ins.stillPending.toLocaleString()} schools</strong> have
            delivered LEC {ins.firstLec} but not yet LEC {ins.lastLec}. This sequencing gap is normal early in a term but should narrow week-by-week.{' '}
            {ins.gap >= 50 ? `The current gap is significant — FOAs should prioritise scheduling LEC ${ins.lastLec} with lagging schools.` : 'Continue monitoring to ensure schools keep pace with the programme calendar.'}
          </>
        ),
      };
    case 'non_scholar_trend':
      return {
        title: `Non-scholar attendance: ${ins.curNSRatio.toFixed(1)}% of scholars ${ins.termLabel} vs ${ins.t1NSRatio.toFixed(1)}% in T1`,
        body: (
          <>
            For every 100 scholars in {ins.termLabel}, there are <strong>{ins.curNSRatio.toFixed(1)} non-scholars</strong> ({ins.curNS.toLocaleString()} total),
            compared to <strong>{ins.t1NSRatio.toFixed(1)}</strong> per 100 in Term 1 — <DeltaText cur={ins.curNSRatio} prev={ins.t1NSRatio} unit=" pp" />.{' '}
            {Math.abs(ins.diff) < 3 ? 'Non-scholar participation is holding steady across terms.' : ins.diff > 0 ? 'Community interest is growing — mentors are drawing more non-scholars into sessions.' : 'Non-scholar participation has dipped. Mentors may be refocusing on enrolled scholars as the programme progresses.'}
          </>
        ),
      };
    case 'observation_flag':
      return {
        title: `${ins.obsPct}% mentor observation coverage — ${ins.unobsMen} mentors not yet observed`,
        body: (
          <>
            {ins.obsMen} of {ins.totalMen} active mentors have been observed at least once.{' '}
            {ins.unobsMen > 0 ? <><strong>{ins.unobsMen} mentor{ins.unobsMen !== 1 ? 's' : ''}</strong> have received no observation visit yet. </> : null}
            {ins.zeroObsCUs.length > 0 ? <><strong>{ins.zeroObsCUs.length} CU{ins.zeroObsCUs.length !== 1 ? 's' : ''} with zero observations</strong>: {ins.zeroObsCUs.slice(0, 5).join(', ')}{ins.zeroObsCUs.length > 5 ? ' +more' : ''}. </> : null}
            {ins.obsPct >= 80 ? 'Coverage is strong — focus remaining visits on CUs with zero observations.' : ins.obsPct >= 50 ? 'Coverage needs attention. Prioritise unobserved mentors in field visit planning.' : 'Observation coverage is critically low. Urgent action needed to schedule visits.'}
          </>
        ),
      };
    case 'pb_quality_flag':
      return {
        title: `PB quality nationally ${ins.pbPct}% — ${ins.belowAvg.length} region${ins.belowAvg.length !== 1 ? 's' : ''} below average`,
        body: (
          <>
            National passbook quality (Good + Excellent) stands at <strong>{ins.pbPct}%</strong>. The following region{ins.belowAvg.length !== 1 ? 's are' : ' is'} notably
            below that benchmark: {ins.belowAvg.map((r, i) => <span key={r.reg}>{i > 0 ? ', ' : ''}<strong>{r.reg}</strong> ({r.pct}%)</span>)}.{' '}
            {ins.belowAvg[0].pct < 70 ? 'Regions below 70% should prioritise passbook quality coaching in upcoming observations.' : 'A targeted review of rating practices in these regions may help close the gap.'}
          </>
        ),
      };
    default:
      return null;
  }
}

function PerformanceInsights({ insights }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div style={{ margin: '1.25rem 0 .5rem' }}>
      <div style={{ padding: '.5rem 0 .3rem', borderBottom: `2px solid ${C.navy}`, marginBottom: '.9rem' }}>
        <span style={{ fontSize: '.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: C.navy }}>💡 Performance Insights</span>
        <span style={{ fontSize: '.75rem', color: '#888', marginLeft: '.75rem' }}>Auto-generated from live data</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: '.9rem', marginBottom: '1rem' }}>
        {insights.map((ins, i) => {
          const content = insightContent(ins);
          if (!content) return null;
          const style = INSIGHT_STYLES[ins.level] || INSIGHT_STYLES.info;
          return (
            <div key={i} style={{ background: style.bg, borderLeft: `4px solid ${style.border}`, borderRadius: '0 8px 8px 0', padding: '.9rem 1rem', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
              <div style={{ fontWeight: 700, fontSize: '.88rem', color: style.icon, marginBottom: '.4rem', lineHeight: 1.35 }}>{ins.icon} {content.title}</div>
              <div style={{ fontSize: '.82rem', color: '#374151', lineHeight: 1.6 }}>{content.body}</div>
            </div>
          );
        })}
      </div>
    </div>
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

  // Skills Labs Total tile (legacy: totalLECSchoolDeliveries / lecDeliveryPct).
  const totalLECSchoolDeliveries = lecRows.reduce((s, r) => s + r.schoolsWith, 0);
  const totalLECScholars = lecRows.reduce((s, r) => s + r.scholars, 0);
  const lecsExpected = totalSchools * lecNums.length;
  const lecDeliveryPct = lecsExpected > 0 ? Math.round((totalLECSchoolDeliveries / lecsExpected) * 100) : 0;
  const avgLECScholars = totalLECSchoolDeliveries > 0 ? (totalLECScholars / totalLECSchoolDeliveries).toFixed(1) : '—';

  // GM 2 / GM 3 / GM Total tiles — fixed 825-school denominator per session (legacy).
  const GM2_TARGET = 825;
  const GM3_TARGET = 825;
  const GM_TOTAL_TARGET = GM2_TARGET + GM3_TARGET;
  const gm2Schools = sum(uniqueCURows, (d) => N(d.schools_with_gm2));
  const gm3Schools = sum(uniqueCURows, (d) => N(d.schools_with_gm3));
  const gm2Pct = Math.round((gm2Schools / GM2_TARGET) * 100);
  const gm3Pct = Math.round((gm3Schools / GM3_TARGET) * 100);
  const gmTotalSchools = gm2Schools + gm3Schools;
  const gmTotalPct = Math.round((gmTotalSchools / GM_TOTAL_TARGET) * 100);

  const insights = useMemo(() => computeNationalInsights(summaryData, data, year, term === 'all' ? 'term1' : term), [summaryData, data, year, term]);
  const clusters = useMemo(() => computeLecClusters(schoolData, year, term), [schoolData, year, term]);

  const matrix = useMemo(() => buildLecWeekMatrix(schoolData, year, term === 'all' ? 'term1' : term), [schoolData, year, term]);
  const weeks = [...new Set(lecNums.flatMap((n) => Object.keys(matrix[`lec${n}`] || {})))].sort(
    (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0),
  );
  const allVals = lecNums.flatMap((n) => Object.values(matrix[`lec${n}`] || {}));
  const globalMax = Math.max(...allVals, 1);

  const activityHeader = (() => {
    const gmSchTotal = sum(data, (d) => N(d.schools_with_gm));
    const gmSchPct = totalSchools > 0 ? Math.round((gmSchTotal / totalSchools) * 100) : 0;
    const termLbl = term === 'term2' ? 'T2' : term === 'term1' ? 'T1' : 'all terms';
    const leading = lecRows.reduce((best, r) => (r.compPct > (best?.pct || 0) ? { lecNum: r.lecNum, pct: r.compPct } : best), null);
    const leadingStr = leading ? `LEC ${leading.lecNum} leads at ${leading.pct}%` : null;
    const title = lecDeliveryPct >= 80
      ? `✅ Strong activity delivery — ${lecDeliveryPct}% of sessions completed${leadingStr ? ` · ${leadingStr}` : ''}`
      : lecDeliveryPct >= 50
        ? `⚠️ ${lecDeliveryPct}% LEC delivery${gmSchPct < 30 ? ` · GM at only ${gmSchPct}% — needs attention` : ''}`
        : `🔴 ${lecDeliveryPct}% LEC delivery — ${100 - lecDeliveryPct}pp gap to target${gmSchPct < 10 ? ` · GM critically low (${gmSchPct}%)` : ''}`;
    const subtitle = `${num(totalLECSchoolDeliveries)} of ${num(lecsExpected)} sessions · ${totalSchools} schools · ${termLbl}`;
    return { title, subtitle };
  })();

  const heatmapHeader = computeHeatmapHeader(matrix, lecNums, totalSchools);

  return (
    <>
      <LecTabInsights data={data} year={year} term={term} onDrill={onDrill} />
      <Section title={activityHeader.title} subtitle={activityHeader.subtitle}>
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
          <MetricTile
            label="Skills Labs Total"
            value={num(totalLECSchoolDeliveries)}
            valueSuffix="sessions"
            status={lecDeliveryPct >= 80 ? 'on' : lecDeliveryPct >= 60 ? 'near' : 'off'}
            statusLabel={`${lecDeliveryPct}% delivery`}
            pct={lecDeliveryPct}
            fill={lecDeliveryPct >= 80 ? '#8FD48A' : lecDeliveryPct >= 60 ? '#E6C474' : '#F4A8A0'}
            diag={`${num(totalLECScholars)} scholars · ${avgLECScholars} avg/school`}
            dark
            onClick={() => onDrill({ metric: 'lec_delivery' })}
          />
          <MetricTile
            label="GM 2"
            value={gm2Schools}
            valueSuffix={`/ ${GM2_TARGET}`}
            status={gm2Pct >= 80 ? 'on' : gm2Pct >= 60 ? 'near' : 'off'}
            statusLabel={gm2Pct >= 80 ? 'On Track' : gm2Pct >= 60 ? 'Near' : 'Behind'}
            pct={gm2Pct}
            fill={gm2Pct >= 80 ? '#2e7d5a' : gm2Pct >= 60 ? '#C38A1F' : '#C9554A'}
            diag="GM Session 2 delivered"
            onClick={() => onDrill({ metric: 'gm' })}
          />
          <MetricTile
            label="GM 3"
            value={gm3Schools}
            valueSuffix={`/ ${GM3_TARGET}`}
            status={gm3Pct >= 80 ? 'on' : gm3Pct >= 60 ? 'near' : 'off'}
            statusLabel={gm3Pct >= 80 ? 'On Track' : gm3Pct >= 60 ? 'Near' : 'Behind'}
            pct={gm3Pct}
            fill={gm3Pct >= 80 ? '#2e7d5a' : gm3Pct >= 60 ? '#C38A1F' : '#C9554A'}
            diag="GM Session 3 delivered"
            onClick={() => onDrill({ metric: 'gm' })}
          />
          <MetricTile
            label={`${getGMLabel()} Total`}
            value={gmTotalSchools}
            valueSuffix={`/ ${GM_TOTAL_TARGET}`}
            status={gmTotalPct >= 80 ? 'on' : gmTotalPct >= 60 ? 'near' : 'off'}
            statusLabel={`${gmTotalPct}% delivery`}
            pct={gmTotalPct}
            fill={gmTotalPct >= 80 ? '#8FD48A' : gmTotalPct >= 60 ? '#E6C474' : '#F4A8A0'}
            diag={`GM 2 (${gm2Schools}) + GM 3 (${gm3Schools}) combined`}
            dark
            onClick={() => onDrill({ metric: 'gm' })}
          />
        </div>
        <RegionalComparisonTable data={data} lecNums={lecNums} term={term} />
      </Section>

      <Section title={heatmapHeader.title} subtitle={heatmapHeader.subtitle}>
        {weeks.length === 0 ? (
          <Placeholder label="No LEC delivery data yet for this term." />
        ) : (
          <>
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
                          const clickable = count > 0;
                          const weekNum = parseInt(w.replace(/\D/g, ''), 10);
                          return (
                            <td key={w} style={{ padding: 3 }}>
                              <div
                                onClick={clickable ? () => onDrill({ metric: 'lec_heatmap_cell', lecNum: n, week: weekNum }) : undefined}
                                title={clickable ? `Click to see schools that delivered LEC ${n} in ${w}` : undefined}
                                style={{
                                  background: bg, borderRadius: 5, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  cursor: clickable ? 'pointer' : undefined, transition: 'opacity .15s',
                                }}
                                onMouseOver={clickable ? (e) => { e.currentTarget.style.opacity = '.75'; } : undefined}
                                onMouseOut={clickable ? (e) => { e.currentTarget.style.opacity = '1'; } : undefined}
                              >
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
            <HeatmapInsights matrix={matrix} lecNums={lecNums} totalSchools={totalSchools} term={term} clusters={clusters} onDrill={onDrill} />
          </>
        )}
      </Section>

      <LecKeyInsights onDrill={onDrill} insights={insights} />
    </>
  );
}

// ── Regional Comparison table (legacy renderNationalActivityCompletion) ──────
function RegionalComparisonTable({ data, lecNums, term }) {
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();
  if (regions.length === 0) return null;
  const gmKeys = term === 'term1' ? ['schools_with_gm1']
    : term === 'term2' ? ['schools_with_gm2', 'schools_with_gm3']
      : ['schools_with_gm1', 'schools_with_gm2', 'schools_with_gm3'];

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ fontWeight: 700, color: C.navy, marginBottom: '.5rem', fontSize: '.9rem' }}>📊 Regional Comparison</div>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="center">LEC Delivery</th>
              <th className="center">{getGMLabel()}</th>
              {term === 'term2' ? (
                <>
                  <th className="center">PB Milestone M3</th>
                  <th className="center">PB Milestone M4</th>
                </>
              ) : (
                <th className="center">PB Milestone</th>
              )}
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => {
              const rd = data.filter((d) => d.region === region);
              const rdUniq = term === 'all' ? [...new Map(rd.map((d) => [d.cu, d])).values()] : rd;
              const n = sum(rdUniq, (d) => N(d.total_target_schools));
              const lDel = sum(rd, (d) => lecNums.reduce((s, ln) => s + N(d[`schools_with_lec${ln}`]), 0));
              const lExp = n * lecNums.length;
              const lPct = lExp > 0 ? Math.round((lDel / lExp) * 100) : 0;
              const gm = sum(rdUniq, (d) => gmKeys.reduce((a, k) => a + N(d[k]), 0));
              const gmExp = n * gmKeys.length;
              const gmPct = gmExp > 0 ? Math.round((gm / gmExp) * 100) : 0;
              const pbM3 = sum(rd, (d) => N(d.schools_completed_m3));
              const pbM4 = sum(rd, (d) => N(d.schools_completed_m4));
              const pbM1 = sum(rdUniq, (d) => N(d.schools_completed_m1) || N(d.schools_with_pb_milestone));
              return (
                <tr key={region}>
                  <td style={{ fontWeight: 700, padding: '.5rem .75rem' }}>{region}</td>
                  <td className="center" style={{ color: ragColor(lPct), fontWeight: 700 }}>{lDel}/{lExp} ({lPct}%)</td>
                  <td className="center">{gm}/{gmExp} ({gmPct}%)</td>
                  {term === 'term2' ? (
                    <>
                      <td className="center">{pbM3}/{n} ({n > 0 ? Math.round((pbM3 / n) * 100) : 0}%)</td>
                      <td className="center">{pbM4}/{n} ({n > 0 ? Math.round((pbM4 / n) * 100) : 0}%)</td>
                    </>
                  ) : (
                    <td className="center">{pbM1}/{n} M1 ({n > 0 ? Math.round((pbM1 / n) * 100) : 0}%)</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Skills Lab heatmap — insight cards (legacy buildSectionInsight('sequencing', …)) ─
export function HeatmapInsights({ matrix, lecNums, totalSchools, term, clusters, onDrill }) {
  const styles = {
    warn: ['#fffbeb', C.yellow, '#92400e'],
    risk: ['#fef2f2', C.red, '#991b1b'],
    info: ['#eff6ff', C.blue, '#1e3a8a'],
  };
  const cards = [];

  if (term === 'term1' || term === 'term2') {
    const { lecs: lecsDue, week } = getLECsDueByToday(term);
    if (lecsDue > 0) {
      const dueLecs = lecNums.slice(0, lecsDue);
      const lastDueLec = dueLecs[dueLecs.length - 1];
      const aheadLecs = lecNums.slice(lecsDue);
      const aheadCount = aheadLecs.reduce((s, n) => s + Object.values(matrix[`lec${n}`] || {}).reduce((a, v) => a + v, 0), 0);
      if (aheadCount > 0) {
        const pct = totalSchools > 0 ? Math.round((aheadCount / totalSchools) * 100) : 0;
        cards.push({
          icon: '🏃', level: 'info',
          title: `${aheadCount} schools (${pct}%) are ahead of the programme calendar`,
          body: `The schedule calls for up to LEC ${lastDueLec} by Week ${week}. ${aheadCount} schools have already delivered beyond that. Positive momentum — ensure quality isn't being sacrificed for speed.`,
        });
      }
      const deliveredLastDue = Object.values(matrix[`lec${lastDueLec}`] || {}).reduce((s, v) => s + v, 0);
      const behindCount = totalSchools - deliveredLastDue;
      if (behindCount > 0) {
        const behindPct = totalSchools > 0 ? Math.round((behindCount / totalSchools) * 100) : 0;
        cards.push({
          icon: behindPct > 40 ? '🔴' : '🟡', level: behindPct > 40 ? 'risk' : 'warn',
          title: `${behindCount} schools (${behindPct}%) behind schedule — LEC ${lastDueLec} expected by Week ${week}`,
          body: behindPct > 40
            ? `By Week ${week}, all schools should have delivered LEC ${lastDueLec}. This is a significant gap — FOAs should urgently identify barriers and reschedule.`
            : `By Week ${week}, all schools should have delivered LEC ${lastDueLec}. FOAs should follow up with affected schools before the next LEC is due.`,
        });
      }
    }
  }

  const clusterCount = clusters.length;
  if (clusterCount > 0) {
    const clusterBurnout = clusters.filter((c) => c.maxLecs >= 4).length;
    const pct = totalSchools > 0 ? Math.round((clusterCount / totalSchools) * 100) : 0;
    cards.push({
      icon: '⚡', level: 'warn',
      title: `${clusterCount} schools (${pct}%) delivered 3+ LECs in a single week`,
      body: `Delivering 3 or more LECs in the same week compresses scholar learning time and signals catch-up scheduling.${clusterBurnout > 0 ? ` ${clusterBurnout} school${clusterBurnout !== 1 ? 's' : ''} delivered 4+ LECs in one week — a high mentor workload risk.` : ''} Sustained clustering risks mentor fatigue and reduced session quality. FOAs should review pacing with affected mentors.`,
      action: () => onDrill({ metric: 'lec_clustering', clusters }),
    });
  }

  const w15 = lecNums.reduce((s, n) => s + N((matrix[`lec${n}`] || {})['Wk 15']), 0);
  if (w15 > 0) {
    cards.push({
      icon: '📅', level: 'info',
      title: `${w15} Week 15 deliveries recorded — outside the standard programme window`,
      body: 'Week 15 falls outside the expected term window. These may be late starters, make-up sessions, or data entry errors. A data quality check is recommended.',
    });
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      {cards.map((c, i) => {
        const [bg, border, txt] = styles[c.level] || styles.info;
        return (
          <div key={i} style={{ background: bg, borderLeft: `4px solid ${border}`, borderRadius: '0 6px 6px 0', padding: '.75rem 1rem', marginTop: '.6rem', fontSize: '.82rem', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: txt, marginBottom: '.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{c.icon} {c.title}</span>
              {c.action ? (
                <span
                  onClick={c.action}
                  style={{ fontSize: '.7rem', color: '#0077b6', cursor: 'pointer', padding: '2px 8px', border: '1px solid #b3d4f0', borderRadius: 999, whiteSpace: 'nowrap', marginLeft: '.5rem' }}
                >
                  ⌕ View schools
                </span>
              ) : null}
            </div>
            <div style={{ color: '#374151' }}>{c.body}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── LEC tab · Key Insights & Flags (legacy renderNationalKeyInsights) ────────
function LecKeyInsights({ onDrill, insights }) {
  const colors = { warning: '#fff3cd', alert: '#f8d7da', info: '#e7f3ff' };
  const borders = { warning: C.yellow, alert: C.red, info: C.blue };
  return (
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
                  {c.cu}{c.region ? ` · ${c.region}` : ''}{c.note ? ` (${c.note})` : ''}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </Section>
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

  const lagging = data.filter((d) => {
    const n = N(d.total_target_schools) || 1;
    const dl = lecNums.reduce((s, ln) => s + N(d[`schools_with_lec${ln}`]), 0);
    return n > 0 && Math.round((dl / (n * lecNums.length)) * 100) < 60;
  }).length;
  const lecInsight = lecPct >= 80
    ? `✅ Strong delivery at ${lecPct}% — programme on track across all regions.`
    : lecPct >= 60
      ? `⚠️ ${lecPct}% sessions delivered — ${lagging} CU${lagging !== 1 ? 's' : ''} below 60% threshold. Tap a card to drill.`
      : `🔴 LEC delivery critical at ${lecPct}% — ${lagging} CU${lagging !== 1 ? 's' : ''} need immediate follow-up.`;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">📚 LEC Delivery — Key Insights</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${lecPct >= 80 ? '' : 'amber'}`} />
            <div><strong>{lecInsight}</strong></div>
          </div>
        </div>
      </div>
      <div className="kpi-hero-strip">
        <KpiHeroCard label="LEC Delivery" valueClass={ragKpiClass(lecPct)} value={lecPct} unit="%" sub={`${num(delivered)} / ${num(expected)} sessions`} drill="⌕ Regional breakdown" onClick={() => onDrill({ metric: 'lec_delivery' })} />
        <KpiHeroCard label="Total Schools" valueClass="kpi-blue" value={totalS} sub={`${data.length} CUs in view`} drill="⌕ Schools by region" onClick={() => onDrill({ metric: 'total_schools' })} />
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
      <PbQualitySection summaryData={summaryData} year={year} term={term} showAll={showAll} onToggle={() => setShowAll((s) => !s)} onDrill={onDrill} />
      <Section title="📋 PB Milestone Completion" subtitle="Schools that reported each milestone, by region">
        <PbMilestoneCompletion summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} />
      </Section>
      <Section title="👥 Group Mentoring Completion" subtitle="Group Mentoring sessions by region">
        <GmCompletion data={data} term={term} onDrill={onDrill} />
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

  const pbInsight = pbPctT1 >= 80
    ? <>✅ <strong>T1 PB quality excellent at {pbPctT1}%</strong> — {num(pb2t1)} of {num(pbTt1)} scholars rated Good or Excellent.</>
    : pbPctT1 >= 60
      ? <>⚠️ <strong>T1 PB quality at {pbPctT1}%</strong> — some regions below 70% threshold. Mentor coaching may be needed.</>
      : <>🔴 <strong>T1 PB quality critical at {pbPctT1}%</strong> — immediate attention needed on mentor feedback quality.</>;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="key-takeaways-strip">
        <div className="kt-strip-label">📋 Passbook Quality — Key Insights</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${pbPctT1 >= 80 ? '' : 'amber'}`} />
            <div>{pbInsight}</div>
          </div>
          <div className="kt-strip-item">
            <div className="kt-strip-bar" />
            <div>M1 completion: <strong>{m1done}</strong> of {totalS} schools ({m1Pct}%). {m1Pct < 60 ? '⚠️ Behind target.' : 'Good progress.'}</div>
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

function PbQualitySection({ summaryData, year, term, showAll, onToggle, onDrill }) {
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
    return (
      <Section title="📋 PB Quality by Milestone" subtitle="Good + Excellent ratings (score ≥ 2) by region">
        <Placeholder label={`No passbook milestone data yet for ${showAll ? 'any term' : term.replace('term', 'Term ')}.`} />
      </Section>
    );
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
  const natPoorP = natTotal > 0 ? Math.round((natR[1] / natTotal) * 100) : 0;

  const worstRegion = regions.map((reg) => {
    const rRows = pbSrc.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
    const rT = sum(rRows, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
    const rQ = sum(rRows, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
    return { reg, pct: rT > 0 ? Math.round((rQ / rT) * 100) : null };
  }).filter((r) => r.pct !== null).sort((a, b) => a.pct - b.pct)[0];

  const sectionTitle = !natQP ? '📋 PB Quality by Milestone' : (
    natQP >= 80
      ? `📋 Strong PB quality nationally — ${natQP}% Good or Excellent${worstRegion && worstRegion.pct < natQP - 10 ? ` · ${worstRegion.reg} lags at ${worstRegion.pct}%` : ''}`
      : natQP >= 60
        ? `📋 PB quality at ${natQP}% nationally${worstRegion ? ` · ${worstRegion.reg} lowest at ${worstRegion.pct}%` : ''} — coaching focus needed`
        : `🔴 PB quality critically low — ${natQP}% nationally${natPoorP > 20 ? ` · ${natPoorP}% rated Poor` : ''} — immediate support required`
  );
  const sectionSubtitle = !natQP ? 'Good + Excellent ratings (score ≥ 2) by region' : `Good + Excellent ratings (score ≥ 2) · T1 baseline · ${num(natTotal)} passbooks rated`;
  const completionField = msKeys.includes('m3') && !msKeys.includes('m1') ? 'schools_completed_m3' : 'schools_completed_m1';
  const completionLabel = completionField === 'schools_completed_m3' ? 'Schools M3' : 'Schools M1';

  return (
    <Section title={sectionTitle} subtitle={sectionSubtitle}>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'center', borderTop: `4px solid ${C.blue}` }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Scholars Rated</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{num(natTotal)}</div>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'center', borderTop: `4px solid ${qCol(natQP)}` }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Quality Score</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{natQP}%</div>
          <div style={{ fontSize: '.8rem', color: '#888' }}>Good + Excellent</div>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'center', borderTop: '4px solid #adb5bd' }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Not Observed (0)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{num(natR[0])}</div>
          <div style={{ fontSize: '.8rem', color: '#888' }}>{natTotal > 0 ? Math.round((natR[0] / natTotal) * 100) : 0}% of total</div>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'center', borderTop: `4px solid ${C.red}` }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Poor (Rating 1)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: C.navy }}>{num(natR[1])}</div>
          <div style={{ fontSize: '.8rem', color: '#888' }}>{natPoorP}% need coaching</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="center">{completionLabel}</th>
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
              <td className="center">{sum(pbSrc, (d) => N(d[completionField]))}/{sum(pbSrc, (d) => N(d.total_target_schools))}</td>
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
    </Section>
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
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {milestones.map((ms, idx) => {
          const c = cell(ms.src, ms.m, null);
          const border = [C.blue, C.green, C.yellow, C.red][idx % 4];
          return (
            <div
              key={ms.m}
              onClick={() => onDrill({ metric: 'pb_completion' })}
              style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', borderLeft: `4px solid ${border}`, cursor: 'pointer' }}
            >
              <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', color: '#888' }}>Milestone {ms.m} Completed <span style={{ color: '#0077b6' }}>⌕</span></div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: ragColor(c.pct) }}>{c.done} <span style={{ fontSize: '.9rem', fontWeight: 400, color: '#888' }}>/ {c.tot} schools</span></div>
              <div style={{ fontSize: '.8rem', color: '#555' }}>{c.pct}% completion rate</div>
            </div>
          );
        })}
      </div>
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
    </>
  );
}

const GM_SESSIONS = [
  { key: 'schools_with_gm1', schlKey: 'gm1_total_scholars', label: 'GM 1', terms: ['term1', 'all'] },
  { key: 'schools_with_gm2', schlKey: 'gm2_total_scholars', label: 'GM 2', terms: ['term2', 'all'] },
  { key: 'schools_with_gm3', schlKey: 'gm3_total_scholars', label: 'GM 3', terms: ['term2', 'all'] },
];

// A pill-style "click to drill" hint — more visible than a bare "⌕" glyph.
function DrillTag({ label = 'Drill', onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '.65rem', fontWeight: 700,
        color: '#0077b6', background: '#e7f3ff', border: '1px solid #b3d4f0', borderRadius: 999,
        padding: '1px 7px', marginLeft: 6, whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : undefined,
      }}
    >
      ⌕ {label}
    </span>
  );
}

// legacy renderNationalGMCompletion — overall banner + per-session × region breakdown.
function GmCompletion({ data, term, onDrill }) {
  const regions = REGIONS.filter((reg) => data.some((d) => String(d.region || '').toLowerCase() === reg.toLowerCase()));
  const cuRows = term === 'all' ? [...new Map(data.map((d) => [d.cu, d])).values()] : data;
  const totalS = sum(cuRows, (d) => N(d.total_target_schools));
  if (totalS === 0) return null;

  const gmTotal = sum(data, (d) => N(d.schools_with_gm));
  const gmPct = Math.round((gmTotal / totalS) * 100);
  const gmRag = gmPct >= 80 ? C.green : gmPct >= 60 ? C.yellow : C.red;
  const gmBg = gmPct >= 80 ? '#EEF5ED' : gmPct >= 60 ? '#FBF1DD' : '#FCF3F1';
  const gmScholars = sum(data, (d) => N(d.GM_total_scholars));

  const active = GM_SESSIONS.filter((s) => s.terms.includes(term));
  const hasData = active.some((s) => sum(data, (d) => N(d[s.key])) > 0);

  return (
    <>
      <div
        onClick={() => onDrill({ metric: 'gm' })}
        style={{ background: gmBg, borderRadius: 8, padding: '.7rem 1rem', marginBottom: '.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '.85rem', alignItems: 'center', cursor: 'pointer' }}
        title="Click for the full regional → CU → school breakdown"
      >
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: gmRag }}>{gmPct}%</span>
        <span><strong>{gmTotal}</strong> of {totalS} schools completed at least 1 GM session (1 in T1 · 2 in T2)</span>
        <span><strong>{num(gmScholars)}</strong> total GM scholars</span>
        <DrillTag label="Drill to regions" />
      </div>
      {active.length > 0 && hasData ? (
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Session</th>
                <th className="center">National</th>
                <th className="center">Scholars</th>
                {regions.map((reg) => (
                  <th
                    key={reg}
                    className="center"
                    onClick={() => onDrill({ metric: 'gm', initialRegion: reg })}
                    title={`Click to drill into ${reg} → CUs → schools`}
                    style={{ cursor: 'pointer' }}
                  >
                    {reg}<DrillTag />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((s) => {
                const cnt = sum(data, (d) => N(d[s.key]));
                const sch = sum(data, (d) => N(d[s.schlKey]));
                const pct = totalS > 0 ? Math.round((cnt / totalS) * 100) : 0;
                return (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 600 }}>{s.label}</td>
                    <td className="center" style={{ fontWeight: 700, color: ragColor(pct) }}>{cnt} / {totalS} ({pct}%)</td>
                    <td className="center">{sch > 0 ? num(sch) : '—'}</td>
                    {regions.map((reg) => {
                      const rr = data.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
                      const rCU = term === 'all' ? [...new Map(rr.map((d) => [d.cu, d])).values()] : rr;
                      const rT = sum(rCU, (d) => N(d.total_target_schools));
                      const rC = sum(rr, (d) => N(d[s.key]));
                      const rP = rT > 0 ? Math.round((rC / rT) * 100) : 0;
                      return (
                        <td
                          key={reg}
                          className="center"
                          onClick={() => onDrill({ metric: 'gm', initialRegion: reg })}
                          style={{ fontWeight: 600, color: rC > 0 ? ragColor(rP) : '#ccc', cursor: 'pointer' }}
                        >
                          {rC > 0 ? `${rC} (${rP}%)` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '.5rem .75rem', color: '#888', fontSize: '.85rem', background: '#f8f9fa', borderRadius: 6 }}>
          Per-session GM breakdown not available for this term selection. Overall GM completion shown above.
        </div>
      )}
    </>
  );
}

// ── Programme Quality tab ────────────────────────────────────────────────────
function QualityTab({ summaryData, schoolData, data, year, term, onDrill }) {
  const obs = useMemo(() => computeObsCoverageByRegion(data), [data]);
  const rt = useMemo(() => getReportTimelinessSummary(data), [data]);
  const ns = useMemo(() => computeNonScholar(schoolData, year, term), [schoolData, year, term]);
  const nsBreak = useMemo(() => computeNonScholarBreakdown(schoolData, year, term), [schoolData, year, term]);
  const regions = [...new Set(data.map((d) => d.region).filter(Boolean))].sort();

  const unobs = obs.totalMentors - obs.totalObserved;
  const obsIsHistorical = term === 'term2' || term === 'term3' || term === 'all';
  const obsInsight = obs.totalCovPct >= 80
    ? <>✅ <strong>Observation coverage strong at {obs.totalCovPct}%</strong> — FOA supervision {obsIsHistorical ? 'was completed in T1' : 'on track'}.</>
    : obs.totalCovPct >= 50
      ? (obsIsHistorical
        ? <>ℹ️ <strong>{obs.totalCovPct}% observation coverage in T1</strong> — {unobs} mentor{unobs !== 1 ? 's' : ''} were not observed during the T1 campaign. Review for next term planning.</>
        : <>⚠️ <strong>{obs.totalCovPct}% observation coverage</strong> — {unobs} mentor{unobs !== 1 ? 's' : ''} not yet observed. Prioritise FOA visits.</>)
      : (obsIsHistorical
        ? <>🔴 <strong>Observation coverage was low at {obs.totalCovPct}% in T1</strong> — {unobs} mentors not observed. Factor into next term planning.</>
        : <>🔴 <strong>Observation coverage critically low at {obs.totalCovPct}%</strong> — {unobs} mentors unobserved. Urgent action needed.</>);

  const skillsDaySchools = sum(data, (d) => N(d.schools_with_skills_day));
  const skillsDayTarget = sum(data, (d) => N(d.total_target_schools));
  const skillsDayPct = skillsDayTarget > 0 ? Math.round((skillsDaySchools / skillsDayTarget) * 100) : 0;
  const showSkillsDayHero = term === 'term2' || term === 'term3' || term === 'all';

  const obsScores = data.map((d) => N(d.avg_cu_observation_score)).filter((v) => v > 0);
  const obsAvgScore = obsScores.length > 0 ? (obsScores.reduce((s, v) => s + v, 0) / obsScores.length).toFixed(2) : null;
  const obsSectionTitle = obs.totalCovPct >= 80
    ? `👁️ ${obs.totalCovPct}% mentor observation coverage${obsAvgScore ? ` · avg score ${obsAvgScore}/3.0` : ''} — on track`
    : obs.totalCovPct >= 50
      ? `⚠️ ${obs.totalCovPct}% observation coverage — ${unobs} mentor${unobs !== 1 ? 's' : ''} not yet observed${obsAvgScore ? ` · avg ${obsAvgScore}` : ''}`
      : `🔴 Low observation coverage — only ${obs.totalCovPct}% of ${obs.totalMentors} mentors observed`;

  const nsZero = nsBreak.natCounts['0'] || 0;
  const nsZeroPct = nsBreak.natTotal > 0 ? Math.round((nsZero / nsBreak.natTotal) * 100) : 0;
  const nsHigh = (nsBreak.natCounts['11-20'] || 0) + (nsBreak.natCounts['21-30'] || 0) + (nsBreak.natCounts['31+'] || 0);
  const nsHighPct = nsBreak.natTotal > 0 ? Math.round((nsHigh / nsBreak.natTotal) * 100) : 0;
  const nsSectionTitle = nsZeroPct >= 60
    ? `👥 ${nsZeroPct}% of schools have no non-scholar attendance — community engagement opportunity`
    : nsHighPct >= 20
      ? `👥 ${nsHighPct}% of schools attracting 11+ non-scholars — strong community spillover`
      : `👥 ${100 - nsZeroPct}% of schools have some non-scholar participation · avg max ${nsBreak.natMaxAvg.toFixed(1)} per school`;

  const rtSectionTitle = rt.onTrackPct >= 70
    ? `📅 ${rt.onTrackPct}% of reports on track — ${rt.early} submitted early · ${rt.latePct}% late`
    : rt.onTrackPct >= 50
      ? `⚠️ ${rt.onTrackPct}% reports on track — ${rt.week1Pct}% delayed 1 week · ${rt.latePct}% late`
      : `🔴 Report timeliness critical — only ${rt.onTrackPct}% on track · ${100 - rt.onTrackPct}pp gap needs attention`;

  const NS_BG = ['#f8f9fa', '#fff3cd', '#dbeafe', '#d1fae5', '#dcfce7'];
  const NS_TC = ['#495057', '#856404', '#1e40af', '#065f46', '#14532d'];
  const NS_LABELS = ['0 non-scholars', '1-10 non-scholars', '11-20 non-scholars', '21-30 non-scholars', '31+ non-scholars'];

  return (
    <>
      <div className="key-takeaways-strip" style={{ marginBottom: '1rem' }}>
        <div className="kt-strip-label">🏅 Programme Quality — Key Insights</div>
        <div className="kt-strip-list">
          <div className="kt-strip-item">
            <div className={`kt-strip-bar ${obs.totalCovPct >= 80 ? '' : 'red'}`} />
            <div>{obsInsight}</div>
          </div>
          {rt.total > 0 ? (
            <div className="kt-strip-item">
              <div className={`kt-strip-bar ${rt.onTrackPct >= 70 ? '' : 'amber'}`} />
              <div>Report timeliness: <strong>{rt.onTrackPct}% on track</strong> — {rt.week1Pct}% delayed, {rt.latePct}% late.</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="kpi-hero-strip" style={{ marginBottom: '1.5rem' }}>
        <KpiHeroCard label="Observation Coverage" valueClass={ragKpiClass(obs.totalCovPct, 80, 50)} value={obs.totalCovPct} unit="%" sub={`${obs.totalObserved}/${obs.totalMentors} mentors`} drill="⌕ Drill to mentors" onClick={() => onDrill({ metric: 'observations' })} />
        <KpiHeroCard label="Report Timeliness" valueClass={ragKpiClass(rt.onTrackPct, 70, 50)} value={rt.onTrackPct} unit="%" sub={`${rt.onTrack} on track of ${rt.total}`} drill="⌕ Drill to regions" onClick={() => onDrill({ metric: 'report_timeliness' })} />
        <KpiHeroCard label="Non-Scholar Participation" valueClass="kpi-blue" value={ns.pctWith} unit="%" sub={`${ns.withNS} of ${ns.total} schools`} drill="⌕ Drill to regions" onClick={() => onDrill({ metric: 'non_scholar' })} />
        {showSkillsDayHero ? (
          <KpiHeroCard label="Skills Day Completion" valueClass={ragKpiClass(skillsDayPct)} value={skillsDayPct} unit="%" sub={`${skillsDaySchools} of ${skillsDayTarget} schools`} drill="⌕ Drill to regions" onClick={() => onDrill({ metric: 'skills_day' })} />
        ) : null}
      </div>

      <Section title={obsSectionTitle} subtitle={`${obs.totalObserved} of ${obs.totalMentors} mentors observed · click any cell for CU detail`}>
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
                  <td style={{ padding: '.6rem .75rem', fontWeight: 700 }}>{r.region}<DrillTag /></td>
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

      <Section title={nsSectionTitle} subtitle={`Distribution by non-scholar count per LEC · ${nsBreak.natTotal} schools`}>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {nsBreak.buckets.map((b, i) => {
            const count = nsBreak.natCounts[b] || 0;
            const pct = nsBreak.natTotal > 0 ? Math.round((count / nsBreak.natTotal) * 100) : 0;
            return (
              <div
                key={b}
                onClick={() => onDrill({ metric: 'non_scholar' })}
                style={{ flex: '1 1 130px', minWidth: 130, padding: '1rem 1.25rem', background: NS_BG[i], borderRadius: 10, textAlign: 'center', cursor: 'pointer' }}
              >
                <div style={{ fontSize: '2rem', fontWeight: 800, color: NS_TC[i] }}>{count}</div>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: NS_TC[i], marginTop: '.2rem' }}>schools ({pct}%)</div>
                <div style={{ fontSize: '.75rem', color: NS_TC[i], marginTop: '.15rem' }}>{NS_LABELS[i]}</div>
                <DrillTag />
              </div>
            );
          })}
        </div>
        <div style={{ fontWeight: 700, marginBottom: '.5rem', fontSize: '.9rem' }}>Breakdown by Region</div>
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Region</th>
                {nsBreak.buckets.map((b) => (
                  <th key={b} className="center">{b}</th>
                ))}
                <th className="center">Total Schools</th>
                <th className="center">Max Avg NS</th>
              </tr>
            </thead>
            <tbody>
              {nsBreak.regionData.map((r) => (
                <tr key={r.region} className="clickable" onClick={() => onDrill({ metric: 'non_scholar' })}>
                  <td className="item-name">{r.region}<DrillTag /></td>
                  {nsBreak.buckets.map((b, i) => (
                    <td key={b} className="center" style={{ color: r.counts[b] > 0 ? NS_TC[i] : '#ccc' }}>{r.counts[b]}</td>
                  ))}
                  <td className="center" style={{ fontWeight: 700 }}>{r.total}</td>
                  <td className="center" style={{ fontWeight: 700, color: C.green }}>{r.maxAvg.toFixed(1)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f0f4ff', borderTop: '2px solid #dee2e6', fontWeight: 800 }}>
                <td>National Total</td>
                {nsBreak.buckets.map((b, i) => (
                  <td key={b} className="center" style={{ color: nsBreak.natCounts[b] > 0 ? NS_TC[i] : '#ccc' }}>{nsBreak.natCounts[b]}</td>
                ))}
                <td className="center">{nsBreak.natTotal}</td>
                <td className="center" style={{ color: C.green }}>{nsBreak.natMaxAvg.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`${term === 'term2' ? '🔬 Skills Day' : term === 'all' ? '🎉 Community Day / 🔬 Skills Day' : '🎉 Community Day'}`} subtitle="Delivery and attendance by region">
        <CommunitySkillsDay summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} />
      </Section>

      <Section title="🏛️ Club Milestones & BMP" subtitle="Club meetings and Business Model Presentation by region">
        <ClubMilestones summaryData={summaryData} data={data} year={year} term={term} onDrill={onDrill} />
      </Section>

      <Section title={rtSectionTitle} subtitle={`${num(rt.total)} reports submitted · early + on-schedule = on track`}>
        <div className="score-cards" style={{ marginBottom: '1.25rem' }}>
          <ScoreCard tone="blue" label="Total Reports" value={rt.total} subtext="submitted" />
          <ScoreCard tone={rt.onTrackPct >= 70 ? 'green' : 'yellow'} label={<>On Track<DrillTag /></>} value={rt.onTrack} subtext={`${rt.onTrackPct}% (early + on schedule)`} onClick={() => onDrill({ metric: 'report_timeliness' })} />
          <ScoreCard tone="green" label={<>Early<DrillTag /></>} value={rt.early} subtext={`${rt.earlyPct}%`} onClick={() => onDrill({ metric: 'report_timeliness' })} />
          <ScoreCard tone="green" label={<>On Schedule<DrillTag /></>} value={rt.onTime} subtext={`${rt.onTimePct}%`} onClick={() => onDrill({ metric: 'report_timeliness' })} />
          <ScoreCard tone={rt.week1Pct > 20 ? 'red' : 'yellow'} label={<>1 Wk Delay<DrillTag /></>} value={rt.week1} subtext={`${rt.week1Pct}%`} onClick={() => onDrill({ metric: 'report_timeliness' })} />
          <ScoreCard tone={rt.latePct > 30 ? 'red' : 'yellow'} label={<>Late<DrillTag /></>} value={rt.late} subtext={`${rt.latePct}%`} onClick={() => onDrill({ metric: 'report_timeliness' })} />
          <ScoreCard tone="yellow" label="Unscheduled" value={rt.unsched} subtext={`${rt.unschedPct}%`} />
        </div>
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
                    <td style={{ padding: '.5rem .75rem', fontWeight: 700 }}>{region}<DrillTag /></td>
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
          <DrillTag onClick={() => onDrill({ metric: 'community_day' })} />
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
            <DrillTag onClick={() => onDrill({ metric: 'skills_day' })} />
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
function ClubMilestones({ summaryData, data, year, term, onDrill }) {
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
            const drillMilestone = (initialRegion) => onDrill({ metric: 'club_milestone', milestoneKey: m.key, milestoneLabel: m.label, ...(initialRegion ? { initialRegion } : {}) });
            return (
              <tr key={m.key}>
                <td className="item-name" onClick={() => drillMilestone()} style={{ cursor: 'pointer' }}>{m.label}<DrillTag /></td>
                <td className="center" onClick={() => drillMilestone()} style={{ fontWeight: 700, color: ragColor(natPct), cursor: 'pointer' }}>{natCount}/{total} ({natPct}%)</td>
                {regions.map((reg) => {
                  const rr = rows.filter((d) => String(d.region || '').toLowerCase() === reg.toLowerCase());
                  const rCU = [...new Map(rr.map((d) => [d.cu, d])).values()];
                  const rTot = sum(rCU, (d) => N(d.total_target_schools));
                  const rCount = sum(rr, (d) => N(d[m.key]));
                  const rP = rTot > 0 ? Math.round((rCount / rTot) * 100) : 0;
                  return (
                    <td
                      key={reg}
                      className="center"
                      onClick={() => drillMilestone(reg)}
                      style={{ fontWeight: 600, color: rCount > 0 ? ragColor(rP) : '#ccc', cursor: 'pointer' }}
                    >
                      {rCount > 0 ? `${rCount} (${rP}%)` : '—'}
                    </td>
                  );
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
