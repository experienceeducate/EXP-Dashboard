import { useMemo } from 'react';
import { getLECsForTerm, C } from '../lib/config.js';
import { avgScholarsPerLec, getReportTimelinessSummary, sum } from '../lib/metrics.js';
import { formatPercentage, ragScoreClass, ragColor, calculatePBQualityScore, num, getGMLabel } from '../lib/format.js';
import { Section, ScoreCard, ProgressCell, Placeholder } from '../components/ui.jsx';
import { TimelinessBar, TimelinessLegend } from './NationalView.jsx';

const N = (v) => Number(v) || 0;

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

export default function RegionalView({ summaryData, year, term, region, onSelectCU }) {
  const data = useMemo(() => {
    let rows = summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
    if (region) rows = rows.filter((d) => String(d.region || '').toLowerCase() === String(region).toLowerCase());
    return rows;
  }, [summaryData, year, term, region]);

  if (!region) return <Placeholder label="Select a region from the dropdown above to view its performance." />;
  if (data.length === 0) return <Placeholder label="No data for the selected region / term." />;

  return (
    <div>
      <ScoreCards summaryData={summaryData} data={data} year={year} term={term} />
      <Section title="📊 CU Performance Breakdown" subtitle="Recruitment, LECs, Activities, PB Quality, Observations by CU">
        <CUBreakdown summaryData={summaryData} data={data} year={year} term={term} onSelectCU={onSelectCU} />
      </Section>
      <Section title="👁️ Mentor Observation Coverage by CU" subtitle="Observation status per CU">
        <ObservationByCU data={data} />
      </Section>
      <Section title="📅 Activity Report Timeliness" subtitle="Report submission schedule by CU">
        <ReportTimeliness data={data} />
      </Section>
    </div>
  );
}
