import { useMemo } from 'react';
import { getLECsForTerm, C } from '../lib/config.js';
import { avgScholarsPerLec, getReportTimelinessSummary, buildLecWeekMatrix, computeHeatmapHeader, computeLecClusters, computeRegionalIssues, sum } from '../lib/metrics.js';
import { formatPercentage, ragScoreClass, ragColor, calculatePBQualityScore, num, getGMLabel, getNonLECActivityLabel } from '../lib/format.js';
import { Section, ScoreCard, ProgressCell, Placeholder, LecWeekHeatmap } from '../components/ui.jsx';
import { TimelinessBar, TimelinessLegend, HeatmapInsights } from './NationalView.jsx';

const N = (v) => Number(v) || 0;
const rag = (pct) => (pct >= 80 ? C.green : pct >= 60 ? C.yellow : C.red);

function ScoreCards({ summaryData, data, year, term }) {
  const lecNums = getLECsForTerm(year, term);
  const totalSchools = sum(data, (d) => N(d.total_target_schools));
  const obsSrc = term === 'all' ? data.filter((d) => d.term === 'term1') : data;
  const totalMentors = sum(obsSrc, (d) => Math.max(N(d.total_active_mentors), 0));
  const observedMentors = sum(obsSrc, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
  const totalObsCount = sum(obsSrc, (d) => N(d.total_mentor_observations));
  const observationRate = totalMentors > 0 ? formatPercentage(observedMentors, totalMentors) : 0;

  const lecsDelivered = lecNums.reduce((s, n) => s + sum(data, (d) => N(d[`schools_with_lec${n}`])), 0);
  const lecsExpected = totalSchools * lecNums.length;
  const lecDeliveryPct = lecsExpected > 0 ? Math.round((lecsDelivered / lecsExpected) * 100) : 0;
  const avgScholars = avgScholarsPerLec(data, lecNums);

  const cuSet = new Set(data.map((r) => String(r.cu || '').toLowerCase()));
  const t1Rows = summaryData.filter((d) => d.year == year && d.term === 'term1' && cuSet.has(String(d.cu || '').toLowerCase()));
  const recSrc = t1Rows.length > 0 ? t1Rows : data;
  const totalRecruited = sum(recSrc, (d) => N(d.total_scholars_recruited));
  const recSchoolCount = sum(recSrc, (d) => N(d.total_target_schools));
  const totalTarget = (recSchoolCount > 0 ? recSchoolCount : totalSchools) * 45;
  const recruitmentRate = totalTarget > 0 ? formatPercentage(totalRecruited, totalTarget) : 0;

  const pbSrc = t1Rows.length > 0 ? t1Rows : data;
  const pbQuality = sum(pbSrc, (d) => N(d.m1_quality_rated) + N(d.m2_quality_rated));
  const pbTotal = sum(pbSrc, (d) => N(d.m1_total_rated) + N(d.m2_total_rated));
  const feedbackRate = pbTotal > 0 ? formatPercentage(pbQuality, pbTotal) : 0;

  const t2Rows = summaryData.filter((d) => d.year == year && d.term === 'term2' && cuSet.has(String(d.cu || '').toLowerCase()));
  const pb2Quality = sum(t2Rows, (d) => N(d.m3_quality_rated) + N(d.m4_quality_rated));
  const pb2Total = sum(t2Rows, (d) => N(d.m3_total_rated) + N(d.m4_total_rated));
  const feedbackRate2 = pb2Total > 0 ? formatPercentage(pb2Quality, pb2Total) : 0;
  const staticNote = term !== 'term1' ? ' (T1)' : '';

  return (
    <div className="score-cards">
      <ScoreCard tone="blue" label="Total Schools" value={totalSchools} subtext={`${data.length} CU${data.length !== 1 ? 's' : ''} in view`} />
      <ScoreCard tone={ragScoreClass(lecDeliveryPct, 80, 50)} label="LEC Delivery" value={lecDeliveryPct} unit="%" subtext={`${num(lecsDelivered)} / ${num(lecsExpected)} sessions`} />
      <ScoreCard tone="blue" label="Avg Scholars / LEC" value={avgScholars} subtext="Per school per session" />
      <ScoreCard tone={parseInt(recruitmentRate, 10) >= 80 ? 'green' : 'yellow'} label={`Recruitment${staticNote}`} value={recruitmentRate} unit="%" subtext={`${num(totalRecruited)} / ${num(totalTarget)} scholars`} />
      <ScoreCard tone={ragScoreClass(feedbackRate, 70, 50)} label="PB Quality (T1)" value={feedbackRate} unit="%" subtext="M1+M2 ratings" />
      <ScoreCard tone={pb2Total > 0 ? ragScoreClass(feedbackRate2, 70, 50) : 'blue'} label="PB Quality (T2)" value={pb2Total > 0 ? feedbackRate2 : '—'} unit={pb2Total > 0 ? '%' : ''} subtext={pb2Total > 0 ? 'M3+M4 ratings' : 'No M3/M4 data yet'} />
      <ScoreCard tone={parseInt(observationRate, 10) >= 75 ? 'green' : 'yellow'} label="Mentor Observations" value={observedMentors} unit={`/${totalMentors}`} subtext={`${observationRate}% observed · ${totalObsCount} visits`} />
    </div>
  );
}

function CUBreakdown({ summaryData, data, year, term, onSelectCU }) {
  const lecNums = getLECsForTerm(year, term);
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Cluster Unit</th>
            <th>FOA</th>
            <th className="center">Schools</th>
            <th className="center">Recruitment</th>
            <th className="center">LEC Coverage</th>
            <th className="center">{getGMLabel()}</th>
            <th className="center">PB Milestone</th>
            <th className="center">Quality%</th>
            <th className="center">Obs.</th>
          </tr>
        </thead>
        <tbody>
          {data.map((cu) => {
            const n = N(cu.total_target_schools);
            const rec = N(cu.total_scholars_recruited);
            const t1cu = summaryData.find((d) => d.term === 'term1' && String(d.cu).toLowerCase() === String(cu.cu).toLowerCase() && d.year == year);
            const recFinal = rec > 0 ? rec : t1cu ? N(t1cu.total_scholars_recruited) : 0;
            const recTarget = n * 45;
            const recPct = formatPercentage(recFinal, recTarget);
            const lecsDel = lecNums.reduce((s, ln) => s + N(cu[`schools_with_lec${ln}`]), 0);
            const lecsExp = n * lecNums.length;
            const lecsPct = formatPercentage(lecsDel, lecsExp);
            const hasGM = N(cu.schools_with_gm);
            const hasPB = term === 'term2'
              ? Math.max(N(cu.schools_completed_m3), N(cu.schools_completed_m4))
              : Math.max(N(cu.schools_completed_m1), N(cu.schools_completed_m2));
            const ms = term === 'term2' ? ['m3', 'm4'] : ['m1', 'm2'];
            const r = [0, 1, 2, 3].map((idx) => ms.reduce((s, m) => s + N(cu[`${m}_total_rating_${idx}`]), 0));
            const qual = calculatePBQualityScore(r[0], r[1], r[2], r[3]);
            const qualCol = qual >= 70 ? C.green : qual >= 50 ? C.yellow : C.red;
            const obs = N(cu.total_observed_mentors);
            const mTotal = N(cu.total_active_mentors);
            return (
              <tr key={cu.cu} className="clickable" onClick={() => onSelectCU(cu.cu)}>
                <td className="item-name">{cu.cu}</td>
                <td style={{ color: '#555' }}>{cu.foa_name || '–'}</td>
                <td className="center"><strong>{n}</strong></td>
                <td className="center" style={{ color: ragColor(recPct) }}><strong>{recFinal}/{recTarget}</strong><br /><small>{recPct}%</small></td>
                <td className="center" style={{ color: ragColor(lecsPct) }}><strong>{lecsDel}/{lecsExp}</strong><br /><small>{lecsPct}%</small></td>
                <td className="center"><strong>{hasGM}/{n}</strong></td>
                <td className="center"><strong>{hasPB}/{n}</strong></td>
                <td className="center" style={{ color: qualCol, fontWeight: 700 }}>{r[0] + r[1] + r[2] + r[3] > 0 ? `${qual}%` : '–'}</td>
                <td className="center"><strong>{obs}/{mTotal}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ObservationByCU({ data }) {
  const totalObs = sum(data, (d) => N(d.total_observed_mentors));
  const totalMent = sum(data, (d) => N(d.total_active_mentors));
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>CU</th>
            <th>FOA</th>
            <th className="center">Mentors</th>
            <th className="center">Observed</th>
            <th className="center">Coverage</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {data.map((cu) => {
            const mT = N(cu.total_active_mentors);
            const mO = N(cu.total_observed_mentors);
            const pct = mT > 0 ? Math.round((mO / mT) * 100) : 0;
            const col = ragColor(pct, 75, 50);
            const rag = pct >= 75 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
            return (
              <tr key={cu.cu}>
                <td className="item-name">{cu.cu}</td>
                <td>{cu.foa_name || '–'}</td>
                <td className="center">{mT}</td>
                <td className="center">{mO}</td>
                <td className="center" style={{ color: col, fontWeight: 700 }}>{rag} {pct}%</td>
                <td style={{ minWidth: 120 }}><ProgressCell pct={pct} color={col} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, background: '#f8f9fa' }}>
            <td colSpan={2}><strong>TOTAL</strong></td>
            <td className="center">{totalMent}</td>
            <td className="center">{totalObs}</td>
            <td className="center">{totalMent > 0 ? Math.round((totalObs / totalMent) * 100) : 0}%</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ReportTimeliness({ data }) {
  const s = getReportTimelinessSummary(data);
  if (s.total === 0) return <Placeholder label="No report data yet." />;
  return (
    <>
      <TimelinessLegend />
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
          <thead>
            <tr style={{ background: C.navy, color: '#fff' }}>
              {['CU', 'Total', 'Early', 'On Schedule', '1 Wk Delay', 'Late', 'Unscheduled', 'Breakdown'].map((h, i) => (
                <th key={h} style={{ padding: '.6rem .75rem', textAlign: i === 0 || i === 7 ? 'left' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const cs = getReportTimelinessSummary([d]);
              if (cs.total === 0) return null;
              return (
                <tr key={d.cu} style={{ borderBottom: '1px solid #e9ecef' }}>
                  <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{d.cu || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{cs.total}</td>
                  <td style={{ textAlign: 'center', color: '#198754', fontWeight: 700 }}>{cs.early} ({cs.earlyPct}%)</td>
                  <td style={{ textAlign: 'center', color: '#20c997', fontWeight: 700 }}>{cs.onTime} ({cs.onTimePct}%)</td>
                  <td style={{ textAlign: 'center', color: '#ffc107', fontWeight: 700 }}>{cs.week1} ({cs.week1Pct}%)</td>
                  <td style={{ textAlign: 'center', color: '#dc3545', fontWeight: 700 }}>{cs.late} ({cs.latePct}%)</td>
                  <td style={{ textAlign: 'center', color: '#adb5bd' }}>{cs.unsched}</td>
                  <td style={{ padding: '.5rem .75rem', minWidth: 120 }}><TimelinessBar s={cs} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Issue Summary (legacy renderRegionalIssueSummary) ────────────────────────
function IssueSummary({ data, summaryData, year, term, onSelectCU }) {
  const { issues, bottom5 } = useMemo(() => computeRegionalIssues(data, summaryData, year, term), [data, summaryData, year, term]);
  const sevBg = { high: '#f8d7da', medium: '#fff3cd' };
  const sevBorder = { high: C.red, medium: C.yellow };
  return (
    <>
      <Section title={`🚨 Regional Issues${issues.length ? ` (${issues.length})` : ''}`} subtitle="CUs requiring immediate attention">
        {issues.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', color: C.green }}>✅ No flagged issues in this region.</div>
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead><tr><th>CU</th><th>FOA</th><th>Issue</th><th>Detail</th></tr></thead>
              <tbody>
                {issues.map((i, idx) => (
                  <tr key={`${i.cu}-${i.type}-${idx}`} className="clickable" onClick={() => onSelectCU(i.cu)}>
                    <td className="item-name">{i.cu}</td>
                    <td>{i.foa}</td>
                    <td><span style={{ background: sevBg[i.severity], padding: '.2rem .5rem', borderRadius: 4, borderLeft: `3px solid ${sevBorder[i.severity]}`, fontWeight: 600 }}>{i.type}</span></td>
                    <td>{i.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="📊 Bottom 5 CUs — LEC Delivery" subtitle="Lowest LEC delivery rate in this region">
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead><tr><th>CU</th><th>FOA</th><th className="center">Schools</th><th className="center">LECs Delivered</th><th className="center">Delivery %</th><th style={{ minWidth: 140 }}>Progress</th></tr></thead>
            <tbody>
              {bottom5.map((c) => (
                <tr key={c.cu} className="clickable" onClick={() => onSelectCU(c.cu)}>
                  <td className="item-name">{c.cu}</td>
                  <td>{c.foa}</td>
                  <td className="center">{c.n}</td>
                  <td className="center">{c.del}/{c.lecsExp}</td>
                  <td className="center" style={{ fontWeight: 700, color: ragColor(c.pct) }}>{c.pct}%</td>
                  <td style={{ minWidth: 140 }}><ProgressCell pct={c.pct} minWidth={140} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ── Activity Completion & Participation (legacy renderRegionalActivityCompletion) ─
function ActivityCompletion({ data, year, term }) {
  const lecNums = getLECsForTerm(year, term);
  const totalSchools = sum(data, (d) => N(d.total_target_schools));

  const lecRows = lecNums.map((n) => {
    const schoolsWith = sum(data, (d) => N(d[`schools_with_lec${n}`]));
    const scholars = sum(data, (d) => N(d[`lec${n}_scholars`]));
    const nonScholars = sum(data, (d) => N(d[`lec${n}_non_scholars`]));
    const pct = totalSchools > 0 ? Math.round((schoolsWith / totalSchools) * 100) : 0;
    return { label: `LEC ${n}`, schoolsWith, scholars, nonScholars, pct, avg: schoolsWith > 0 ? (scholars / schoolsWith).toFixed(1) : '—' };
  });
  const lecDeliveries = lecRows.reduce((s, r) => s + r.schoolsWith, 0);
  const lecScholars = lecRows.reduce((s, r) => s + r.scholars, 0);
  const lecNon = lecRows.reduce((s, r) => s + r.nonScholars, 0);
  const lecsExp = totalSchools * lecNums.length;
  const lecPct = lecsExp > 0 ? Math.round((lecDeliveries / lecsExp) * 100) : 0;

  const gmSessions = term === 'term2'
    ? [{ label: 'GM 2', field: 'schools_with_gm2', schl: 'gm2_total_scholars' }, { label: 'GM 3', field: 'schools_with_gm3', schl: 'gm3_total_scholars' }]
    : [{ label: 'GM 1', field: 'schools_with_gm1', schl: 'gm1_total_scholars' }];
  const cdField = term === 'term2' ? 'schools_with_skills_day' : 'schools_with_community_day';
  const withCD = sum(data, (d) => N(d[cdField]));
  const cdScholars = term === 'term2' ? sum(data, (d) => N(d.sd_total_scholars)) : sum(data, (d) => N(d.cd_scholar_attendance));
  const cdNon = term === 'term2' ? 0 : sum(data, (d) => N(d.cd_non_scholar_attendance));
  const pbSchools = sum(data, (d) => N(d.schools_completed_m1));
  const pbPct = totalSchools > 0 ? Math.round((pbSchools / totalSchools) * 100) : 0;

  const Row = ({ label, schoolsWith, pct, scholars, nonScholars, avg, denom, denomLabel, bold }) => (
    <tr style={bold ? { fontWeight: 700, background: '#f8f9fa', borderTop: '2px solid #dee2e6' } : undefined}>
      <td style={{ padding: '.55rem .75rem', fontWeight: bold ? 700 : 500, color: C.navy }}>{label}</td>
      <td className="center"><strong style={{ color: rag(pct) }}>{num(schoolsWith)}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{num(denom != null ? denom : totalSchools)}{denomLabel || ''}</span></td>
      <td style={{ minWidth: 140 }}><ProgressCell pct={pct} minWidth={140} /></td>
      <td className="center" style={{ fontWeight: 600 }}>{scholars > 0 ? num(scholars) : '—'}</td>
      <td className="center" style={{ color: '#666' }}>{nonScholars > 0 ? num(nonScholars) : '—'}</td>
      <td className="center" style={{ fontWeight: 600 }}>{avg}</td>
    </tr>
  );

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Activity</th>
            <th className="center">Schools Delivered</th>
            <th>Completion Rate</th>
            <th className="center">Scholars</th>
            <th className="center">Non-Scholars</th>
            <th className="center">Avg Scholars/School</th>
          </tr>
        </thead>
        <tbody>
          {lecRows.map((r) => <Row key={r.label} label={r.label} schoolsWith={r.schoolsWith} pct={r.pct} scholars={r.scholars} nonScholars={r.nonScholars} avg={r.avg} />)}
          <Row label={`Skills Labs (${term === 'all' ? 'All' : term.replace('term', 'T')} Total)`} schoolsWith={lecDeliveries} pct={lecPct} scholars={lecScholars} nonScholars={lecNon} avg={lecDeliveries > 0 ? (lecScholars / lecDeliveries).toFixed(1) : '—'} denom={lecsExp} denomLabel=" sessions" bold />
          {gmSessions.map((gs) => {
            const cnt = sum(data, (d) => N(d[gs.field]));
            const sch = sum(data, (d) => N(d[gs.schl]));
            const pct = totalSchools > 0 ? Math.round((cnt / totalSchools) * 100) : 0;
            return <Row key={gs.label} label={gs.label} schoolsWith={cnt} pct={pct} scholars={sch} nonScholars={0} avg={cnt > 0 ? (sch / cnt).toFixed(1) : '—'} />;
          })}
          {withCD > 0 ? <Row label={getNonLECActivityLabel(term)} schoolsWith={withCD} pct={totalSchools > 0 ? Math.round((withCD / totalSchools) * 100) : 0} scholars={cdScholars} nonScholars={cdNon} avg={withCD > 0 ? (cdScholars / withCD).toFixed(1) : '—'} /> : null}
          <Row label="PB Milestone (Passbook)" schoolsWith={pbSchools} pct={pbPct} scholars={0} nonScholars={0} avg="—" />
        </tbody>
      </table>
    </div>
  );
}

// ── Club Milestones & BMP by CU (per-CU, legacy §2.13) ───────────────────────
function ClubMilestonesByCU({ data, term }) {
  const all = [
    { key: 'schools_with_club_meeting_1', label: 'CM 1', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_2', label: 'CM 2', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_3', label: 'CM 3', terms: ['term2', 'all'] },
    { key: 'schools_with_club_meeting_4', label: 'CM 4', terms: ['term2', 'all'] },
    { key: 'schools_with_bmp', label: 'BMP', terms: ['term2', 'all'] },
  ];
  const active = all.filter((m) => m.terms.includes(term));
  if (active.length === 0) return <Placeholder label="No club milestones for the selected term." />;
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr><th>CU</th><th className="center">Schools</th>{active.map((m) => (<th key={m.key} className="center">{m.label}</th>))}</tr>
        </thead>
        <tbody>
          {data.map((cu) => {
            const n = N(cu.total_target_schools);
            return (
              <tr key={cu.cu}>
                <td className="item-name">{cu.cu}</td>
                <td className="center">{n}</td>
                {active.map((m) => {
                  const cnt = N(cu[m.key]);
                  const pct = n > 0 ? Math.round((cnt / n) * 100) : 0;
                  return <td key={m.key} className="center" style={{ fontWeight: 600, color: cnt > 0 ? ragColor(pct) : '#ccc' }}>{cnt > 0 ? `${cnt}/${n} (${pct}%)` : '—'}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Skills Day gender table by CU (legacy §2.11; T2/All only) ─────────────────
function SkillsDayByCU({ data }) {
  const rows = data.filter((d) => N(d.schools_with_skills_day) > 0 || N(d.sd_total_scholars) > 0);
  if (rows.length === 0) return <Placeholder label="No Skills Day data for this region yet." />;
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr><th>CU</th><th className="center">Completion</th><th className="center">Scholars</th><th className="center" style={{ color: C.blue }}>Male</th><th className="center" style={{ color: C.red }}>Female</th><th className="center">Non-Scholars</th></tr>
        </thead>
        <tbody>
          {rows.map((cu) => {
            const n = N(cu.total_target_schools);
            const withSD = N(cu.schools_with_skills_day);
            const pct = n > 0 ? Math.round((withSD / n) * 100) : 0;
            const sch = N(cu.sd_total_scholars);
            const male = N(cu.sd_male_scholars);
            const female = N(cu.sd_female_scholars);
            return (
              <tr key={cu.cu}>
                <td className="item-name">{cu.cu}</td>
                <td className="center" style={{ fontWeight: 700, color: ragColor(pct) }}>{withSD}/{n} ({pct}%)</td>
                <td className="center">{num(sch)}</td>
                <td className="center" style={{ color: C.blue }}>{male > 0 ? `${num(male)} (${sch > 0 ? Math.round((male / sch) * 100) : 0}%)` : '—'}</td>
                <td className="center" style={{ color: C.red }}>{female > 0 ? `${num(female)} (${sch > 0 ? Math.round((female / sch) * 100) : 0}%)` : '—'}</td>
                <td className="center" style={{ color: '#888' }}>{num(N(cu.sd_total_non_scholars))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RegionalView({ summaryData, schoolData, year, term, region, onSelectCU, onDrill }) {
  const data = useMemo(() => {
    let rows = summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
    if (region) rows = rows.filter((d) => String(d.region || '').toLowerCase() === String(region).toLowerCase());
    return rows;
  }, [summaryData, year, term, region]);

  // Region-scoped school rows for the Skills Lab heatmap.
  const regionSchoolData = useMemo(
    () => (schoolData || []).filter((d) => !region || String(d.region || '').toLowerCase() === String(region).toLowerCase()),
    [schoolData, region],
  );
  const heatTerm = term === 'all' ? 'term1' : term;
  const matrix = useMemo(() => buildLecWeekMatrix(regionSchoolData, year, heatTerm), [regionSchoolData, year, heatTerm]);
  const heatLecs = getLECsForTerm(year, heatTerm);
  const totalSchools = useMemo(() => sum(data, (d) => N(d.total_target_schools)), [data]);
  const clusters = useMemo(() => computeLecClusters(regionSchoolData, year, term), [regionSchoolData, year, term]);
  const heatmapHeader = computeHeatmapHeader(matrix, heatLecs, totalSchools);
  const showSkillsDay = term === 'term2' || term === 'all';

  if (!region) return <Placeholder label="Select a region from the dropdown above to view its performance." />;
  if (data.length === 0) return <Placeholder label="No data for the selected region / term." />;

  return (
    <div>
      <ScoreCards summaryData={summaryData} data={data} year={year} term={term} />
      <IssueSummary data={data} summaryData={summaryData} year={year} term={term} onSelectCU={onSelectCU} />
      <Section title="✅ Activity Completion & Participation" subtitle="Delivery and participation across the region">
        <ActivityCompletion data={data} year={year} term={term} />
      </Section>
      <Section title={heatmapHeader.title} subtitle={heatmapHeader.subtitle}>
        <LecWeekHeatmap
          matrix={matrix}
          lecNums={heatLecs}
          totalSchools={totalSchools}
          onCellClick={(n, w) => onDrill({ metric: 'lec_heatmap_cell', lecNum: n, week: parseInt(w.replace(/\D/g, ''), 10), region })}
        />
        <HeatmapInsights matrix={matrix} lecNums={heatLecs} totalSchools={totalSchools} term={term} clusters={clusters} onDrill={onDrill} />
      </Section>
      <Section title="📊 CU Performance Breakdown" subtitle="Recruitment, LECs, Activities, PB Quality, Observations by CU">
        <CUBreakdown summaryData={summaryData} data={data} year={year} term={term} onSelectCU={onSelectCU} />
      </Section>
      <Section title="👁️ Mentor Observation Coverage by CU" subtitle="Observation status per CU">
        <ObservationByCU data={data} />
      </Section>
      <Section title="🏛️ Club Milestones & BMP" subtitle="Club meetings and Business Model Presentation by CU">
        <ClubMilestonesByCU data={data} term={term} />
      </Section>
      {showSkillsDay ? (
        <Section title="🔬 Skills Day — Gender Breakdown" subtitle="Skills Day attendance disaggregated by gender, by CU">
          <SkillsDayByCU data={data} />
        </Section>
      ) : null}
      <Section title="📅 Activity Report Timeliness" subtitle="Report submission schedule by CU">
        <ReportTimeliness data={data} />
      </Section>
    </div>
  );
}
