import { Fragment, useMemo, useState } from 'react';
import { getLECsForTerm, C } from '../lib/config.js';
import { avgScholarsPerLec, getReportTimelinessSummary, buildLecWeekMatrix, computeHeatmapHeader, computeLecClusters, computeRegionalIssues, mergeRowsAcrossTerms, sum } from '../lib/metrics.js';
import { formatPercentage, ragScoreClass, ragColor, calculatePBQualityScore, num, getGMLabel, getNonLECActivityLabel } from '../lib/format.js';
import { Section, ScoreCard, ProgressCell, Placeholder, LecWeekHeatmap } from '../components/ui.jsx';
import { getIssueKey, getIssueStatus, updateIssueStatus } from '../lib/issueTracker.js';
import { TimelinessBar, TimelinessLegend, HeatmapInsights } from './NationalView.jsx';

const N = (v) => Number(v) || 0;
const rag = (pct) => (pct >= 80 ? C.green : pct >= 60 ? C.yellow : C.red);

function ScoreCards({ summaryData, data, year, term }) {
  // `data` is already merged to one row per CU under "All Terms" (see the
  // mergeRowsAcrossTerms call in the default export) — summing straight over
  // it is safe here; it would double-count every CU if it still had one row
  // per term.
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
  const totalSchools = sum(data, (d) => N(d.total_target_schools));
  const totalMentors = sum(data, (d) => Math.max(N(d.total_active_mentors), 0));
  const observedMentors = sum(data, (d) => Math.min(N(d.total_observed_mentors), N(d.total_active_mentors)));
  const totalObsCount = sum(data, (d) => N(d.total_mentor_observations));
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
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
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
            // Unconditional max/sum across all 4 milestones: a term1 row already
            // reads 0 for m3/m4 (and vice versa for term2), so this is correct
            // for every term selection without branching — see
            // mergeRowsAcrossTerms for why that's true only once "All Terms"
            // rows are merged per CU (done by the caller).
            const hasPB = Math.max(N(cu.schools_completed_m1), N(cu.schools_completed_m2), N(cu.schools_completed_m3), N(cu.schools_completed_m4));
            const ms = ['m1', 'm2', 'm3', 'm4'];
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

  // Report timeliness counts are genuinely additive across terms (not
  // term-exclusive-nulled), so — unlike every other CU-level field in this
  // view — this groups the raw per-term rows by CU and sums, instead of
  // relying on the caller's term-merged `data`. Under "All Terms" `data`
  // still has one row per (CU, term); grouping first is what makes this a
  // true CU total instead of two same-CU rows with duplicate React keys.
  const byCu = new Map();
  data.forEach((d) => {
    const key = String(d.cu || '').trim().toLowerCase();
    if (!byCu.has(key)) byCu.set(key, []);
    byCu.get(key).push(d);
  });
  const cuRows = [...byCu.values()].map((rows) => ({ cu: rows[0].cu, rows }));

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
            {cuRows.map(({ cu, rows }) => {
              const cs = getReportTimelinessSummary(rows);
              if (cs.total === 0) return null;
              return (
                <tr key={cu} style={{ borderBottom: '1px solid #e9ecef' }}>
                  <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{cu || '—'}</td>
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
// Follow-up state per issue lives in the same localStorage tracker CU View's
// Priority Alerts already use (lib/issueTracker.js) — keyed by (cu, type,
// value), not just (cu, type), so a followed-up issue stays hidden only for
// that exact instance. If the underlying count/detail changes later (e.g. a
// CU's clustering count goes from 4 schools to 6), that's a new key and it
// reappears — "unless it is a new one," per the request.
const FOLLOWUP_REASONS = [
  'Mentor on leave / unavailable',
  'School closed or inaccessible',
  'Data entry pending (activity happened, not yet reported)',
  'Resource / logistics constraint',
  'Already addressed with FOA/mentor',
  'Other',
];

function FollowUpForm({ issue, onCancel, onConfirm }) {
  const [reason, setReason] = useState(FOLLOWUP_REASONS[0]);
  const [notes, setNotes] = useState('');
  return (
    <tr>
      <td colSpan={5} style={{ background: '#f8f9fa', padding: '.75rem 1rem' }}>
        <div style={{ fontSize: '.8rem', color: '#555', marginBottom: '.5rem' }}>
          Why does <strong>{issue.cu}</strong>'s <strong>{issue.type}</strong> issue exist? This helps the programme
          team understand recurring patterns — not just that it happened.
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: '.35rem .5rem', borderRadius: 6, border: '1px solid #ccc' }}>
            {FOLLOWUP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional detail (optional)…"
            style={{ flex: 1, minWidth: 180, padding: '.35rem .6rem', borderRadius: 6, border: '1px solid #ccc' }}
          />
          <button type="button" onClick={() => onConfirm(reason, notes)} style={{ padding: '.4rem .9rem', borderRadius: 6, border: 'none', background: C.navy, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Confirm
          </button>
          <button type="button" onClick={onCancel} style={{ padding: '.4rem .9rem', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function IssueSummary({ data, summaryData, year, term, schoolData, onSelectCU }) {
  const { issues: allIssues, bottom5, achievements } = useMemo(() => computeRegionalIssues(data, summaryData, year, term, schoolData), [data, summaryData, year, term, schoolData]);
  const [tick, setTick] = useState(0);
  const [openIssueKey, setOpenIssueKey] = useState(null);
  const issuesWithKeys = allIssues.map((i) => ({ ...i, issueKey: getIssueKey(i.cu, i.type, i.value) }));
  const followedUp = issuesWithKeys.filter((i) => getIssueStatus(i.issueKey).status === 'resolved');
  const issues = issuesWithKeys.filter((i) => getIssueStatus(i.issueKey).status !== 'resolved');
  const confirmFollowUp = (issueKey, reason, notes) => {
    updateIssueStatus(issueKey, 'resolved', notes.trim() ? `${reason} — ${notes.trim()}` : reason, 'Dashboard User');
    setOpenIssueKey(null);
    setTick((t) => t + 1);
  };
  const sevBg = { high: '#f8d7da', medium: '#fff3cd' };
  const sevBorder = { high: C.red, medium: C.yellow };
  return (
    <>
      <Section
        title={`🚨 Regional Issues${issues.length ? ` (${issues.length})` : ''}`}
        subtitle={`CUs requiring immediate attention — LEC pace, LEC clustering, mentor observations, recruitment, PB milestones/quality, Skills Day, club meetings${followedUp.length ? ` · ${followedUp.length} followed up (hidden)` : ''}`}
      >
        {issues.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', color: C.green }}>✅ No flagged issues in this region.</div>
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead><tr><th>CU</th><th>FOA</th><th>Issue</th><th>Detail</th><th /></tr></thead>
              <tbody>
                {issues.map((i, idx) => (
                  <Fragment key={`${i.cu}-${i.type}-${idx}`}>
                    <tr>
                      <td className="item-name clickable" onClick={() => onSelectCU(i.cu)}>{i.cu}</td>
                      <td>{i.foa}</td>
                      <td><span style={{ background: sevBg[i.severity], padding: '.2rem .5rem', borderRadius: 4, borderLeft: `3px solid ${sevBorder[i.severity]}`, fontWeight: 600 }}>{i.type}</span></td>
                      <td>{i.value}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setOpenIssueKey(openIssueKey === i.issueKey ? null : i.issueKey)}
                          title="Mark this issue as followed up — it won't reappear unless it recurs with a different detail"
                          style={{ border: '1px solid #ccc', background: '#fff', borderRadius: 6, padding: '.25rem .6rem', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' }}
                        >
                          ✓ Followed up
                        </button>
                      </td>
                    </tr>
                    {openIssueKey === i.issueKey ? (
                      <FollowUpForm
                        issue={i}
                        onCancel={() => setOpenIssueKey(null)}
                        onConfirm={(reason, notes) => confirmFollowUp(i.issueKey, reason, notes)}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {achievements.length > 0 ? (
        <Section title={`🌟 Notable Improvements (${achievements.length})`} subtitle="CUs whose Term 2 performance jumped notably above their Term 1 baseline">
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead><tr><th>CU</th><th>FOA</th><th>Improvement</th><th>Detail</th></tr></thead>
              <tbody>
                {achievements.map((a, idx) => (
                  <tr key={`${a.cu}-${a.type}-${idx}`} className="clickable" onClick={() => onSelectCU(a.cu)}>
                    <td className="item-name">{a.cu}</td>
                    <td>{a.foa}</td>
                    <td><span style={{ background: '#d4edda', padding: '.2rem .5rem', borderRadius: 4, borderLeft: `3px solid ${C.green}`, fontWeight: 600 }}>{a.type}</span></td>
                    <td style={{ fontWeight: 700, color: C.green }}>{a.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
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
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
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
  // One row per (CU, term) present for the region/year — under "All Terms"
  // this has 2 rows per CU (term1 + term2), each nulling out the fields that
  // don't apply to it. Kept around only for Report Timeliness, which is
  // genuinely additive across terms (not term-exclusive-nulled) and sums the
  // raw rows itself.
  const rawData = useMemo(() => {
    let rows = summaryData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
    if (region) rows = rows.filter((d) => String(d.region || '').toLowerCase() === String(region).toLowerCase());
    return rows;
  }, [summaryData, year, term, region]);

  // One row per CU, term-merged under "All Terms" — every other section reads
  // this. Merging (not just filtering) matters here: a CU's term2 row alone
  // has total_scholars_recruited=null, m1/m2=0, schools_with_lec1-5=0 (etc.) —
  // keeping only one of the two term rows silently drops real data from
  // whichever term didn't win. See mergeRowsAcrossTerms.
  const data = useMemo(
    () => (term === 'all' ? mergeRowsAcrossTerms(rawData, (r) => String(r.cu || '').toLowerCase()) : rawData),
    [rawData, term],
  );

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
      <IssueSummary data={data} summaryData={summaryData} year={year} term={term} schoolData={regionSchoolData} onSelectCU={onSelectCU} />
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
        {/* Report timeliness counts are genuinely additive across terms (not
            term-exclusive-nulled like the other CU fields) — deliberately
            fed the raw per-term rows, not the merged `data`, so "All Terms"
            sums real activity from both terms instead of MAX-picking one. */}
        <ReportTimeliness data={rawData} />
      </Section>
    </div>
  );
}
