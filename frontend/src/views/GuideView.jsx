import { useState } from 'react';
import { C, RAG } from '../lib/config.js';
import { Section, Placeholder } from '../components/ui.jsx';

// Dashboard Guide — a static reference tab, not tied to term/year/access
// scope. Mirrors National View's own inner-tab pattern (nat-tab-bar +
// onJumpTab) so "Found in ..." cross-references behave exactly like the
// Learning & Measurement Map tab's jump-links to Mentor Quality.
export const GUIDE_TABS = [
  { id: 'overview', label: '📖 Overview' },
  { id: 'howto', label: '🧭 How to Read' },
  { id: 'national', label: '📊 National View' },
  { id: 'regional', label: '🗺️ Regional View' },
  { id: 'cu', label: '🏫 CU View' },
  { id: 'glossary', label: '📐 Glossary' },
  { id: 'roles', label: '🔐 Roles & Access' },
];

function RagChip({ tone, children }) {
  const map = {
    good: { bg: RAG.insightGreenBg, fg: RAG.insightGreen },
    warn: { bg: RAG.insightAmberBg, fg: RAG.insightAmber },
    bad: { bg: RAG.insightRedBg, fg: RAG.insightRed },
  };
  const t = map[tone] || map.good;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem', fontWeight: 700, padding: '.2rem .65rem', borderRadius: 999, background: t.bg, color: t.fg, marginRight: '.4rem', marginBottom: '.4rem' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.fg }} />
      {children}
    </span>
  );
}

function Formula({ children }) {
  return (
    <div style={{ background: '#f0f4f8', borderRadius: 6, padding: '.55rem .8rem', fontFamily: 'monospace', fontSize: '.78rem', color: '#1a1a2e', margin: '.5rem 0 .7rem', whiteSpace: 'pre-wrap', overflowX: 'auto', lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function FoundIn({ children }) {
  return <div style={{ fontSize: '.8rem', color: '#888', marginTop: '.4rem' }}>Found in: {children}</div>;
}

function JumpLink({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: 'none', border: 'none', padding: 0, marginRight: '.6rem', color: C.blue, fontWeight: 600, fontSize: '.8rem', cursor: 'pointer', textDecoration: 'underline' }}
    >
      {children}
    </button>
  );
}

function MetricEntry({ id, title, children }) {
  return (
    <div id={id} style={{ borderTop: '1px solid #e9ecef', padding: '1.15rem 0' }}>
      <div style={{ fontWeight: 800, color: C.navy, fontSize: '1.02rem', marginBottom: '.35rem' }}>{title}</div>
      {children}
    </div>
  );
}

function SubView({ icon, title, children }) {
  return (
    <div style={{ border: '1px solid #e9ecef', borderRadius: 10, background: '#fafbfc', padding: '1rem 1.25rem 1.15rem', margin: '1rem 0' }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: '.4rem' }}>{icon} {title}</div>
      {children}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ onJumpTab }) {
  return (
    <Section title="What this dashboard is" subtitle="One data source, three levels of zoom">
      <p style={{ color: '#444', maxWidth: '62ch' }}>
        The EXP Dashboard is a read-only view over one programme-delivery table, built for
        three audiences at three levels of zoom. Everyone works from the same underlying
        data — what changes between views is scope, not the numbers themselves.
      </p>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead><tr><th>View</th><th>Shows</th><th>Typically used by</th></tr></thead>
          <tbody>
            <tr>
              <td className="item-name clickable" onClick={() => onJumpTab('national')}>National View <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
              <td>Every region, rolled up and compared side by side</td>
              <td>National Leadership</td>
            </tr>
            <tr>
              <td className="item-name clickable" onClick={() => onJumpTab('regional')}>Regional View <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
              <td>One region's Cluster Units, compared side by side</td>
              <td>Regional Officers</td>
            </tr>
            <tr>
              <td className="item-name clickable" onClick={() => onJumpTab('cu')}>CU View <span style={{ fontSize: '.65rem', color: '#0077b6' }}>⌕</span></td>
              <td>One Cluster Unit's schools and mentors, in detail</td>
              <td>FOAs</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ borderLeft: `3px solid ${C.navy}`, background: '#f0f4f8', borderRadius: '0 8px 8px 0', padding: '.8rem 1rem', fontSize: '.88rem', color: '#333' }}>
        <strong style={{ color: C.navy }}>You only ever see what you're scoped to see.</strong> Access is
        enforced on the server, not hidden in the interface — a Regional Officer's Regional
        View is already filtered to their region before it reaches the screen, and an FOA's
        CU View to their Cluster Unit(s). See{' '}
        <JumpLink onClick={() => onJumpTab('roles')}>Roles &amp; Access</JumpLink> for the full breakdown.
      </div>
    </Section>
  );
}

// ── How to Read ──────────────────────────────────────────────────────────────
function HowToTab({ onJumpTab }) {
  return (
    <>
      <Section title="1. The Term filter changes which milestones apply" subtitle="Not just a date range">
        <p style={{ color: '#444', maxWidth: '62ch' }}>
          Several metrics genuinely mean something different in Term 1 versus Term 2,
          because the programme itself changes shape between terms:
        </p>
        <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.15rem', color: '#333' }}>
          <li style={{ marginBottom: '.4rem' }}><strong>Passbook milestones:</strong> Term 1 tracks M1 + M2; Term 2 tracks M3 + M4.</li>
          <li style={{ marginBottom: '.4rem' }}><strong>Group Mentoring:</strong> Term 1 runs GM 1 only; Term 2 runs GM 2 and GM 3.</li>
          <li style={{ marginBottom: '.4rem' }}><strong>Club Meetings:</strong> Term 1 covers Club Meeting 1–2; Term 2 covers 3–4 plus the Business Model Presentation.</li>
          <li style={{ marginBottom: '.4rem' }}><strong>Community Day / Skills Day:</strong> the same slot in the calendar is called Community Day in Term 1 and Skills Day in Term 2.</li>
        </ul>
        <p style={{ color: '#444', maxWidth: '62ch', marginTop: '.6rem' }}>
          Picking <strong>All Terms</strong> combines both — score cards that are term-specific
          (like Passbook Milestone Completion) show every milestone side by side instead of
          picking one pair.
        </p>
      </Section>

      <Section title="2. RAG status: green / amber / red" subtitle="The threshold is different per metric">
        <p style={{ color: '#444', maxWidth: '62ch' }}>
          Read the color as "on track for this metric," not a universal scale — see the exact
          thresholds behind each color in the <JumpLink onClick={() => onJumpTab('glossary')}>Glossary</JumpLink>.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '.6rem 0' }}>
          <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e9ecef', borderRadius: 8, padding: '.8rem 1rem' }}>
            <RagChip tone="good">Green</RagChip>
            <p style={{ margin: 0, fontSize: '.82rem', color: '#666' }}>On track — meeting or exceeding target.</p>
          </div>
          <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e9ecef', borderRadius: 8, padding: '.8rem 1rem' }}>
            <RagChip tone="warn">Amber</RagChip>
            <p style={{ margin: 0, fontSize: '.82rem', color: '#666' }}>Watching — below target, not yet critical.</p>
          </div>
          <div style={{ flex: '1 1 160px', background: '#fff', border: '1px solid #e9ecef', borderRadius: 8, padding: '.8rem 1rem' }}>
            <RagChip tone="bad">Red</RagChip>
            <p style={{ margin: 0, fontSize: '.82rem', color: '#666' }}>Needs attention — meaningfully behind target.</p>
          </div>
        </div>
      </Section>

      <Section title="3. Anything with a ⌕ opens a drill-down" subtitle="Region → Cluster Unit → School, one click at a time">
        <p style={{ color: '#444', maxWidth: '62ch' }}>
          Click a score card, table row, or chart cell marked with <strong style={{ color: C.blue }}>⌕</strong>{' '}
          and a panel slides in, breaking the same metric down region by region, then Cluster
          Unit by Cluster Unit, then school by school.
        </p>
        <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.15rem', color: '#333' }}>
          <li style={{ marginBottom: '.4rem' }}>Mentor Observation Coverage is the one exception — because coverage is really about whether an individual mentor was observed, that drill stops at <strong>Mentor</strong> instead of School, and shows who conducted the observation.</li>
          <li>Every drill panel includes a <strong>"How this is calculated"</strong> card — expand it for the exact formula, data source, and threshold behind the number you clicked.</li>
        </ul>
      </Section>
    </>
  );
}

// ── National View ────────────────────────────────────────────────────────────
function NationalGuideTab({ onJumpTab }) {
  return (
    <Section title="National View" subtitle="Every region · lands on Executive Summary by default">
      <p style={{ color: '#444', maxWidth: '64ch' }}>
        The landing view for anyone with national access. Six inner tabs sit side by side,
        each with its own score cards and breakdowns for the selected term.
      </p>

      <SubView icon="📊" title="Executive Summary">
        <p style={{ margin: 0, color: '#444' }}>
          The top-line read on the whole programme for the selected term: headline KPI cards
          (LEC Delivery, Recruitment, Passbook Quality, Observations, Retention), the Group
          Mentoring session tiles (GM 2, GM 3, and a combined GM Total), a Skills Labs Total,
          a region-by-region comparison table, and the weekly LEC-delivery heatmap.
        </p>
      </SubView>

      <SubView icon="📚" title="LEC Delivery">
        <p style={{ margin: 0, color: '#444' }}>
          Delivery mechanics in depth: a Term-on-Term comparison against the prior term, the
          scholar funnel (Recruited → Activated → Term 1 Completed → Retained), activity
          completion, and the weekly delivery heatmap broken out by LEC number and week.
        </p>
      </SubView>

      <SubView icon="📋" title="Passbook Quality">
        <p style={{ margin: 0, color: '#444' }}>
          Passbook Quality and Passbook Milestone Completion score cards side by side — the
          Milestone Completion cards follow the Term filter (Term 1 shows <strong>M1</strong>{' '}
          and <strong>M2</strong>, Term 2 shows <strong>M3</strong> and <strong>M4</strong>, All
          Terms shows all four) — plus the PB Quality-by-Milestone regional breakdown, the PB
          Milestone Completion table, and Group Mentoring Completion by region and session.
        </p>
        <div style={{ marginTop: '.5rem' }}>
          <JumpLink onClick={() => onJumpTab('glossary')}>See: PB Quality Rate, PB Milestone Completion, Group Mentoring →</JumpLink>
        </div>
      </SubView>

      <SubView icon="🏅" title="Programme Quality">
        <p style={{ margin: 0, color: '#444' }}>
          Mentor Observation Coverage, Report Timeliness, Non-Scholar Participation, Community
          Day / Skills Day, and Club Milestones &amp; Business Model Presentation — the
          operational health metrics that sit outside pure delivery volume.
        </p>
      </SubView>

      <SubView icon="🎓" title="Mentor Quality">
        <p style={{ margin: 0, color: '#444' }}>
          A different data source from the rest of the dashboard — reads directly from the
          mentor observation forms rather than the main delivery table. Four sub-tabs:{' '}
          <strong>Highlights</strong> (a cross-source rollup with a real-quote spotlight and a
          "biggest coaching opportunity" callout), <strong>LEC Observation</strong>,{' '}
          <strong>Group Mentoring</strong>, and <strong>Skills Day</strong>. Each of the latter
          three has its own Region → CU → Mentor drill down to individual observations, plus
          rules-based theme-tagging of observers' written comments.
        </p>
      </SubView>

      <SubView icon="🗺️" title="Learning & Measurement Map">
        <p style={{ margin: 0, color: '#444' }}>
          A static reference tab, not tied to the Term filter or live data — the programme's
          OKRs and learning agenda, organized into four pillars, with jump-links showing where
          each metric is (or isn't yet) measured elsewhere in the dashboard.
        </p>
      </SubView>
    </Section>
  );
}

// ── Regional View ────────────────────────────────────────────────────────────
function RegionalGuideTab({ onJumpTab }) {
  return (
    <Section title="Regional View" subtitle="One region, all its Cluster Units">
      <p style={{ color: '#444', maxWidth: '64ch' }}>
        Regional Officers land here automatically, scoped to their region; National Leadership
        reaches any region via the header's region selector. Everything on this page compares
        Cluster Units against each other within the region.
      </p>
      <ul style={{ margin: '.5rem 0 0', paddingLeft: '1.15rem', color: '#333' }}>
        <li style={{ marginBottom: '.4rem' }}><strong>Notable Improvements</strong> — CUs whose Term 2 performance jumped notably above their Term 1 baseline.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Bottom 5 CUs — LEC Delivery</strong> — the region's lowest delivery-rate Cluster Units.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Activity Completion &amp; Participation</strong> — delivery and participation across the region.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Weekly LEC heatmap</strong> — same shape as the national one, scoped to this region.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>CU Performance Breakdown</strong> — Recruitment, LECs, Activities, PB Quality, and Observations, one row per Cluster Unit.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Mentor Observation Coverage by CU</strong>.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Club Milestones &amp; BMP</strong>, by Cluster Unit.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Skills Day — Gender Breakdown</strong>, by Cluster Unit.</li>
        <li><strong>Activity Report Timeliness</strong>, by Cluster Unit.</li>
      </ul>
      <p style={{ marginTop: '.7rem', color: '#444' }}>
        Click any Cluster Unit row to open <JumpLink onClick={() => onJumpTab('cu')}>CU View</JumpLink> for that unit.
      </p>
    </Section>
  );
}

// ── CU View ──────────────────────────────────────────────────────────────────
function CuGuideTab() {
  return (
    <Section title="CU View" subtitle="One Cluster Unit, school by school">
      <p style={{ color: '#444', maxWidth: '64ch' }}>
        FOAs land here automatically, scoped to their assigned Cluster Unit(s); everyone else
        picks a CU from the header dropdown. The header exposes four filters here — Term, CU,
        School Name, and Mentor Name — deliberately narrower than the other views since
        everything on the page is already at school-and-mentor granularity.
      </p>
      <p style={{ color: '#444', maxWidth: '64ch' }}>
        Before a Cluster Unit is picked, you'll see <strong>All CUs — Activity Summary</strong>:
        one row per Cluster Unit, click through to drill into its schools. Once a CU is selected:
      </p>
      <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.15rem', color: '#333' }}>
        <li style={{ marginBottom: '.4rem' }}><strong>Priority Actions for FOA</strong> — flagged alerts needing follow-up, with resolution status you can update.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Bottom 5 Schools — LEC Delivery</strong> — this CU's schools furthest behind this term.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>School Skills Lab Sequencing</strong> — LECs delivered per school per week, flagging weeks with 3+ LECs (⚡).</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Activity Completion &amp; Participation</strong> — per-school LEC delivery, milestones, and participation.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Schools Behind Schedule</strong> — lagging schools with pending activities, term-aware.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Milestone Reporting</strong> — Passbook milestone completion by school.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Mentor Performance</strong> — delivery, retention, and observations rolled up per mentor.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Club Milestones &amp; BMP</strong>, by school.</li>
        <li style={{ marginBottom: '.4rem' }}><strong>Skills Day</strong>, by school.</li>
        <li><strong>Report Timeliness</strong>, by school.</li>
      </ul>
    </Section>
  );
}

// ── Glossary ─────────────────────────────────────────────────────────────────
function GlossaryTab({ onJumpTab }) {
  return (
    <>
      <Section title="Glossary of metrics" subtitle="What each number means, how it's calculated, and its RAG thresholds">
        <MetricEntry id="term-lec-delivery" title="LEC Delivery Rate">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>The share of this term's scheduled LEC sessions that were actually delivered.</p>
          <Formula>Σ schools_with_lecN (term's LECs) ÷ (target_schools × #LECs in term) × 100</Formula>
          <div><RagChip tone="good">≥ 80%</RagChip><RagChip tone="warn">60–79%</RagChip><RagChip tone="bad">&lt; 60%</RagChip></div>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
            <JumpLink onClick={() => onJumpTab('cu')}>CU View</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-recruitment" title="Scholar Recruitment Rate">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Scholars recruited against target — always measured against the Term 1 baseline; later terms show a "(T1)" badge rather than re-measuring recruitment.</p>
          <Formula>total_scholars_recruited (Term 1) ÷ (target_schools × 45) × 100</Formula>
          <div><RagChip tone="good">≥ 95%</RagChip><RagChip tone="warn">80–94%</RagChip><RagChip tone="bad">&lt; 80%</RagChip></div>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-avg-scholars" title="Avg Scholars per LEC">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Average scholar attendance per delivered session — a read on session turnout, not just whether the session happened.</p>
          <Formula>Σ lecN_scholars (delivered) ÷ Σ schools_with_lecN (delivered)</Formula>
          <div><RagChip tone="good">≥ 45</RagChip><RagChip tone="warn">35–44</RagChip><RagChip tone="bad">&lt; 35</RagChip></div>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → LEC Delivery</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-pb-quality" title="PB Quality Rate">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>The share of <em>rated</em> Passbook entries scored Good or Excellent (≥ 2). Tracked as two term-pairs, usually shown side by side.</p>
          <Formula>{'T1: (m1_quality_rated + m2_quality_rated) ÷ (m1_total_rated + m2_total_rated) × 100\nT2: (m3_quality_rated + m4_quality_rated) ÷ (m3_total_rated + m4_total_rated) × 100'}</Formula>
          <div><RagChip tone="good">≥ 80%</RagChip><RagChip tone="warn">60–79%</RagChip><RagChip tone="bad">&lt; 60%</RagChip></div>
          <p style={{ margin: '.3rem 0 0', color: '#444' }}><strong>Not the same as PB Milestone Completion below</strong> — Quality measures how well a submitted entry was rated; Completion measures whether a school submitted at all.</p>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → Passbook Quality</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-pb-completion" title="PB Milestone Completion (M1 / M2 / M3 / M4)">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Whether a school completed and reported a given Passbook milestone at all, regardless of its rating. Follows the Term filter: Term 1 shows M1 + M2, Term 2 shows M3 + M4, All Terms shows all four.</p>
          <Formula>schools_completed_mN ÷ total_target_schools × 100</Formula>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View → Passbook Quality</JumpLink>
            <JumpLink onClick={() => onJumpTab('cu')}>CU View → Milestone Reporting</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-observations" title="Mentor Observation Coverage">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>The share of active mentors observed at least once by an FOA this term.</p>
          <Formula>min(total_observed_mentors, total_active_mentors) ÷ total_active_mentors × 100</Formula>
          <div><RagChip tone="good">≥ 80%</RagChip><RagChip tone="warn">50–79%</RagChip><RagChip tone="bad">&lt; 50%</RagChip></div>
          <p style={{ margin: '.3rem 0 0', color: '#444' }}>Its drill-down is the one exception to the usual Region → CU → School chain — it stops at <strong>Mentor</strong>, since coverage is about whether a specific person was observed.</p>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View → Programme Quality</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-retention" title="Scholar Retention Rate">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Scholars still engaged by the final tracked LEC, against those activated at LEC 2.</p>
          <Formula>{'lec{last}_scholars ÷ lec2_scholars × 100'}</Formula>
          <div><RagChip tone="good">≥ 95%</RagChip><RagChip tone="warn">80–94%</RagChip><RagChip tone="bad">&lt; 80%</RagChip></div>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → LEC Delivery (scholar funnel)</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-report-timeliness" title="Report Timeliness">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>The share of activity reports submitted early or on schedule, rather than late or not at all.</p>
          <Formula>(reports_early + reports_on_schedule) ÷ total_reports × 100</Formula>
          <div><RagChip tone="good">≥ 70%</RagChip><RagChip tone="warn">50–69%</RagChip><RagChip tone="bad">&lt; 50%</RagChip></div>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
            <JumpLink onClick={() => onJumpTab('cu')}>CU View</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-non-scholar" title="Non-Scholar Participation">
          <p style={{ margin: 0, color: '#444' }}>The share of schools where at least one participant who isn't an enrolled scholar ("non-scholar") attended a session — informational, with no fixed RAG target.</p>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → Programme Quality</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-gm" title="Group Mentoring (GM)">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Mentor-led group sessions held alongside LEC delivery. GM 1 runs in Term 1; GM 2 and GM 3 run in Term 2 (GM 4 is reserved and not yet active).</p>
          <Formula>schools_with_gmN ÷ total_target_schools × 100</Formula>
          <div><RagChip tone="good">≥ 80%</RagChip><RagChip tone="warn">60–79%</RagChip><RagChip tone="bad">&lt; 60%</RagChip></div>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → Executive Summary &amp; Passbook Quality</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-cd-sd" title="Community Day / Skills Day">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>The same slot on the calendar, named differently by term: Community Day in Term 1, Skills Day in Term 2 — Skills Day additionally breaks attendance down by gender.</p>
          <Formula>schools_with_community_day (or _skills_day) ÷ total_target_schools × 100</Formula>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View → Programme Quality</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
            <JumpLink onClick={() => onJumpTab('cu')}>CU View</JumpLink>
          </FoundIn>
        </MetricEntry>

        <MetricEntry id="term-session-duration" title="Avg LEC Session Duration">
          <p style={{ margin: 0, color: '#444' }}>Average minutes per delivered session; typical values sit around 80 minutes. A handful of extreme outliers in the raw data can inflate a simple average, so treat sudden swings with a little skepticism.</p>
          <FoundIn><JumpLink onClick={() => onJumpTab('national')}>National View → LEC Delivery</JumpLink></FoundIn>
        </MetricEntry>

        <MetricEntry id="term-club-milestones" title="Club Milestones & BMP">
          <p style={{ margin: '0 0 .3rem', color: '#444' }}>Club Meetings 1–4 track a scholar club's progress through the term; the Business Model Presentation (BMP) is the Term 2 capstone activity.</p>
          <Formula>schools_with_club_meeting_N (or _bmp) ÷ total_target_schools × 100</Formula>
          <FoundIn>
            <JumpLink onClick={() => onJumpTab('national')}>National View → Programme Quality</JumpLink>
            <JumpLink onClick={() => onJumpTab('regional')}>Regional View</JumpLink>
            <JumpLink onClick={() => onJumpTab('cu')}>CU View</JumpLink>
          </FoundIn>
        </MetricEntry>
      </Section>

      <Section title="Core vocabulary" subtitle="Terms that aren't metrics themselves but show up everywhere the metrics are used">
        <MetricEntry id="term-cu" title="CU — Cluster Unit">
          <p style={{ margin: 0, color: '#444' }}>The operating unit that groups a set of schools under one or more mentors and an FOA. CU View shows exactly one Cluster Unit at a time.</p>
        </MetricEntry>
        <MetricEntry id="term-foa" title="FOA — Field Operational Assistant">
          <p style={{ margin: 0, color: '#444' }}>The staff role responsible for a Cluster Unit's mentors and schools, including conducting mentor observations — appears throughout as <code>foa_name</code>.</p>
        </MetricEntry>
        <MetricEntry id="term-lec" title="LEC — Leadership and Entrepreneurship Course">
          <p style={{ margin: 0, color: '#444' }}>The numbered unit of programme delivery — LEC 1 through LEC 14 across the two terms — that a mentor delivers in a school.</p>
        </MetricEntry>
        <MetricEntry id="term-mentor" title="Mentor">
          <p style={{ margin: 0, color: '#444' }}>The frontline staff member who delivers LECs, Group Mentoring, and Skills Day sessions directly in a school, and who is periodically observed by an FOA.</p>
        </MetricEntry>
        <MetricEntry id="term-pb" title="Passbook (PB)">
          <p style={{ margin: 0, color: '#444' }}>A scholar's individual progress record, rated in stages — Milestones 1 through 4 — across the two terms.</p>
        </MetricEntry>
        <MetricEntry id="term-rag" title="RAG status">
          <p style={{ margin: 0, color: '#444' }}>Red / Amber / Green status coloring used throughout the dashboard. The threshold behind each color is specific to the metric — see above.</p>
        </MetricEntry>
        <MetricEntry id="term-term" title="Term">
          <p style={{ margin: 0, color: '#444' }}>Term 1 and Term 2 are the programme's two reporting periods (Term 3 is reserved for future use). The header's Term filter also offers "All Terms" to combine them.</p>
        </MetricEntry>
      </Section>
    </>
  );
}

// ── Roles & Access ───────────────────────────────────────────────────────────
function RolesTab() {
  return (
    <Section title="Roles & access" subtitle="Enforced server-side, not just hidden in the interface">
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead><tr><th>Role</th><th>Views</th><th>Scope</th></tr></thead>
          <tbody>
            <tr><td className="item-name">National Leadership</td><td>National View (all six tabs)</td><td>Every region</td></tr>
            <tr><td className="item-name">Regional Officers</td><td>Regional View + CU View</td><td>Their assigned region(s)</td></tr>
            <tr><td className="item-name">FOAs</td><td>CU View only</td><td>Their assigned Cluster Unit(s)</td></tr>
          </tbody>
        </table>
      </div>
      <p style={{ color: '#444' }}>Any other <code>@experienceeducate.org</code> address without a specific assignment falls back to National View, read-only, across all regions.</p>
      <div style={{ borderLeft: `3px solid ${C.navy}`, background: '#f0f4f8', borderRadius: '0 8px 8px 0', padding: '.8rem 1rem', fontSize: '.88rem', color: '#333' }}>
        <strong style={{ color: C.navy }}>Enforced server-side.</strong> Row-level scoping happens
        in the query itself, before results are ever sent to your browser — not a filter
        applied afterward in the interface.
      </div>
    </Section>
  );
}

export default function GuideView() {
  const [tab, setTab] = useState('overview');

  const renderTabContent = (tabId) => {
    switch (tabId) {
      case 'overview': return <OverviewTab onJumpTab={setTab} />;
      case 'howto': return <HowToTab onJumpTab={setTab} />;
      case 'national': return <NationalGuideTab onJumpTab={setTab} />;
      case 'regional': return <RegionalGuideTab onJumpTab={setTab} />;
      case 'cu': return <CuGuideTab onJumpTab={setTab} />;
      case 'glossary': return <GlossaryTab onJumpTab={setTab} />;
      case 'roles': return <RolesTab onJumpTab={setTab} />;
      default: return <Placeholder label="Nothing here yet." />;
    }
  };

  return (
    <div>
      <div className="nat-tab-bar">
        {GUIDE_TABS.map((t) => (
          <button key={t.id} type="button" className={`nat-tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {renderTabContent(tab)}
    </div>
  );
}
