import { useMemo } from 'react';
import { getLECsForTerm, C } from '../lib/config.js';
import { sum } from '../lib/metrics.js';
import { formatPercentage, ragColor, ragScoreClass, calculatePBQualityScore, getObsQualityColor, getObsQualityLabel, num, getGMLabel, getNonLECActivityLabel } from '../lib/format.js';
import { Section, ScoreCard, ProgressCell, Placeholder } from '../components/ui.jsx';

const N = (v) => Number(v) || 0;

function dedupSchools(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(String(r.school_id))) map.set(String(r.school_id), r);
  });
  return [...map.values()];
}

// ── All-CUs overview (no CU selected) ────────────────────────────────────────
function AllCUsOverview({ data, year, term, onSelectCU }) {
  const lecNums = getLECsForTerm(year, term);
  const cus = [...new Set(data.map((d) => d.cu).filter(Boolean))].sort();

  let totals = { schools: 0, lecsDel: 0, lecsExp: 0, rec: 0, recTgt: 0, gm: 0, pb: 0, obs: 0, mentors: 0 };

  const rows = cus.map((cu) => {
    const cuData = data.filter((d) => d.cu === cu);
    const schools = [...new Set(cuData.map((d) => d.school_id))];
    const n = schools.length;
    const foa = cuData[0]?.foa_name || '–';
    const findSchool = (sid) => cuData.find((d) => String(d.school_id) === String(sid));
    const rec = schools.reduce((s, sid) => s + N(findSchool(sid).total_scholars_recruited), 0);
    const recTgt = n * 45;
    const recPct = formatPercentage(rec, recTgt);
    const lecsDel = schools.reduce((s, sid) => {
      const sc = findSchool(sid);
      return s + lecNums.filter((ln) => N(sc[`schools_with_lec${ln}`])).length;
    }, 0);
    const lecsExp = n * lecNums.length;
    const lecsPct = formatPercentage(lecsDel, lecsExp);
    const hasGM = schools.filter((sid) => N(findSchool(sid).schools_with_gm)).length;
    const hasPB = schools.filter((sid) => N(findSchool(sid).schools_completed_m1)).length;
    const mentors = [...new Set(cuData.map((d) => d.mentor_id))];
    const obs = mentors.filter((mid) => {
      const m = cuData.find((d) => String(d.mentor_id) === String(mid));
      return m && N(m.total_mentor_observations) > 0;
    }).length;
    const r = [0, 1, 2, 3].map((idx) => schools.reduce((s, sid) => s + N(findSchool(sid)[`cu_total_rating_${idx}`]), 0));
    const qual = calculatePBQualityScore(r[0], r[1], r[2], r[3]);
    const alerts = schools.filter((sid) => {
      const s = findSchool(sid);
      const lecsHad = lecNums.filter((ln) => N(s[`schools_with_lec${ln}`])).length;
      return lecsHad < lecNums.length || !N(s.schools_with_gm) || !N(s.schools_completed_m1);
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

  const pbTotal = sum(schools, (r) => N(r.m1_total_rated) + N(r.m2_total_rated));
  const pbQuality = sum(schools, (r) => N(r.m1_quality_rated) + N(r.m2_quality_rated));
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

  return (
    <div className="score-cards">
      <ScoreCard tone="blue" label="Total Schools" value={n} subtext="Schools in this CU" />
      <ScoreCard tone={ragScoreClass(parseInt(recruitmentRate, 10))} label={`Recruitment vs Target${recNote}`} value={totalRecruited} unit={`/${totalTarget}`} subtext={`${recruitmentRate}% of target (45/school)`} />
      <ScoreCard tone={ragScoreClass(lecDeliveryPct)} label="LEC Delivery Rate" value={lecDeliveryPct} unit="%" subtext={`${lecsDelivered}/${lecsExpected} sessions delivered`} />
      <ScoreCard tone="blue" label="Avg Scholars / LEC" value={avgScholars} subtext="Per school per session" />
      <ScoreCard tone={ragScoreClass(parseInt(onTrackRate, 10))} label="Schools On Track" value={onTrackRate} unit="%" subtext={`${onTrack}/${n} ≥60% LECs & ≥30 scholars`} />
      <ScoreCard tone={pbTotal > 0 ? ragScoreClass(parseInt(feedbackRate, 10), 70, 50) : 'blue'} label="PB Feedback Quality (T1)" value={pbTotal > 0 ? feedbackRate : '-'} unit={pbTotal > 0 ? '%' : ''} subtext={`${pbQuality}/${pbTotal} rated Good/Excellent`} />
      <ScoreCard tone={parseInt(obsRate, 10) >= 75 ? 'green' : 'yellow'} label="Mentor Observations" value={obsSchools} unit={`/${totalMentorCount}`} subtext={`${obsRate}% observed`} />
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
    const pbDone = ss.some((s) => N(s.schools_completed_m1) || N(s.schools_completed_m2));
    const obsCount = Math.max(...ss.map((r) => N(r.total_mentor_observations)), 0);
    const obsScores = ss.map((s) => Number(s.avg_cu_observation_score)).filter((v) => v > 0);
    const avgScore = obsScores.length > 0 ? obsScores.reduce((a, b) => a + b, 0) / obsScores.length : null;
    const rptTotal = ss.reduce((s, r) => s + N(r.total_reports_submitted), 0);
    const rptOnTime = ss.reduce((s, r) => s + N(r.reports_on_schedule) + N(r.reports_early), 0);
    const rptOnTimePct = rptTotal > 0 ? Math.round((rptOnTime / rptTotal) * 100) : null;
    return { mentor, ss, lecsDelivered, lecsExpected, delPct, recruited, activated, retained, retPct, pbDone, obsCount, avgScore, rptTotal, rptOnTime, rptOnTimePct };
  });

  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr style={{ background: C.navy, color: '#fff' }}>
            {['Mentor', 'Schools', 'LECs Delivered', 'Recruited (T1)', 'Activated (LEC2)', 'Retained (last LEC)', 'PB Done', 'Obs', 'Score', 'Reports (on-time)'].map((h, i) => (
              <th key={h} style={{ padding: '.6rem .5rem', textAlign: i === 0 ? 'left' : 'center', color: '#fff', background: 'transparent', border: 'none' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mentor.mentor_id} style={{ borderBottom: '1px solid #e9ecef' }}>
              <td style={{ padding: '.5rem .75rem', fontWeight: 600 }}>{r.mentor.mentor_name}</td>
              <td className="center" style={{ color: '#555' }}>{r.ss.length}</td>
              <td className="center" style={{ fontWeight: 700, color: rag(r.delPct) }}>{r.lecsDelivered}/{r.lecsExpected} ({r.delPct}%)</td>
              <td className="center">{r.recruited > 0 ? r.recruited : '—'}</td>
              <td className="center">{r.activated > 0 ? r.activated : '—'}</td>
              <td className="center" style={{ fontWeight: 700, color: r.retPct !== null ? rag(r.retPct, 85, 70) : '#aaa' }}>{r.retained > 0 ? `${r.retained}${r.retPct !== null ? ` (${r.retPct}%)` : ''}` : '—'}</td>
              <td className="center">{r.pbDone ? '✓' : '—'}</td>
              <td className="center" style={{ fontWeight: 700, color: r.obsCount > 0 ? C.green : '#aaa' }}>{r.obsCount}</td>
              <td className="center" style={{ fontWeight: 700, color: getObsQualityColor(r.avgScore) }}>{r.avgScore ? r.avgScore.toFixed(2) : '—'}{r.avgScore ? <><br /><span style={{ fontSize: '.7rem', fontWeight: 400 }}>{getObsQualityLabel(r.avgScore)}</span></> : null}</td>
              <td className="center">{r.rptTotal > 0 ? <><strong>{r.rptTotal}</strong> total<br /><span style={{ color: r.rptOnTimePct !== null ? rag(r.rptOnTimePct, 70, 50) : '#aaa', fontWeight: 700 }}>{r.rptOnTime}</span> on-time</> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const cuRows = useMemo(() => {
    if (!cu) return [];
    let rows;
    if (cuData && cuData.length > 0) {
      rows = cuData.filter((d) => term === 'all' ? true : d.term === term);
    } else {
      rows = schoolData.filter((d) => d.year == year && (term === 'all' ? true : d.term === term) && String(d.cu || '').toLowerCase() === String(cu).toLowerCase());
    }
    if (schoolFilter) rows = rows.filter((d) => String(d.school_name || '').toLowerCase().includes(schoolFilter.toLowerCase()));
    if (mentorFilter) rows = rows.filter((d) => String(d.mentor_name || '').toLowerCase().includes(mentorFilter.toLowerCase()));
    return rows;
  }, [cu, cuData, schoolData, year, term, schoolFilter, mentorFilter]);

  if (!cu) {
    if (overviewData.length === 0) return <Placeholder label="No school data for the selected year / term." />;
    return <AllCUsOverview data={overviewData} year={year} term={term} onSelectCU={onSelectCU} />;
  }

  if (cuRows.length === 0) return <Placeholder label="No school data for the selected CU." />;

  return (
    <div>
      <CuScoreCards schoolData={schoolData} data={cuRows} year={year} term={term} cu={cu} />
      <Section title="✅ Activity Completion & Participation" subtitle="Per-school LEC delivery, milestones and participation">
        <CuActivityCompletion data={cuRows} year={year} term={term} />
      </Section>
      <Section title="👨‍🏫 Mentor Performance" subtitle="Delivery, retention and observations by mentor">
        <CuMentorPerformance schoolData={schoolData} data={cuRows} year={year} term={term} cu={cu} />
      </Section>
    </div>
  );
}
