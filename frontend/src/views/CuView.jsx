import { useMemo, useState } from 'react';
import { getLECsForTerm, C } from '../lib/config.js';
import { sum, computeCuPriorityAlerts, computeLecClusters, getReportTimelinessSummary, mergeRowsAcrossTerms } from '../lib/metrics.js';
import { formatPercentage, ragColor, ragScoreClass, calculatePBQualityScore, getObsQualityColor, getObsQualityLabel, num, getGMLabel, getNonLECActivityLabel } from '../lib/format.js';
import { Section, ScoreCard, ProgressCell, Placeholder } from '../components/ui.jsx';
import { getIssueKey, getIssueStatus, updateIssueStatus } from '../lib/issueTracker.js';
import { TimelinessBar, TimelinessLegend } from './NationalView.jsx';

const N = (v) => Number(v) || 0;
const WEEKS = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'];

function dedupSchools(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(String(r.school_id))) map.set(String(r.school_id), r);
  });
  return [...map.values()];
}

// ── All-CUs overview (no CU selected) ────────────────────────────────────────
function AllCUsOverview({ data: rawData, year, term, schoolData, onSelectCU }) {
  const lecNums = term === 'all' ? Array.from({ length: 14 }, (_, i) => i + 1) : getLECsForTerm(year, term);
  // Term-aware milestone pair — a term2 school row's m1/m2 fields read 0 (and
  // vice versa for term1's m3/m4), same convention as CuMentorPerformance.
  const pbFields = term === 'term1' ? ['m1', 'm2'] : term === 'term2' ? ['m3', 'm4'] : ['m1', 'm2', 'm3', 'm4'];
  // Under "All Terms" there are 2 rows per school (term1 + term2), each
  // nulling out the fields that don't apply to it. `findSchool` below assumes
  // one row per school_id — merge first so it doesn't silently pick whichever
  // term's row happens to come first and drop the other term's real data
  // (same failure mode fixed in RegionalView — see mergeRowsAcrossTerms).
  const data = term === 'all' ? mergeRowsAcrossTerms(rawData, (r) => String(r.school_id)) : rawData;
  const cus = [...new Set(data.map((d) => d.cu).filter(Boolean))].sort();

  // Recruitment is only ever captured in Term 1 — a term2/term3 school row's
  // total_scholars_recruited reads null. Every other recruitment figure in
  // this app (CuScoreCards, CUBreakdown, RegionalView ScoreCards) falls back
  // to the school's own Term 1 row; this table didn't, so it read 0 for every
  // CU whenever a later term was selected.
  const t1BySchool = new Map();
  (schoolData || []).filter((d) => d.term === 'term1' && String(d.year) == year).forEach((d) => {
    if (!t1BySchool.has(String(d.school_id))) t1BySchool.set(String(d.school_id), d);
  });

  let totals = { schools: 0, lecsDel: 0, lecsExp: 0, rec: 0, recTgt: 0, gm: 0, pb: 0, obs: 0, mentors: 0 };

  const rows = cus.map((cu) => {
    const cuData = data.filter((d) => d.cu === cu);
    const schools = [...new Set(cuData.map((d) => d.school_id))];
    const n = schools.length;
    const foa = cuData[0]?.foa_name || '–';
    const findSchool = (sid) => cuData.find((d) => String(d.school_id) === String(sid));
    const rec = schools.reduce((s, sid) => {
      const direct = N(findSchool(sid).total_scholars_recruited);
      if (direct > 0) return s + direct;
      const t1 = t1BySchool.get(String(sid));
      return s + (t1 ? N(t1.total_scholars_recruited) : 0);
    }, 0);
    const recTgt = n * 45;
    const recPct = formatPercentage(rec, recTgt);
    const lecsDel = schools.reduce((s, sid) => {
      const sc = findSchool(sid);
      return s + lecNums.filter((ln) => N(sc[`schools_with_lec${ln}`])).length;
    }, 0);
    const lecsExp = n * lecNums.length;
    const lecsPct = formatPercentage(lecsDel, lecsExp);
    const hasGM = schools.filter((sid) => N(findSchool(sid).schools_with_gm)).length;
    const hasPB = schools.filter((sid) => pbFields.some((m) => N(findSchool(sid)[`schools_completed_${m}`]))).length;
    const mentors = [...new Set(cuData.map((d) => d.mentor_id))];
    const obs = mentors.filter((mid) => {
      const m = cuData.find((d) => String(d.mentor_id) === String(mid));
      return m && N(m.total_mentor_observations) > 0;
    }).length;
    const r = [0, 1, 2, 3].map((idx) => schools.reduce((s, sid) => s + pbFields.reduce((a, m) => a + N(findSchool(sid)[`${m}_total_rating_${idx}`]), 0), 0));
    const qual = calculatePBQualityScore(r[0], r[1], r[2], r[3]);
    const alerts = schools.filter((sid) => {
      const s = findSchool(sid);
      const lecsHad = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`])).length;
      return lecsHad < lecNums.length || !N(s.schools_with_gm) || pbFields.every((m) => !N(s[`schools_completed_${m}`]));
    }).length;

    totals = {
      schools: totals.schools + n,
      lecsDel: totals.lecsDel + lecsDel,
      lecsExp: totals.lecsExp + lecsExp,
      rec: totals.rec + rec,
      recTgt: totals.recTgt + recTgt,
      gm: totals.gm + hasGM,
      pb: totals.pb + hasPB,
      obs: totals.obs + obs,
      mentors: totals.mentors + mentors.length,
    };

    return { cu, foa, n, rec, recTgt, recPct, lecsDel, lecsExp, lecsPct, hasGM, hasPB, qual, ratedTotal: r[0] + r[1] + r[2] + r[3], obs, mentors: mentors.length, alerts };
  });

  const totalRecPct = formatPercentage(totals.rec, totals.recTgt);
  const totalLecPct = formatPercentage(totals.lecsDel, totals.lecsExp);
  const totalObsPct = formatPercentage(totals.obs, totals.mentors);

  return (
    <div>
      <div className="score-cards">
        <ScoreCard tone="blue" label="Total Schools" value={totals.schools} subtext={`${cus.length} CUs in view`} />
        <ScoreCard tone={parseInt(totalRecPct, 10) >= 80 ? 'green' : 'red'} label="Recruitment" value={totalRecPct} unit="%" subtext={`${totals.rec}/${totals.recTgt} scholars`} />
        <ScoreCard tone={parseInt(totalLecPct, 10) >= 80 ? 'green' : 'yellow'} label="LEC Delivery" value={totalLecPct} unit="%" subtext={`${totals.lecsDel}/${totals.lecsExp} delivered`} />
        <ScoreCard tone={parseInt(totalObsPct, 10) >= 75 ? 'green' : 'yellow'} label="Mentor Observations" value={totals.obs} unit={`/${totals.mentors}`} subtext={`${totalObsPct}% observed`} />
      </div>
      <Section title="📊 All CUs — Activity Summary" subtitle={`${cus.length} Cluster Units · Click any CU row to drill into schools`}>
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Cluster Unit</th>
                <th>FOA</th>
                <th className="center">Schools</th>
                <th className="center">Recruited</th>
                <th className="center">LECs Delivered</th>
                <th className="center">{getGMLabel(term)}</th>
                <th className="center">PB Milestone</th>
                <th className="center">Quality %</th>
                <th className="center">Observed</th>
                <th className="center">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cu} className="clickable" onClick={() => onSelectCU(r.cu)}>
                  <td className="item-name">{r.cu}</td>
                  <td style={{ color: '#555' }}>{r.foa}</td>
                  <td className="center"><strong>{r.n}</strong></td>
                  <td className="center" style={{ color: ragColor(r.recPct) }}><strong>{r.rec}/{r.recTgt}</strong><br /><small>{r.recPct}%</small></td>
                  <td className="center" style={{ color: ragColor(r.lecsPct) }}><strong>{r.lecsDel}/{r.lecsExp}</strong><br /><small>{r.lecsPct}%</small></td>
                  <td className="center"><strong>{r.hasGM}/{r.n}</strong></td>
                  <td className="center"><strong>{r.hasPB}/{r.n}</strong></td>
                  <td className="center" style={{ color: r.qual >= 70 ? C.green : r.qual >= 50 ? C.yellow : C.red, fontWeight: 700 }}>{r.ratedTotal > 0 ? `${r.qual}%` : '–'}</td>
                  <td className="center"><strong>{r.obs}/{r.mentors}</strong></td>
                  <td className="center">{r.alerts > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>🔴 {r.alerts}</span> : <span style={{ color: C.green }}>✅</span>}</td>
                </tr>
              ))}
              <tr style={{ background: '#f8f9fa', fontWeight: 700, borderTop: `2px solid ${C.navy}` }}>
                <td colSpan={2}><strong>TOTAL</strong></td>
                <td className="center">{totals.schools}</td>
                <td className="center"><strong>{totals.rec}/{totals.recTgt}</strong><br /><small>{totalRecPct}%</small></td>
                <td className="center"><strong>{totals.lecsDel}/{totals.lecsExp}</strong><br /><small>{totalLecPct}%</small></td>
                <td className="center"><strong>{totals.gm}/{totals.schools}</strong></td>
                <td className="center"><strong>{totals.pb}/{totals.schools}</strong></td>
                <td className="center">–</td>
                <td className="center"><strong>{totals.obs}/{totals.mentors}</strong></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ padding: '1rem', color: '#555', fontSize: '.9rem' }}>
          💡 Select a specific CU from the dropdown above to see school-level detail and mentor performance.
        </p>
      </Section>
    </div>
  );
}

// ── Single-CU score cards ────────────────────────────────────────────────────
function CuScoreCards({ schoolData, data, year, term, cu }) {
  const lecNums = getLECsForTerm(year, term);
  const schools = dedupSchools(data);
  const n = schools.length;
  if (n === 0) return null;

  const cuName = String(cu || '').trim().toLowerCase();
  const t1Schools = schoolData.filter((d) => String(d.term) === 'term1' && String(d.year) == year && String(d.cu || '').trim().toLowerCase() === cuName);
  const recSrc = t1Schools.length > 0 ? dedupSchools(t1Schools) : schools;
  const recMap = new Map(recSrc.map((r) => [String(r.school_id), r]));
  const totalTarget = n * 45;
  const totalRecruited = recSrc.reduce((s, r) => s + N(r.total_scholars_recruited), 0);
  const recruitmentRate = formatPercentage(totalRecruited, totalTarget);
  const recNote = term !== 'term1' ? ' (T1)' : '';

  const lecsDelivered = lecNums.reduce((s, ln) => s + schools.filter((sc) => N(sc[`schools_with_lec${ln}`])).length, 0);
  const lecsExpected = n * lecNums.length;
  const lecDeliveryPct = lecsExpected > 0 ? Math.round((lecsDelivered / lecsExpected) * 100) : 0;

  let totalS = 0;
  let totalDel = 0;
  lecNums.forEach((ln) => {
    schools.forEach((s) => {
      if (N(s[`schools_with_lec${ln}`])) {
        totalS += N(s[`lec${ln}_scholars`]);
        totalDel += 1;
      }
    });
  });
  const avgScholars = totalDel > 0 ? (totalS / totalDel).toFixed(1) : 0;

  const onTrack = schools.filter((s) => {
    const del = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`])).length;
    const recRow = recMap.get(String(s.school_id));
    const rec = recRow ? N(recRow.total_scholars_recruited) : 0;
    return del / lecNums.length >= 0.6 && rec >= 30;
  }).length;
  const onTrackRate = formatPercentage(onTrack, n);

  // Term-aware milestone pair, matching the GM/CM convention used elsewhere
  // in this file (CuMentorPerformance) — a term2 row's m1/m2 fields read 0
  // (and vice versa for term1's m3/m4), so hardcoding m1+m2 here left PB
  // Quality permanently blank whenever term2 was selected.
  const pbFields = term === 'term1' ? ['m1', 'm2'] : term === 'term2' ? ['m3', 'm4'] : ['m1', 'm2', 'm3', 'm4'];
  const pbTotal = sum(schools, (r) => pbFields.reduce((s, m) => s + N(r[`${m}_total_rated`]), 0));
  const pbQuality = sum(schools, (r) => pbFields.reduce((s, m) => s + N(r[`${m}_quality_rated`]), 0));
  const feedbackRate = formatPercentage(pbQuality, pbTotal);

  const mentorObsMap = new Map();
  data.forEach((r) => {
    const mid = String(r.mentor_id || '');
    if (!mid || mid === 'null') return;
    const prev = mentorObsMap.get(mid);
    const obs = N(r.total_mentor_observations);
    if (!prev || obs > prev.obs) mentorObsMap.set(mid, { obs });
  });
  const totalMentorCount = mentorObsMap.size || schools.length;
  const obsSchools = [...mentorObsMap.values()].filter((m) => m.obs > 0).length;
  const obsRate = formatPercentage(obsSchools, totalMentorCount);
  const totalObsVisits = [...mentorObsMap.values()].reduce((s, m) => s + m.obs, 0);

  return (
    <div className="score-cards">
      <ScoreCard tone="blue" label="Total Schools" value={n} subtext="Schools in this CU" />
      <ScoreCard tone={ragScoreClass(parseInt(recruitmentRate, 10))} label={`Recruitment vs Target${recNote}`} value={totalRecruited} unit={`/${totalTarget}`} subtext={`${recruitmentRate}% of target (45/school)`} />
      <ScoreCard tone={ragScoreClass(lecDeliveryPct)} label="LEC Delivery Rate" value={lecDeliveryPct} unit="%" subtext={`${lecsDelivered}/${lecsExpected} sessions delivered`} />
      <ScoreCard tone="blue" label="Avg Scholars / LEC" value={avgScholars} subtext="Per school per session" />
      <ScoreCard tone={ragScoreClass(parseInt(onTrackRate, 10))} label="Schools On Track" value={onTrackRate} unit="%" subtext={`${onTrack}/${n} ≥60% LECs & ≥30 scholars`} />
      <ScoreCard tone={pbTotal > 0 ? ragScoreClass(parseInt(feedbackRate, 10), 70, 50) : 'blue'} label="PB Feedback Quality (T1)" value={pbTotal > 0 ? feedbackRate : '-'} unit={pbTotal > 0 ? '%' : ''} subtext={`${pbQuality}/${pbTotal} rated Good/Excellent`} />
      <ScoreCard tone={parseInt(obsRate, 10) >= 75 ? 'green' : 'yellow'} label="Mentor Observations" value={obsSchools} unit={`/${totalMentorCount}`} subtext={`${obsRate}% schools observed · ${totalObsVisits} visits`} />
    </div>
  );
}

// ── School activity completion ───────────────────────────────────────────────
function CuActivityCompletion({ data, year, term }) {
  const lecNums = getLECsForTerm(year, term);
  const schools = dedupSchools(data);
  const n = schools.length;
  if (n === 0) return <Placeholder label="No school data available." />;

  const lecRows = lecNums.map((ln) => {
    const delivered = schools.filter((s) => N(s[`schools_with_lec${ln}`]));
    const nDel = delivered.length;
    const scholars = delivered.reduce((s, r) => s + N(r[`lec${ln}_scholars`]), 0);
    const nonScholars = delivered.reduce((s, r) => s + N(r[`lec${ln}_non_scholars`]), 0);
    const pct = Math.round((nDel / n) * 100);
    return { label: `LEC ${ln}`, nDel, pct, scholars, nonScholars, avgS: nDel > 0 ? (scholars / nDel).toFixed(1) : '—', avgNS: nDel > 0 ? (nonScholars / nDel).toFixed(1) : '—' };
  });

  const actDef = term === 'term2'
    ? [
        { label: 'GM 2', field: 'schools_with_gm2', schl: 'gm2_total_scholars' },
        { label: 'GM 3', field: 'schools_with_gm3', schl: 'gm3_total_scholars' },
        { label: 'PB Milestone M3', field: 'schools_completed_m3', schl: 'm3_total_rated' },
        { label: 'PB Milestone M4', field: 'schools_completed_m4', schl: 'm4_total_rated' },
      ]
    : [
        { label: 'GM 1', field: 'schools_with_gm1', schl: 'gm1_total_scholars' },
        { label: 'PB Milestone M1', field: 'schools_completed_m1', schl: 'm1_total_rated' },
        { label: 'PB Milestone M2', field: 'schools_completed_m2', schl: 'm2_total_rated' },
      ];
  const actRows = actDef.map((act) => {
    const cnt = schools.filter((s) => N(s[act.field])).length;
    const pct = Math.round((cnt / n) * 100);
    const scholars = sum(schools, (r) => N(r[act.schl]));
    return { label: act.label, nDel: cnt, pct, scholars, avgS: cnt > 0 ? (scholars / cnt).toFixed(1) : '—' };
  });

  const cdField = term === 'term2' ? 'schools_with_skills_day' : 'schools_with_community_day';
  const cdLabel = getNonLECActivityLabel(term);
  const cdCnt = schools.filter((s) => N(s[cdField])).length;
  const cdPct = Math.round((cdCnt / n) * 100);
  const cdScholars = term === 'term2'
    ? sum(schools, (r) => N(r.sd_scholar_attendance || r.sd_total_scholars))
    : sum(schools, (r) => N(r.cd_scholar_attendance));

  const cmDefs = term === 'term2'
    ? [{ label: 'Club Meeting 3', field: 'schools_with_club_meeting_3' }, { label: 'Club Meeting 4', field: 'schools_with_club_meeting_4' }]
    : [{ label: 'Club Meeting 1', field: 'schools_with_club_meeting_1' }, { label: 'Club Meeting 2', field: 'schools_with_club_meeting_2' }];
  const cmRows = cmDefs.map((cm) => {
    const cnt = schools.filter((s) => N(s[cm.field]) > 0).length;
    return { label: cm.label, cnt, pct: Math.round((cnt / n) * 100) };
  });

  // Peer Circles — mentor-level, dedup by mentor_id (max value across a mentor's school rows).
  const mentorPCMap = new Map();
  data.forEach((r) => {
    const mid = String(r.mentor_id || '');
    if (!mid || mid === 'null') return;
    const existing = mentorPCMap.get(mid) || 0;
    const val = N(r.unique_peer_circle_meetings_held);
    if (val > existing) mentorPCMap.set(mid, val);
  });
  const mentorPCList = [...mentorPCMap.values()];
  const totalMentors = mentorPCList.length;
  const pcAttended = mentorPCList.filter((v) => v > 0).length;
  const pcTotalMtgs = mentorPCList.reduce((s, v) => s + v, 0);
  const pcAvg = totalMentors > 0 ? (pcTotalMtgs / totalMentors).toFixed(1) : '—';
  const pcPct = totalMentors > 0 ? Math.round((pcAttended / totalMentors) * 100) : 0;
  const pcZero = totalMentors - pcAttended;

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Activity</th>
            <th className="center">Delivered</th>
            <th>Completion</th>
            <th className="center">Scholars</th>
            <th className="center">Non-Scholars</th>
            <th className="center">Avg S/School</th>
            <th className="center">Avg NS/School</th>
          </tr>
        </thead>
        <tbody>
          {lecRows.map((r) => (
            <tr key={r.label}>
              <td style={{ fontWeight: 600, color: C.navy }}>{r.label}</td>
              <td className="center"><strong style={{ color: ragColor(r.pct) }}>{r.nDel}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{n}</span></td>
              <td style={{ minWidth: 140 }}><ProgressCell pct={r.pct} minWidth={140} /></td>
              <td className="center">{r.scholars > 0 ? num(r.scholars) : '—'}</td>
              <td className="center" style={{ color: '#666' }}>{r.nonScholars > 0 ? num(r.nonScholars) : '—'}</td>
              <td className="center" style={{ fontWeight: 600 }}>{r.avgS}</td>
              <td className="center" style={{ color: '#888' }}>{r.avgNS}</td>
            </tr>
          ))}
          {actRows.map((r) => (
            <tr key={r.label} style={{ background: '#fafafa' }}>
              <td style={{ fontWeight: 600, color: C.navy }}>{r.label}</td>
              <td className="center"><strong style={{ color: ragColor(r.pct) }}>{r.nDel}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{n}</span></td>
              <td style={{ minWidth: 140 }}><ProgressCell pct={r.pct} minWidth={140} /></td>
              <td className="center">{r.scholars > 0 ? num(r.scholars) : '—'}</td>
              <td className="center" style={{ color: '#666' }}>—</td>
              <td className="center" style={{ fontWeight: 600 }}>{r.avgS}</td>
              <td className="center" style={{ color: '#888' }}>—</td>
            </tr>
          ))}
          <tr style={{ background: '#fafafa' }}>
            <td style={{ fontWeight: 600, color: C.navy }}>{cdLabel}</td>
            <td className="center"><strong style={{ color: ragColor(cdPct) }}>{cdCnt}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{n}</span></td>
            <td style={{ minWidth: 140 }}><ProgressCell pct={cdPct} minWidth={140} /></td>
            <td className="center" style={{ fontWeight: 600 }}>{cdScholars > 0 ? num(cdScholars) : '—'}</td>
            <td className="center" style={{ color: '#666' }}>—</td>
            <td className="center" style={{ fontWeight: 600 }}>{cdCnt > 0 ? (cdScholars / cdCnt).toFixed(1) : '—'}</td>
            <td className="center" style={{ color: '#888' }}>—</td>
          </tr>
          {cmRows.map((r) => (
            <tr key={r.label} style={{ background: '#fafafa' }}>
              <td style={{ fontWeight: 600, color: C.navy }}>{r.label}</td>
              <td className="center"><strong style={{ color: ragColor(r.pct) }}>{r.cnt}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{n}</span></td>
              <td style={{ minWidth: 140 }}><ProgressCell pct={r.pct} minWidth={140} /></td>
              <td colSpan={4} style={{ color: '#888', fontSize: '.8rem' }}>Schools that completed {r.label}</td>
            </tr>
          ))}
          <tr style={{ background: '#fafafa' }}>
            <td style={{ fontWeight: 600, color: C.navy }}>Peer Circles <span style={{ fontSize: '.7rem', fontWeight: 400, color: '#888' }}>(mentors)</span></td>
            <td className="center"><strong style={{ color: ragColor(pcPct) }}>{pcAttended}</strong><span style={{ color: '#888', fontSize: '.8rem' }}>/{totalMentors}</span></td>
            <td style={{ minWidth: 140 }}><ProgressCell pct={pcPct} minWidth={140} /></td>
            <td className="center" style={{ fontWeight: 700, color: pcTotalMtgs > 0 ? C.navy : '#aaa' }}>{pcTotalMtgs > 0 ? pcTotalMtgs : '—'}</td>
            <td colSpan={3} style={{ color: '#888', fontSize: '.8rem' }}>
              avg {pcAvg} mtgs/mentor{pcZero > 0 ? <> · <span style={{ color: C.red }}>{pcZero} mentor{pcZero !== 1 ? 's' : ''} at 0</span></> : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Mentor performance ───────────────────────────────────────────────────────
function CuMentorPerformance({ schoolData, data, year, term, cu }) {
  const lecNums = getLECsForTerm(year, term);
  const cuName = String(cu || '').trim().toLowerCase();
  const t1Rows = schoolData.filter((d) => d.term === 'term1' && String(d.year) == year && String(d.cu || '').trim().toLowerCase() === cuName);

  const mentorMap = new Map();
  data.forEach((r) => {
    const mid = String(r.mentor_id || r.mentor_name || 'unknown');
    if (!mentorMap.has(mid)) mentorMap.set(mid, { mentor_id: mid, mentor_name: r.mentor_name || '—', schools: [] });
    mentorMap.get(mid).schools.push(r);
  });
  const rag = (p, g = 80, y = 60) => ragColor(p, g, y);

  const rows = [...mentorMap.values()].map((mentor) => {
    const ss = mentor.schools;
    const lecsDelivered = lecNums.reduce((s, ln) => s + ss.filter((sc) => N(sc[`schools_with_lec${ln}`])).length, 0);
    const lecsExpected = lecNums.length * ss.length;
    const delPct = lecsExpected > 0 ? Math.round((lecsDelivered / lecsExpected) * 100) : 0;
    const mentorT1 = t1Rows.filter((d) => String(d.mentor_id || d.mentor_name || '') === String(ss[0].mentor_id || mentor.mentor_name || ''));
    const recruited = (mentorT1.length > 0 ? mentorT1 : ss).reduce((s, r) => s + N(r.total_scholars_recruited), 0);
    const activated = (mentorT1.length > 0 ? mentorT1 : ss).reduce((s, r) => s + N(r.lec2_scholars), 0);
    let retained = 0;
    for (let i = lecNums.length - 1; i >= 0; i -= 1) {
      const ln = lecNums[i];
      const del = ss.filter((s) => N(s[`schools_with_lec${ln}`]));
      if (del.length > 0) {
        retained = del.reduce((s, r) => s + N(r[`lec${ln}_scholars`]), 0);
        break;
      }
    }
    const retPct = activated > 0 ? Math.round((retained / activated) * 100) : null;

    // GM: sessions completed / expected sessions (term-aware).
    const gmSessionFields = term === 'term1' ? ['schools_with_gm1']
      : term === 'term2' ? ['schools_with_gm2', 'schools_with_gm3']
        : ['schools_with_gm1', 'schools_with_gm2', 'schools_with_gm3'];
    const gmCount = ss.reduce((s, sc) => s + gmSessionFields.reduce((a, f) => a + N(sc[f]), 0), 0);
    const gmExpected = gmSessionFields.length * ss.length;

    // Club meetings: completed / expected (term-aware).
    const cmSessionFields = term === 'term1' ? ['schools_with_club_meeting_1', 'schools_with_club_meeting_2']
      : term === 'term2' ? ['schools_with_club_meeting_3', 'schools_with_club_meeting_4']
        : ['schools_with_club_meeting_1', 'schools_with_club_meeting_2', 'schools_with_club_meeting_3', 'schools_with_club_meeting_4'];
    const cmCount = ss.reduce((s, sc) => s + cmSessionFields.reduce((a, f) => a + N(sc[f]), 0), 0);
    const cmExpected = cmSessionFields.length * ss.length;

    // Peer circles — mentor-level count; value repeats per school row, take max.
    const peerTotal = Math.max(...ss.map((r) => N(r.unique_peer_circle_meetings_held)), 0);

    // PB milestones — term-aware pair, same convention as gmSessionFields/
    // cmSessionFields above (a term2 row's m1/m2 fields read 0 and vice
    // versa, so hardcoding m1/m2 left these permanently blank under term2).
    const pbFields = term === 'term1' ? ['m1', 'm2'] : term === 'term2' ? ['m3', 'm4'] : ['m1', 'm2', 'm3', 'm4'];
    const pbDone = ss.some((s) => pbFields.some((m) => N(s[`schools_completed_${m}`])));
    const obsCount = Math.max(...ss.map((r) => N(r.total_mentor_observations)), 0);
    const obsScores = ss.map((s) => Number(s.avg_cu_observation_score)).filter((v) => v > 0);
    const avgScore = obsScores.length > 0 ? obsScores.reduce((a, b) => a + b, 0) / obsScores.length : null;

    const pbQ = sum(ss, (r) => pbFields.reduce((s, m) => s + N(r[`${m}_quality_rated`]), 0));
    const pbT = sum(ss, (r) => pbFields.reduce((s, m) => s + N(r[`${m}_total_rated`]), 0));
    const pbQPct = pbT > 0 ? Math.round((pbQ / pbT) * 100) : null;

    const rptTotal = ss.reduce((s, r) => s + N(r.total_reports_submitted), 0);
    const rptOnTime = ss.reduce((s, r) => s + N(r.reports_on_schedule) + N(r.reports_early), 0);
    const rptDelayed = sum(ss, (r) => N(r.reports_1_week_delay));
    const rptLate = sum(ss, (r) => N(r.reports_late));
    const rptOnTimePct = rptTotal > 0 ? Math.round((rptOnTime / rptTotal) * 100) : null;
    return {
      mentor, ss, lecsDelivered, lecsExpected, delPct, recruited, activated, retained, retPct,
      gmCount, gmExpected, cmCount, cmExpected, peerTotal, pbDone, obsCount, avgScore, pbQPct,
      rptTotal, rptOnTime, rptDelayed, rptLate, rptOnTimePct,
    };
  });

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr style={{ background: C.navy, color: '#fff' }}>
            {['Mentor', 'Schools', 'LECs Delivered', 'Recruited (T1)', 'Activated (LEC2)', 'Retained (last LEC)', 'GM', 'CM (schools)', 'Peer circles', 'PB Done', 'Obs', 'Score', 'PB Quality', 'Reports (on-time / delayed / late)'].map((h, i) => (
              <th key={h} style={{ padding: '.6rem .5rem', textAlign: i === 0 ? 'left' : 'center', color: '#fff', background: 'transparent', border: 'none', whiteSpace: 'normal', maxWidth: 100 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mentor.mentor_id} style={{ borderBottom: '1px solid #e9ecef' }} title={`Schools: ${r.ss.map((s) => s.school_name || '—').join(', ')}`}>
              <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{r.mentor.mentor_name}</td>
              <td className="center" style={{ color: '#555' }}>{r.ss.length}</td>
              <td className="center" style={{ fontWeight: 700, color: rag(r.delPct) }}>{r.lecsDelivered}/{r.lecsExpected} ({r.delPct}%)</td>
              <td className="center">{r.recruited > 0 ? r.recruited : '—'}</td>
              <td className="center">{r.activated > 0 ? r.activated : '—'}</td>
              <td className="center" style={{ fontWeight: 700, color: r.retPct !== null ? rag(r.retPct, 85, 70) : '#aaa' }}>{r.retained > 0 ? `${r.retained}${r.retPct !== null ? ` (${r.retPct}%)` : ''}` : '—'}</td>
              <td className="center">{r.gmCount}/{r.gmExpected}</td>
              <td className="center" style={{ color: r.cmCount > 0 ? C.green : '#aaa' }}>{r.cmCount}/{r.cmExpected}</td>
              <td className="center" style={{ fontWeight: 700, color: r.peerTotal > 0 ? C.green : C.red }} title="Peer circle meetings attended by this mentor">{r.peerTotal || '0'}</td>
              <td className="center">{r.pbDone ? '✓' : '—'}</td>
              <td className="center" style={{ fontWeight: 700, color: r.obsCount > 0 ? C.green : '#aaa' }}>{r.obsCount}</td>
              <td className="center" style={{ fontWeight: 700, color: getObsQualityColor(r.avgScore) }}>{r.avgScore ? r.avgScore.toFixed(2) : '—'}{r.avgScore ? <><br /><span style={{ fontSize: '.7rem', fontWeight: 400 }}>{getObsQualityLabel(r.avgScore)}</span></> : null}</td>
              <td className="center">{r.pbQPct !== null ? <span style={{ fontWeight: 700, color: rag(r.pbQPct, 70, 50) }}>{r.pbQPct}%</span> : '—'}</td>
              <td className="center">
                {r.rptTotal > 0 ? (
                  <>
                    <strong>{r.rptTotal}</strong><span style={{ color: '#888', fontSize: '.75rem' }}> total</span><br />
                    <span style={{ color: r.rptOnTimePct !== null ? rag(r.rptOnTimePct, 70, 50) : '#aaa', fontWeight: 700 }}>{r.rptOnTime}</span><span style={{ color: '#888', fontSize: '.75rem' }}> on-time</span>
                    {r.rptDelayed > 0 ? <><br /><span style={{ color: '#ffc107', fontSize: '.75rem' }}>+{r.rptDelayed} delayed</span></> : null}
                    {r.rptLate > 0 ? <><br /><span style={{ color: '#dc3545', fontSize: '.75rem' }}>+{r.rptLate} late</span></> : null}
                  </>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Priority Alerts + issue tracker (legacy renderCUPriorityAlerts) ──────────
const STATUS_META = {
  open: { label: '! Open', bg: '#fff3cd', fg: '#7a5b1f' },
  'in-progress': { label: '⟳ In Progress', bg: '#e7f3ff', fg: '#084298' },
  resolved: { label: '✓ Resolved', bg: '#d4edda', fg: '#155724' },
};
const PRIORITY_ICON = { critical: '🔴', high: '🟠', medium: '🟡' };
const PRIORITY_COLOR = { critical: C.red, high: '#e67e22', medium: C.yellow };

function AlertResolution({ alert, issueKey, onSaved }) {
  const iss = getIssueStatus(issueKey);
  const [status, setStatus] = useState(iss.status === 'resolved' ? 'resolved' : iss.status === 'in-progress' ? 'in-progress' : 'in-progress');
  const [notes, setNotes] = useState('');
  const timeline = [...(iss.timeline || [])].reverse();

  const save = () => {
    updateIssueStatus(issueKey, status, notes.trim() || `Marked ${status}`, 'Dashboard User');
    setNotes('');
    onSaved();
  };

  return (
    <div style={{ marginTop: '.75rem', paddingTop: '.75rem', borderTop: '1px dashed #dee2e6' }}>
      <div style={{ fontSize: '.85rem', color: '#444', marginBottom: '.5rem' }}>{alert.description}</div>
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        {alert.metrics.map((m, i) => (
          <div key={i} style={{ background: '#f8f9fa', borderRadius: 6, padding: '.4rem .7rem', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, color: C.navy }}>{m.value}</div>
            <div style={{ fontSize: '.7rem', color: '#888' }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.6rem' }}>
        {alert.schools.slice(0, 12).map((s, i) => (
          <span key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 999, padding: '.15rem .55rem', fontSize: '.75rem' }}>{s.name}</span>
        ))}
        {alert.schools.length > 12 ? <span style={{ fontSize: '.75rem', color: '#888' }}>+{alert.schools.length - 12} more</span> : null}
      </div>
      {timeline.length > 0 ? (
        <div style={{ marginBottom: '.6rem' }}>
          <div style={{ fontSize: '.75rem', fontWeight: 700, color: C.navy, marginBottom: '.35rem' }}>📅 Resolution Timeline</div>
          {timeline.map((t, i) => (
            <div key={i} style={{ fontSize: '.78rem', color: '#555', borderLeft: `3px solid ${STATUS_META[t.status]?.fg || '#ccc'}`, paddingLeft: '.5rem', marginBottom: '.3rem' }}>
              <strong>{(t.status || '').replace('-', ' ').toUpperCase()}</strong> · {new Date(t.timestamp).toLocaleString()}<br />
              {t.notes} <span style={{ color: '#999' }}>— {t.user}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '.35rem .5rem', borderRadius: 6, border: '1px solid #ccc' }}>
          <option value="open">Open</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a resolution note…" style={{ flex: 1, minWidth: 180, padding: '.35rem .6rem', borderRadius: 6, border: '1px solid #ccc' }} />
        <button type="button" onClick={save} style={{ padding: '.4rem .9rem', borderRadius: 6, border: 'none', background: C.navy, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save</button>
      </div>
    </div>
  );
}

function PriorityAlerts({ data, year, term, cu, schoolData }) {
  const { alerts, bottom5, denom } = useMemo(() => computeCuPriorityAlerts(data, year, term, schoolData), [data, year, term, schoolData]);
  const [openIdx, setOpenIdx] = useState(null);
  const [, setTick] = useState(0);

  return (
    <>
      <Section title="🚨 Priority Actions for FOA" subtitle={`${alerts.length} alert${alerts.length !== 1 ? 's' : ''} · click to update resolution status`}>
        {alerts.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f0fdf4', borderRadius: 8 }}>
            <div style={{ fontSize: '2rem' }}>✅</div>
            <h3 style={{ color: C.green, margin: '.25rem 0' }}>No Critical Issues</h3>
            <p style={{ color: '#555', fontSize: '.9rem' }}>All schools and mentors are on track.</p>
          </div>
        ) : (
          alerts.map((alert, i) => {
            const issueKey = getIssueKey(cu, alert.category, alert.title);
            const st = getIssueStatus(issueKey).status || 'open';
            const meta = STATUS_META[st] || STATUS_META.open;
            return (
              <div key={issueKey} style={{ border: '1px solid #e9ecef', borderLeft: `4px solid ${PRIORITY_COLOR[alert.priority]}`, borderRadius: 8, padding: '.9rem 1.1rem', marginBottom: '.85rem', opacity: st === 'resolved' ? 0.75 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem', cursor: 'pointer' }} onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                  <div>
                    <div style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{PRIORITY_ICON[alert.priority]} {alert.category}</div>
                    <div style={{ fontWeight: 700, color: C.navy }}>{alert.title}</div>
                  </div>
                  <span style={{ background: meta.bg, color: meta.fg, padding: '.2rem .6rem', borderRadius: 999, fontSize: '.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{meta.label}</span>
                </div>
                {openIdx === i ? <AlertResolution alert={alert} issueKey={issueKey} onSaved={() => setTick((t) => t + 1)} /> : null}
              </div>
            );
          })
        )}
      </Section>

      <Section title="📊 Bottom 5 Schools — LEC Delivery" subtitle="Schools with fewest LECs delivered this term">
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead><tr><th>School</th><th>Mentor</th><th className="center">LECs Done</th><th className="center">of {denom} due</th><th style={{ minWidth: 140 }}>Progress</th></tr></thead>
            <tbody>
              {bottom5.map(({ s, cnt, pct }) => (
                <tr key={s.school_id}>
                  <td className="item-name">{s.school_name}</td>
                  <td style={{ color: '#555' }}>{s.mentor_name || '—'}</td>
                  <td className="center" style={{ fontWeight: 700, color: ragColor(pct) }}>{cnt}</td>
                  <td className="center" style={{ fontWeight: 700, color: ragColor(pct) }}>{pct}%</td>
                  <td style={{ minWidth: 140 }}><ProgressCell pct={pct} minWidth={140} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ── School Skills Lab Sequencing grid (legacy renderCUSequencing) ────────────
function SchoolSequencing({ data, year, term, schoolData }) {
  const lecNums = getLECsForTerm(year, term);
  const schools = dedupSchools(data);
  const clusterIds = useMemo(() => new Set(computeLecClusters(data, year, term).map((c) => String(c.schoolId))), [data, year, term]);
  const [cellDrill, setCellDrill] = useState(null);
  return (
    <>
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '.5rem .6rem', background: '#f8f9fa', fontWeight: 700, color: C.navy }}>School</th>
              {WEEKS.map((w) => (<th key={w} style={{ textAlign: 'center', padding: '.5rem', fontSize: '.75rem', background: '#f8f9fa', color: '#555' }}>{w}</th>))}
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.school_id} style={{ borderBottom: '1px solid #e9ecef' }}>
                <th style={{ textAlign: 'left', padding: '.4rem .6rem', fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.school_name}>
                  {clusterIds.has(String(s.school_id)) ? '⚡ ' : ''}{s.school_name}
                </th>
                {WEEKS.map((w) => {
                  const count = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`]) && s[`lec${ln}_max_week`] === w).length;
                  // 1 = on-pace (light green) · 2 = still fine, a bit brisker
                  // (deeper green) · 3+ = clustering / mentor-workload risk
                  // (red) — matches the 3+ threshold computeLecClusters
                  // already flags with ⚡.
                  const bg = count === 0 ? '#f8f9fa' : count === 1 ? '#a5d6a7' : count === 2 ? '#4caf50' : '#c9554a';
                  const fg = count === 0 ? '#ccc' : count === 1 ? '#1b3a1f' : '#fff';
                  const clickable = count > 0;
                  return (
                    <td key={w} style={{ padding: 3 }}>
                      <div
                        onClick={clickable ? () => setCellDrill({ school: s, week: w }) : undefined}
                        title={clickable ? `Click to see LEC details for this school in ${w}` : undefined}
                        style={{ background: bg, borderRadius: 5, minHeight: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: fg, fontWeight: 700, cursor: clickable ? 'pointer' : undefined }}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cellDrill ? (
        <SequencingCellDrill school={cellDrill.school} week={cellDrill.week} year={year} term={term} schoolData={schoolData} onClose={() => setCellDrill(null)} />
      ) : null}
    </>
  );
}

// ── Sequencing heatmap cell drill (legacy drillCUSequencingCell) ────────────
function SequencingCellDrill({ school, week, year, term, schoolData, onClose }) {
  const lecNums = getLECsForTerm(year, term);
  const lecsThisWeek = lecNums.filter((ln) => N(school[`schools_with_lec${ln}`]) && school[`lec${ln}_max_week`] === week);
  const allDelivered = lecNums.filter((ln) => N(school[`schools_with_lec${ln}`]));
  const notDelivered = lecNums.filter((ln) => !N(school[`schools_with_lec${ln}`]));
  const totalScholarsThisWeek = sum(lecsThisWeek, (ln) => N(school[`lec${ln}_scholars`]));
  const totalNSThisWeek = sum(lecsThisWeek, (ln) => N(school[`lec${ln}_non_scholars`]));
  const t1Row = (schoolData || []).find((d) => String(d.school_id) === String(school.school_id) && d.term === 'term1' && String(d.year) == year);
  const recruited = t1Row ? N(t1Row.total_scholars_recruited) : 0;

  return (
    <>
      <div className="drill-backdrop" onClick={onClose} />
      <aside className="drill-panel" role="dialog" aria-label={`${school.school_name} — ${week}`}>
        <div className="drill-head">
          <button className="drill-close" onClick={onClose} aria-label="Close">×</button>
          <div className="drill-title">{school.school_name}</div>
          <div className="drill-subtitle">
            📅 {week} — {lecsThisWeek.length} LEC{lecsThisWeek.length !== 1 ? 's' : ''} delivered
            {totalScholarsThisWeek > 0 ? ` · ${totalScholarsThisWeek} scholars${totalNSThisWeek > 0 ? `, ${totalNSThisWeek} non-scholars` : ''}` : ''}
          </div>
        </div>
        <div className="drill-body">
          {lecsThisWeek.length >= 3 ? (
            <div style={{ background: '#fdecea', border: `1px solid ${C.red}`, borderRadius: 8, padding: '.85rem 1rem', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, color: C.red, marginBottom: '.35rem' }}>
                🚨 Action needed: {lecsThisWeek.length} LECs delivered in one week
              </div>
              <div style={{ fontSize: '.85rem', color: '#555' }}>
                Delivering 3 or more LECs in the same week compresses scholar learning time and signals
                catch-up scheduling. Sustained clustering risks mentor fatigue and reduced session quality.{' '}
                <strong>FOAs should review pacing with {school.mentor_name || 'this mentor'} for {school.school_name}.</strong>
              </div>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <div style={{ background: '#eef2ff', borderRadius: 8, padding: '.5rem .9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Mentor</div>
              <div style={{ fontWeight: 700, color: C.navy, fontSize: '.9rem' }}>{school.mentor_name || '—'}</div>
            </div>
            {recruited > 0 ? (
              <div style={{ background: '#e8f5e9', borderRadius: 8, padding: '.5rem .9rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Scholars (T1)</div>
                <div style={{ fontWeight: 700, color: C.green, fontSize: '1.1rem' }}>{recruited}</div>
              </div>
            ) : null}
            <div style={{ background: '#e8f5e9', borderRadius: 8, padding: '.5rem .9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Delivered total</div>
              <div style={{ fontWeight: 700, color: C.green, fontSize: '1.1rem' }}>{allDelivered.length}/{lecNums.length}</div>
            </div>
            {notDelivered.length > 0 ? (
              <div style={{ background: '#fdecea', borderRadius: 8, padding: '.5rem .9rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em' }}>Pending</div>
                <div style={{ fontWeight: 700, color: C.red, fontSize: '1.1rem' }}>{notDelivered.map((n) => `LEC ${n}`).join(', ')}</div>
              </div>
            ) : null}
          </div>

          <div style={{ fontWeight: 700, fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.06em', color: C.navy, borderBottom: `2px solid ${C.navy}`, paddingBottom: '.3rem', marginBottom: '.75rem' }}>
            📅 {week} — {lecsThisWeek.length} LEC{lecsThisWeek.length !== 1 ? 's' : ''} delivered
          </div>
          <table className="breakdown-table" style={{ marginBottom: '1.5rem' }}>
            <thead>
              <tr><th>LEC</th><th className="center">Scholars</th><th className="center">Non-Scholars</th><th className="center">Total Attendance</th><th className="center">Scholar Rate</th></tr>
            </thead>
            <tbody>
              {lecsThisWeek.map((ln) => {
                const sc = N(school[`lec${ln}_scholars`]);
                const ns = N(school[`lec${ln}_non_scholars`]);
                const tot = sc + ns;
                const pct = tot > 0 ? Math.round((sc / tot) * 100) : 0;
                const rag = sc >= recruited * 0.8 ? C.green : sc >= recruited * 0.6 ? C.yellow : C.red;
                return (
                  <tr key={ln}>
                    <td className="item-name">LEC {ln}</td>
                    <td className="center" style={{ fontWeight: 700, color: rag }}>{sc}</td>
                    <td className="center" style={{ color: '#888' }}>{ns > 0 ? ns : '—'}</td>
                    <td className="center" style={{ fontWeight: 600 }}>{tot > 0 ? tot : '—'}</td>
                    <td className="center">{tot > 0 ? `${pct}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {allDelivered.length > 0 ? (
            <>
              <div style={{ fontWeight: 700, fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.06em', color: '#555', borderBottom: '1px solid #dee2e6', paddingBottom: '.3rem', marginBottom: '.75rem' }}>
                📊 Full delivery picture — all {lecNums.length} LECs this term
              </div>
              <table className="breakdown-table">
                <thead>
                  <tr><th>LEC</th><th className="center">Delivered?</th><th className="center">Week</th><th className="center">Scholars</th><th className="center">Non-Scholars</th></tr>
                </thead>
                <tbody>
                  {lecNums.map((ln) => {
                    const delivered = N(school[`schools_with_lec${ln}`]);
                    const wk = school[`lec${ln}_max_week`] || '—';
                    const sc = N(school[`lec${ln}_scholars`]);
                    const ns = N(school[`lec${ln}_non_scholars`]);
                    const highlight = wk === week;
                    return (
                      <tr key={ln} style={highlight ? { fontWeight: 700, background: '#fff9c4' } : undefined}>
                        <td className="item-name">LEC {ln}</td>
                        <td className="center" style={{ color: delivered ? C.green : '#ccc' }}>{delivered ? '✓' : '·'}</td>
                        <td className="center" style={{ color: '#555' }}>{wk}</td>
                        <td className="center">{sc > 0 ? sc : '—'}</td>
                        <td className="center" style={{ color: '#888' }}>{ns > 0 ? ns : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

// ── Schools Behind Schedule (legacy renderCUSchoolsBehind, v6.5 term-aware) ──
function SchoolsBehind({ schoolData, data, year, term, cu }) {
  const lecNums = getLECsForTerm(year, term);
  const actField = term === 'term2' ? 'schools_with_skills_day' : 'schools_with_community_day';
  const actLabel = term === 'term2' ? 'Skills Day' : 'Comm Day';
  const gmFields = term === 'term1' ? [{ key: 'schools_with_gm1', label: 'GM 1' }]
    : term === 'term2' ? [{ key: 'schools_with_gm2', label: 'GM 2' }, { key: 'schools_with_gm3', label: 'GM 3' }]
      : [{ key: 'schools_with_gm1', label: 'GM 1' }, { key: 'schools_with_gm2', label: 'GM 2' }, { key: 'schools_with_gm3', label: 'GM 3' }];
  const cmFields = term === 'term1' ? [{ key: 'schools_with_club_meeting_1', label: 'CM 1' }, { key: 'schools_with_club_meeting_2', label: 'CM 2' }]
    : term === 'term2' ? [{ key: 'schools_with_club_meeting_3', label: 'CM 3' }, { key: 'schools_with_club_meeting_4', label: 'CM 4' }]
      : [{ key: 'schools_with_club_meeting_1', label: 'CM 1' }, { key: 'schools_with_club_meeting_2', label: 'CM 2' }, { key: 'schools_with_club_meeting_3', label: 'CM 3' }, { key: 'schools_with_club_meeting_4', label: 'CM 4' }];

  const schools = dedupSchools(data);
  const cuName = String(cu || '').trim().toLowerCase();
  const t1Map = new Map();
  schoolData.filter((d) => d.term === 'term1' && String(d.year) == year && String(d.cu || '').trim().toLowerCase() === cuName)
    .forEach((r) => { if (!t1Map.has(String(r.school_id))) t1Map.set(String(r.school_id), r); });

  const behind = schools.filter((s) => {
    const del = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`])).length;
    return del < lecNums.length || !N(s[actField]) || gmFields.some((g) => !N(s[g.key])) || cmFields.some((c) => !N(s[c.key]));
  });
  if (behind.length === 0) return <div style={{ textAlign: 'center', padding: '2rem', color: C.green }}>✅ All schools are on track!</div>;

  const chk = (v) => <span style={{ color: v ? C.green : C.red }}>{v ? '✓' : '✗'}</span>;

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>School</th><th>Mentor</th><th className="center">Recruited (T1)</th><th className="center">LECs (x/{lecNums.length})</th>
            {gmFields.map((g) => (<th key={g.key} className="center">{g.label}</th>))}
            <th className="center">{actLabel}</th>
            {cmFields.map((c) => (<th key={c.key} className="center">{c.label}</th>))}
            <th>Action Needed</th>
          </tr>
        </thead>
        <tbody>
          {behind.map((s) => {
            const del = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`])).length;
            const t1 = t1Map.get(String(s.school_id));
            const rec = t1 ? N(t1.total_scholars_recruited) : N(s.total_scholars_recruited);
            const actions = [];
            if (del < lecNums.length) actions.push(`${lecNums.length - del} LEC Pending`);
            gmFields.forEach((g) => { if (!N(s[g.key])) actions.push(`${g.label} pending`); });
            if (!N(s[actField])) actions.push(`${actLabel} pending`);
            cmFields.forEach((c) => { if (!N(s[c.key])) actions.push(`${c.label} pending`); });
            return (
              <tr key={s.school_id}>
                <td style={{ fontWeight: 600 }}>{s.school_name || '—'}</td>
                <td style={{ color: '#555' }}>{s.mentor_name || '—'}</td>
                <td className="center" style={{ fontWeight: 700 }}>{rec > 0 ? rec : '—'}</td>
                <td className="center" style={{ fontWeight: 700, color: del / lecNums.length >= 0.8 ? C.green : C.red }}>{del}/{lecNums.length}</td>
                {gmFields.map((g) => (<td key={g.key} className="center">{chk(N(s[g.key]))}</td>))}
                <td className="center">{chk(N(s[actField]))}</td>
                {cmFields.map((c) => (<td key={c.key} className="center">{chk(N(s[c.key]))}</td>))}
                <td style={{ color: C.red, fontWeight: 600 }}>{actions.join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Milestone Reporting (legacy renderCUMilestoneReporting) ──────────────────
function MilestoneReporting({ data, term }) {
  const mDefs = term === 'term2'
    ? [{ label: 'M3', comp: 'schools_completed_m3' }, { label: 'M4', comp: 'schools_completed_m4' }]
    : term === 'all'
      ? [{ label: 'M1', comp: 'schools_completed_m1' }, { label: 'M2', comp: 'schools_completed_m2' }, { label: 'M3', comp: 'schools_completed_m3' }, { label: 'M4', comp: 'schools_completed_m4' }]
      : [{ label: 'M1', comp: 'schools_completed_m1' }, { label: 'M2', comp: 'schools_completed_m2' }];
  const schools = dedupSchools(data);
  const n = schools.length;
  const totalExpected = n * mDefs.length;
  let totalReported = 0;
  const chk = (v) => <span style={{ color: v ? C.green : C.red }}>{v ? '✓' : '✗'}</span>;

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>School</th><th>Mentor</th>
            {mDefs.map((m) => (<th key={m.comp} className="center">{m.label}</th>))}
            <th className="center">Missing</th><th style={{ minWidth: 130 }}>Rate</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => {
            const reported = mDefs.filter((m) => N(s[m.comp])).length;
            const missing = mDefs.length - reported;
            const rate = formatPercentage(reported, mDefs.length);
            totalReported += reported;
            return (
              <tr key={s.school_id}>
                <td style={{ fontWeight: 600 }}>{s.school_name || '—'}</td>
                <td style={{ color: '#555' }}>{s.mentor_name || '—'}</td>
                {mDefs.map((m) => (<td key={m.comp} className="center">{chk(N(s[m.comp]))}</td>))}
                <td className="center" style={{ fontWeight: 700, color: missing === 0 ? C.green : C.red }}>{missing === 0 ? '✅ 0' : `🔴 ${missing}`}</td>
                <td style={{ minWidth: 130 }}><ProgressCell pct={rate} minWidth={130} /></td>
              </tr>
            );
          })}
          <tr style={{ background: '#f0f4ff', fontWeight: 800, borderTop: `2px solid ${C.navy}` }}>
            <td colSpan={2}>CU TOTAL</td>
            {mDefs.map((m) => (<td key={m.comp} />))}
            <td className="center">{totalExpected - totalReported}</td>
            <td style={{ minWidth: 130 }}><ProgressCell pct={formatPercentage(totalReported, totalExpected)} minWidth={130} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Club Milestones & BMP per school (✓/✗) ───────────────────────────────────
function ClubMilestonesBySchool({ data, term }) {
  const all = [
    { key: 'schools_with_club_meeting_1', label: 'CM 1', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_2', label: 'CM 2', terms: ['term1', 'all'] },
    { key: 'schools_with_club_meeting_3', label: 'CM 3', terms: ['term2', 'all'] },
    { key: 'schools_with_club_meeting_4', label: 'CM 4', terms: ['term2', 'all'] },
    { key: 'schools_with_bmp', label: 'BMP', terms: ['term2', 'all'] },
  ];
  const active = all.filter((m) => m.terms.includes(term));
  if (active.length === 0) return <Placeholder label="No club milestones for the selected term." />;
  const schools = dedupSchools(data);
  const tot = schools.length;
  const chk = (v) => <span style={{ color: v ? C.green : C.red }}>{v ? '✓' : '✗'}</span>;
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem', marginBottom: '1.25rem' }}>
        <thead>
          <tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '.5rem .75rem', textAlign: 'left', fontWeight: 700, color: '#555' }}>Milestone</th>
            <th style={{ textAlign: 'center', padding: '.5rem', fontWeight: 700, color: '#555' }}>Schools</th>
            <th style={{ textAlign: 'center', padding: '.5rem', fontWeight: 700, color: '#555' }}>%</th>
            <th style={{ padding: '.5rem', fontWeight: 700, color: '#555' }}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {active.map((m) => {
            const cnt = schools.filter((s) => N(s[m.key]) > 0).length;
            const pct = tot > 0 ? Math.round((cnt / tot) * 100) : 0;
            const rc = cnt > 0 ? ragColor(pct) : '#ccc';
            return (
              <tr key={m.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{m.label}</td>
                <td className="center" style={{ fontWeight: 700, color: rc }}>{cnt} / {tot}</td>
                <td className="center" style={{ fontWeight: 600, color: rc }}>{pct}%</td>
                <td style={{ padding: '.5rem' }}><ProgressCell pct={pct} color={rc} minWidth={120} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr><th>School</th><th>Mentor</th>{active.map((m) => (<th key={m.key} className="center">{m.label}</th>))}</tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.school_id}>
                <td style={{ fontWeight: 600 }}>{s.school_name || '—'}</td>
                <td style={{ color: '#555' }}>{s.mentor_name || '—'}</td>
                {active.map((m) => (<td key={m.key} className="center">{chk(N(s[m.key]))}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Skills Day per school (T2/All) ───────────────────────────────────────────
function SkillsDayBySchool({ data }) {
  const allSchools = dedupSchools(data);
  const schools = allSchools.filter((s) => N(s.schools_with_skills_day) > 0 || N(s.sd_total_scholars) > 0);
  if (schools.length === 0) return <Placeholder label="No Skills Day data for this CU yet." />;

  const tot = sum(schools, (s) => N(s.sd_total_scholars));
  const male = sum(schools, (s) => N(s.sd_male_scholars));
  const female = sum(schools, (s) => N(s.sd_female_scholars));
  const ns = sum(schools, (s) => N(s.sd_total_non_scholars));

  return (
    <>
      <div style={{ background: '#EEF5ED', borderRadius: 8, padding: '.7rem 1rem', marginBottom: '.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '.85rem' }}>
        <span><strong>{schools.length}</strong> schools delivered</span>
        <span>Total: <strong>{num(tot)}</strong></span>
        <span>Male: <strong>{num(male)}</strong> ({tot > 0 ? Math.round((male / tot) * 100) : 0}%)</span>
        <span>Female: <strong>{num(female)}</strong> ({tot > 0 ? Math.round((female / tot) * 100) : 0}%)</span>
        <span>Non-scholars: <strong>{num(ns)}</strong></span>
      </div>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr><th>School</th><th>Mentor</th><th className="center">Delivered</th><th className="center">Scholars</th><th className="center" style={{ color: C.blue }}>Male</th><th className="center" style={{ color: C.red }}>Female</th><th className="center">Non-Scholars</th></tr>
          </thead>
          <tbody>
            {schools.map((s) => {
              const sch = N(s.sd_total_scholars);
              const sMale = N(s.sd_male_scholars);
              const sFemale = N(s.sd_female_scholars);
              return (
                <tr key={s.school_id}>
                  <td style={{ fontWeight: 600 }}>{s.school_name || '—'}</td>
                  <td style={{ color: '#555' }}>{s.mentor_name || '—'}</td>
                  <td className="center"><span style={{ color: N(s.schools_with_skills_day) ? C.green : C.red }}>{N(s.schools_with_skills_day) ? '✓' : '✗'}</span></td>
                  <td className="center">{num(sch)}</td>
                  <td className="center" style={{ color: C.blue }}>{sMale > 0 ? num(sMale) : '—'}</td>
                  <td className="center" style={{ color: C.red }}>{sFemale > 0 ? num(sFemale) : '—'}</td>
                  <td className="center" style={{ color: '#888' }}>{num(N(s.sd_total_non_scholars))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Report Timeliness by school + CU total (legacy §2.8) ─────────────────────
function CuReportTimeliness({ data }) {
  // Report timeliness counts are genuinely additive across terms (unlike
  // most CU/school fields, which null out whichever term doesn't apply) —
  // dedupSchools alone would silently keep only one term's row per school
  // and drop the other term's real report counts under "All Terms". Group
  // by school_id and sum instead.
  const bySchool = new Map();
  data.forEach((d) => {
    const key = String(d.school_id);
    if (!bySchool.has(key)) bySchool.set(key, []);
    bySchool.get(key).push(d);
  });
  const schoolRows = [...bySchool.values()].map((rows) => ({ school: rows[0], rows }));
  const cuTotal = getReportTimelinessSummary(data);
  if (cuTotal.total === 0) return <Placeholder label="No report data yet." />;
  return (
    <>
      <TimelinessLegend />
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
          <thead>
            <tr style={{ background: C.navy, color: '#fff' }}>
              {['School', 'Total', 'Early', 'On Schedule', '1 Wk Delay', 'Late', 'Unscheduled', 'Breakdown'].map((h, i) => (
                <th key={h} style={{ padding: '.6rem .75rem', textAlign: i === 0 || i === 7 ? 'left' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schoolRows.map(({ school: s, rows }) => {
              const cs = getReportTimelinessSummary(rows);
              if (cs.total === 0) return null;
              return (
                <tr key={s.school_id} style={{ borderBottom: '1px solid #e9ecef' }}>
                  <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{s.school_name || '—'}</td>
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
            <tr style={{ background: '#f0f4ff', fontWeight: 800, borderTop: `2px solid ${C.navy}` }}>
              <td style={{ padding: '.5rem .75rem' }}>CU TOTAL</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.total}</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.early} ({cuTotal.earlyPct}%)</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.onTime} ({cuTotal.onTimePct}%)</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.week1} ({cuTotal.week1Pct}%)</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.late} ({cuTotal.latePct}%)</td>
              <td style={{ textAlign: 'center' }}>{cuTotal.unsched}</td>
              <td style={{ padding: '.5rem .75rem', minWidth: 120 }}><TimelinessBar s={cuTotal} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function CuView({ schoolData, cuData, year, term, cu, allowedCUs, schoolFilter, mentorFilter, onSelectCU }) {
  // Overview data — schoolData for the year/term scoped to accessible CUs.
  const overviewData = useMemo(() => {
    let rows = schoolData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term));
    if (allowedCUs && allowedCUs.length > 0) {
      const set = new Set(allowedCUs.map((c) => String(c).toLowerCase()));
      rows = rows.filter((d) => set.has(String(d.cu || '').toLowerCase()));
    }
    return rows;
  }, [schoolData, year, term, allowedCUs]);

  // Selected-CU school rows: prefer fetched cuData, else filter schoolData.
  // This is the FULL CU dataset — CU-wide aggregates (score cards, priority
  // alerts, activity completion) must never shrink just because a school/mentor
  // search narrows the per-school tables below.
  const cuRows = useMemo(() => {
    if (!cu) return [];
    if (cuData && cuData.length > 0) {
      return cuData.filter((d) => term === 'all' ? true : d.term === term);
    }
    return schoolData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && String(d.cu || '').toLowerCase() === String(cu).toLowerCase());
  }, [cu, cuData, schoolData, year, term]);

  // School/mentor name search — scoped to the per-school breakdown tables only.
  const filteredRows = useMemo(() => {
    let rows = cuRows;
    if (schoolFilter) rows = rows.filter((d) => String(d.school_name || '').toLowerCase().includes(schoolFilter.toLowerCase()));
    if (mentorFilter) rows = rows.filter((d) => String(d.mentor_name || '').toLowerCase().includes(mentorFilter.toLowerCase()));
    return rows;
  }, [cuRows, schoolFilter, mentorFilter]);

  if (!cu) {
    if (overviewData.length === 0) return <Placeholder label="No school data for the selected year / term." />;
    return <AllCUsOverview data={overviewData} year={year} term={term} schoolData={schoolData} onSelectCU={onSelectCU} />;
  }

  if (cuRows.length === 0) return <Placeholder label="No school data for the selected CU." />;

  const showSkillsDay = term === 'term2' || term === 'all';
  const isFiltered = Boolean(schoolFilter || mentorFilter);

  return (
    <div>
      <PriorityAlerts data={cuRows} year={year} term={term} cu={cu} schoolData={schoolData} />
      <CuScoreCards schoolData={schoolData} data={cuRows} year={year} term={term} cu={cu} />
      <Section title="📅 School Skills Lab Sequencing" subtitle="LECs delivered per school per week (⚡ = 3+ LECs in one week)">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No schools match this filter." /> : (
          <SchoolSequencing data={filteredRows} year={year} term={term} schoolData={schoolData} />
        )}
      </Section>
      <Section title="✅ Activity Completion & Participation" subtitle="Per-school LEC delivery, milestones and participation">
        <CuActivityCompletion data={cuRows} year={year} term={term} />
      </Section>
      <Section title="⏰ Schools Behind Schedule" subtitle="Lagging schools with pending activities (term-aware)">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No schools match this filter." /> : (
          <SchoolsBehind schoolData={schoolData} data={filteredRows} year={year} term={term} cu={cu} />
        )}
      </Section>
      <Section title="📋 Milestone Reporting" subtitle="Passbook milestone completion by school">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No schools match this filter." /> : (
          <MilestoneReporting data={filteredRows} term={term} />
        )}
      </Section>
      <Section title="👨‍🏫 Mentor Performance" subtitle="Delivery, retention and observations by mentor">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No mentors match this filter." /> : (
          <CuMentorPerformance schoolData={schoolData} data={filteredRows} year={year} term={term} cu={cu} />
        )}
      </Section>
      <Section title="🏛️ Club Milestones & BMP" subtitle="Club meetings and Business Model Presentation by school">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No schools match this filter." /> : (
          <ClubMilestonesBySchool data={filteredRows} term={term} />
        )}
      </Section>
      {showSkillsDay ? (
        <Section title="🔬 Skills Day" subtitle="Skills Day delivery and attendance by school">
          <SkillsDayBySchool data={filteredRows} />
        </Section>
      ) : null}
      <Section title="📅 Report Timeliness" subtitle="Report submission schedule by school">
        {isFiltered && filteredRows.length === 0 ? <Placeholder label="No schools match this filter." /> : (
          <CuReportTimeliness data={filteredRows} />
        )}
      </Section>
    </div>
  );
}
