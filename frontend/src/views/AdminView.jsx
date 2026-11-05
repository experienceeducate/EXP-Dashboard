// Admin: usage analytics, the CU->FOA / Region->PO access mapping editor, and
// individual guest access (requests, approvals, whitelist, audit).
// Gated server-side (ACCESS_CONFIG["admin"], see core/access.py) — App.jsx
// only renders this tab once GET /api/admin/availability says so. Within it,
// the Access Mapping sub-tab is viewable by every admin but only editable by
// ACCESS_CONFIG["access_managers"] (GET /api/admin/access/mapping's
// `canEdit` field) — narrower than plain admin. Guest access follows the same
// rule (GET /api/admin/guests's `canEdit`).
import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as api from '../lib/api.js';
import { Section, ScoreCard, Placeholder } from '../components/ui.jsx';

const ADMIN_SUBTABS = [
  { id: 'analytics', label: '📊 Usage Analytics' },
  { id: 'access', label: '👥 Access Mapping' },
  { id: 'guests', label: '🔑 Guest access' },
];

const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

// "other" = a domain-fallback National-view login (any @experienceeducate.org
// email not explicitly listed anywhere) — has no fixed roster to divide by,
// so it's excluded from the 3 rostered categories' usability rates, but still
// shown here so it's filterable/visible in the per-user table.
const ROLE_LABELS = { national: 'National', regional: 'Regional (PO)', cu: 'CU (FOA)', other: 'Other' };
// Categorical palette — validated (dataviz skill): first 3 slots (blue/orange/
// aqua) clear every CVD/contrast gate together. Never used for the "other"
// bucket, which isn't part of the 3-category usability comparison.
const ROLE_COLORS = { national: '#2a78d6', regional: '#eb6834', cu: '#1baf7a' };
const ROLE_FILTER_OPTIONS = [{ value: 'all', label: 'All roles' }, ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))];

function PageViewsTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <Placeholder label="No page views recorded yet for this window." />;
  }
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="table-wrap">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Tab</th>
            <th className="center">Views</th>
            <th className="center">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.view}>
              <td className="item-name">{r.view}</td>
              <td className="center"><strong>{r.count}</strong></td>
              <td className="center">{total > 0 ? `${Math.round((r.count / total) * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMinutes(seconds) {
  return Math.round(((seconds || 0) / 60) * 10) / 10;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function ByUserTable({ rows, roleFilter, onRoleFilterChange }) {
  const filtered = roleFilter === 'all' ? (rows || []) : (rows || []).filter((r) => r.role === roleFilter);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
        <select className="header-select" value={roleFilter} onChange={(e) => onRoleFilterChange(e.target.value)} aria-label="Filter by role">
          {ROLE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <Placeholder label="No per-user activity recorded yet for this window / role filter." />
      ) : (
        <div className="table-wrap">
          <table className="breakdown-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th className="center">Page Views</th>
                <th className="center">Sessions</th>
                <th className="center">Tabs Viewed</th>
                <th className="center">Active (min)</th>
                <th>First Seen</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.user_email}>
                  <td className="item-name">{r.user_email}</td>
                  <td>{ROLE_LABELS[r.role] || r.role}</td>
                  <td className="center">{r.page_views}</td>
                  <td className="center">{r.sessions}</td>
                  <td className="center">{r.distinct_tabs}</td>
                  <td className="center"><strong>{formatMinutes(r.active_seconds)}</strong></td>
                  <td>{formatTimestamp(r.first_seen)}</td>
                  <td>{formatTimestamp(r.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RoleUsabilityStrip({ roleTotals, byWeekRole }) {
  const latest = byWeekRole && byWeekRole.length > 0 ? byWeekRole[byWeekRole.length - 1] : null;
  return (
    <div className="score-cards">
      {['national', 'regional', 'cu'].map((role) => {
        const week = latest ? latest[role] : null;
        const pct = week ? week.usability_pct : 0;
        return (
          <ScoreCard
            key={role}
            tone={pct >= 60 ? 'green' : pct >= 30 ? 'yellow' : 'red'}
            label={`${ROLE_LABELS[role]} Usability (this week)`}
            value={`${pct}%`}
            subtext={`${week ? week.active_users : 0} of ${roleTotals ? roleTotals[role] : 0} logged in`}
          />
        );
      })}
    </div>
  );
}

function formatWeekLabel(weekStart) {
  const d = new Date(`${weekStart}T00:00:00`);
  return Number.isNaN(d.getTime()) ? weekStart : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function WeeklyUsabilityChart({ byWeekRole }) {
  const chartData = useMemo(
    () => (byWeekRole || []).map((w) => ({
      week: formatWeekLabel(w.week_start),
      national: w.national.usability_pct,
      regional: w.regional.usability_pct,
      cu: w.cu.usability_pct,
    })),
    [byWeekRole],
  );
  if (chartData.length === 0) {
    return <Placeholder label="No weekly usage data yet — widen the time window to see a trend." />;
  }
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e1e0d9" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: '#898781' }}
            axisLine={false}
            tickLine={false}
            width={44}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip formatter={(value, name) => [`${value}%`, ROLE_LABELS[name] || name]} />
          <Legend formatter={(value) => ROLE_LABELS[value] || value} />
          <Line type="monotone" dataKey="national" name="national" stroke={ROLE_COLORS.national} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="regional" name="regional" stroke={ROLE_COLORS.regional} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="cu" name="cu" stroke={ROLE_COLORS.cu} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function UsageAnalyticsSubTab() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .fetchAdminAnalytics(days)
      .then((res) => {
        if (active) setSummary(res);
      })
      .catch((e) => {
        if (active) setError(e.message || 'Failed to load usage analytics.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days]);

  const avgMinutes = summary && summary.avg_session_seconds ? Math.round((summary.avg_session_seconds / 60) * 10) / 10 : 0;

  return (
    <>
      <div className="header-right" style={{ marginBottom: '1rem' }}>
        <select className="header-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
          {WINDOW_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error ? <div className="login-error" style={{ maxWidth: 600 }}>{error}</div> : null}

      {loading ? (
        <Placeholder label="Loading usage analytics…" />
      ) : (
        <>
          <div className="score-cards">
            <ScoreCard tone="blue" label="Active Users" value={summary ? summary.active_users : 0} subtext={`Last ${days} days`} />
            <ScoreCard tone="green" label="Sessions" value={summary ? summary.total_sessions : 0} subtext="Completed sessions" />
            <ScoreCard tone="yellow" label="Avg. Session Length" value={avgMinutes} unit="min" subtext="Per completed session" />
          </div>

          <Section title="Page Views by Tab">
            <PageViewsTable rows={summary ? summary.page_views_by_tab : []} />
          </Section>

          <Section title="Weekly Usability by Role" subtitle="Active users this week / total users in that role's roster — National, Regional (PO), CU (FOA)">
            <RoleUsabilityStrip roleTotals={summary ? summary.role_totals : null} byWeekRole={summary ? summary.by_week_role : []} />
            <WeeklyUsabilityChart byWeekRole={summary ? summary.by_week_role : []} />
          </Section>

          <Section title="By User" subtitle="Sorted by active minutes">
            <ByUserTable rows={summary ? summary.by_user : []} roleFilter={roleFilter} onRoleFilterChange={setRoleFilter} />
          </Section>
        </>
      )}
    </>
  );
}

function MappingTable({ title, scopeType, rows, canEdit, onAdd, onRemove, busyKey }) {
  const [drafts, setDrafts] = useState({});
  const keys = Object.keys(rows).sort((a, b) => a.localeCompare(b));
  return (
    <Section title={title}>
      <div className="table-wrap">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>{scopeType === 'regional' ? 'Region' : 'CU'}</th>
              <th>Assigned</th>
              {canEdit ? <th>Add</th> : null}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const emails = rows[key] || [];
              const rowBusy = busyKey === `${scopeType}:${key}`;
              return (
                <tr key={key}>
                  <td className="item-name">{key}</td>
                  <td>
                    {emails.length === 0 ? <span style={{ color: '#999' }}>— none assigned —</span> : null}
                    {emails.map((email) => (
                      <span
                        key={email}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: '#f0f4ff',
                          border: '1px solid #dbe4ff', borderRadius: 999, padding: '.2rem .5rem .2rem .65rem',
                          margin: '.15rem .35rem .15rem 0', fontSize: '.8rem',
                        }}
                      >
                        {email}
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => onRemove(scopeType, key, email)}
                            aria-label={`Remove ${email}`}
                            title="Remove"
                            style={{ border: 'none', background: 'none', cursor: rowBusy ? 'default' : 'pointer', color: '#a00', fontWeight: 700, padding: 0, lineHeight: 1 }}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </td>
                  {canEdit ? (
                    <td>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <input
                          type="email"
                          placeholder="new.person@experienceeducate.org"
                          value={drafts[key] || ''}
                          disabled={rowBusy}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          style={{ flex: 1, minWidth: 200, padding: '.3rem .5rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '.8rem' }}
                        />
                        <button
                          type="button"
                          disabled={rowBusy || !(drafts[key] || '').trim()}
                          onClick={() => {
                            const email = (drafts[key] || '').trim();
                            if (!email) return;
                            onAdd(scopeType, key, email);
                            setDrafts((d) => ({ ...d, [key]: '' }));
                          }}
                          style={{ border: '1px solid #0e313e', background: '#0e313e', color: '#fff', borderRadius: 6, padding: '.3rem .7rem', fontSize: '.8rem', cursor: rowBusy ? 'default' : 'pointer' }}
                        >
                          Add
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AccessMappingSubTab() {
  const [mapping, setMapping] = useState(null); // { regional, cu, canEdit }
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState('');

  const load = () => {
    api
      .fetchAccessMapping()
      .then((res) => setMapping(res))
      .catch((e) => setError(e.message || 'Failed to load the access mapping.'));
  };

  useEffect(() => {
    load();
  }, []);

  const runChange = async (scopeType, scopeKey, args) => {
    setActionError('');
    setBusyKey(`${scopeType}:${scopeKey}`);
    try {
      await api.updateAccessMapping({ scopeType, scopeKey, ...args });
      load();
    } catch (e) {
      setActionError(e.message || 'Failed to save the change.');
    } finally {
      setBusyKey(null);
    }
  };

  const onAdd = (scopeType, scopeKey, email) => runChange(scopeType, scopeKey, { addEmail: email });
  const onRemove = (scopeType, scopeKey, email) => runChange(scopeType, scopeKey, { removeEmail: email });

  if (error) return <div className="login-error" style={{ maxWidth: 600 }}>{error}</div>;
  if (!mapping) return <Placeholder label="Loading access mapping…" />;

  return (
    <>
      <p style={{ color: '#666', fontSize: '.85rem', maxWidth: 700, marginTop: 0 }}>
        {mapping.canEdit
          ? 'Add a new FOA/PO by email, or remove one to reassign (a "switch" is just remove the old person, then add the new one). Changes apply immediately for anyone already logged in.'
          : 'View-only — you can see current assignments, but only Afra, Charlotte, or John Bosco can change them.'}
      </p>
      {actionError ? <div className="login-error" style={{ maxWidth: 600 }}>{actionError}</div> : null}
      <MappingTable title="Regions (PO)" scopeType="regional" rows={mapping.regional} canEdit={mapping.canEdit} onAdd={onAdd} onRemove={onRemove} busyKey={busyKey} />
      <MappingTable title="CUs (FOA)" scopeType="cu" rows={mapping.cu} canEdit={mapping.canEdit} onAdd={onAdd} onRemove={onRemove} busyKey={busyKey} />
    </>
  );
}

// ── Guest access (backend/app/routers/guests_admin.py) ──────────────────────
// Individual, time-limited guest accounts replace the old shared password. A
// guest requests access (or is invited); an access manager approves them with
// ONE region or CU and an end date, and — a separate control — whitelists
// their exact email. Only then can they get a single-use sign-in link.
// Every admin can view; only access managers (`canEdit`) see write controls.
const GUEST_STATUS_STYLE = {
  pending: { bg: '#fff3cd', fg: '#7a5b1f' },
  approved: { bg: '#d4edda', fg: '#155724' },
  expired: { bg: '#e9ecef', fg: '#555' },
  revoked: { bg: '#f8d7da', fg: '#842029' },
  rejected: { bg: '#f8d7da', fg: '#842029' },
};

const SMALL_BTN = { border: '1px solid #ccc', background: '#fff', borderRadius: 6, padding: '.25rem .6rem', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const PRIMARY_BTN = { ...SMALL_BTN, border: '1px solid #0e313e', background: '#0e313e', color: '#fff' };
const DANGER_BTN = { ...SMALL_BTN, border: '1px solid #a00', color: '#a00' };
const FIELD = { padding: '.3rem .5rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '.8rem' };

function formatDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function scopeLabel(grant) {
  if (!grant || !grant.scope_type || !grant.scope_key) return '—';
  return `${grant.scope_type === 'regional' ? 'Region' : 'CU'}: ${grant.scope_key}`;
}

function StatusPill({ status }) {
  const st = GUEST_STATUS_STYLE[status] || { bg: '#e9ecef', fg: '#555' };
  return <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: '.1rem .55rem', fontSize: '.75rem', fontWeight: 700 }}>{status || '—'}</span>;
}

// One region OR one CU — a guest is never national. Value is "type:key".
function ScopeSelect({ scopes, value, onChange, disabled }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={FIELD} aria-label="Guest scope">
      <option value="">Choose region or CU…</option>
      <optgroup label="Region">
        {(scopes.regional || []).map((k) => <option key={`r-${k}`} value={`regional:${k}`}>{k}</option>)}
      </optgroup>
      <optgroup label="CU">
        {(scopes.cu || []).map((k) => <option key={`c-${k}`} value={`cu:${k}`}>{k}</option>)}
      </optgroup>
    </select>
  );
}

function splitScope(value) {
  const i = (value || '').indexOf(':');
  return i > 0 ? { scope_type: value.slice(0, i), scope_key: value.slice(i + 1) } : null;
}

function DaysInput({ value, onChange, maxDays, disabled }) {
  return (
    <input
      type="number"
      min={1}
      max={maxDays || 365}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Days of access"
      title="Days of access"
      style={{ ...FIELD, width: 70 }}
    />
  );
}

function parseDays(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function PendingRequestRow({ r, data, busy, onApprove, onReject }) {
  const [scope, setScope] = useState('');
  const [days, setDays] = useState(String(data.defaultDays || 90));
  return (
    <tr>
      <td className="item-name">{r.email}</td>
      <td>{r.organization || '—'}</td>
      <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{r.reason || '—'}</td>
      <td>{formatDay(r.requested_at)}</td>
      {data.canEdit ? (
        <td>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <ScopeSelect scopes={data.scopes || {}} value={scope} onChange={setScope} disabled={busy} />
            <DaysInput value={days} onChange={setDays} maxDays={data.maxDays} disabled={busy} />
            <span style={{ fontSize: '.75rem', color: '#666' }}>days</span>
            <button
              type="button"
              disabled={busy || !scope}
              onClick={() => onApprove(r.email, splitScope(scope), parseDays(days, data.defaultDays))}
              style={PRIMARY_BTN}
              title="Approve with this scope and whitelist the email"
            >
              Approve
            </button>
            <button type="button" disabled={busy} onClick={() => onReject(r.email)} style={DANGER_BTN}>Reject</button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function InviteForm({ data, busy, onInvite }) {
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState('');
  const [days, setDays] = useState(String(data.defaultDays || 90));
  const [organization, setOrganization] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const grant = splitScope(scope);
    if (!email.trim() || !grant) return;
    const ok = await onInvite({
      email: email.trim(),
      ...grant,
      days: parseDays(days, data.defaultDays),
      organization: organization.trim() || null,
    });
    if (ok) {
      setEmail('');
      setOrganization('');
      setScope('');
    }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="email" required placeholder="guest@example.org" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} style={{ ...FIELD, minWidth: 220 }} />
      <input type="text" placeholder="Organisation (optional)" value={organization} onChange={(e) => setOrganization(e.target.value)} disabled={busy} maxLength={200} style={{ ...FIELD, minWidth: 180 }} />
      <ScopeSelect scopes={data.scopes || {}} value={scope} onChange={setScope} disabled={busy} />
      <DaysInput value={days} onChange={setDays} maxDays={data.maxDays} disabled={busy} />
      <span style={{ fontSize: '.75rem', color: '#666' }}>days</span>
      <button type="submit" disabled={busy || !email.trim() || !scope} style={PRIMARY_BTN}>Invite</button>
    </form>
  );
}

function WhitelistEditor({ rows, canEdit, busy, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  return (
    <>
      <div style={{ marginBottom: canEdit ? '.75rem' : 0 }}>
        {rows.length === 0 ? <span style={{ color: '#999' }}>— no whitelisted emails —</span> : null}
        {rows.map((w) => (
          <span
            key={w.email}
            title={w.added_by ? `Added by ${w.added_by}${w.added_at ? ` · ${formatDay(w.added_at)}` : ''}` : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: '#f0f4ff',
              border: '1px solid #dbe4ff', borderRadius: 999, padding: '.2rem .5rem .2rem .65rem',
              margin: '.15rem .35rem .15rem 0', fontSize: '.8rem',
            }}
          >
            {w.email}
            {canEdit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(w.email)}
                aria-label={`Remove ${w.email} from the whitelist`}
                title="Remove from whitelist"
                style={{ border: 'none', background: 'none', cursor: busy ? 'default' : 'pointer', color: '#a00', fontWeight: 700, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onAdd(draft.trim());
            setDraft('');
          }}
          style={{ display: 'flex', gap: '.4rem' }}
        >
          <input type="email" placeholder="guest@example.org" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} style={{ ...FIELD, minWidth: 240 }} />
          <button type="submit" disabled={busy || !draft.trim()} style={PRIMARY_BTN}>Add to whitelist</button>
        </form>
      ) : null}
    </>
  );
}

// `details` is a JSON object string (e.g. {"reason": ..., "grant": {...}}).
function auditDetail(details) {
  if (!details) return '';
  let obj = details;
  if (typeof details === 'string') {
    try {
      obj = JSON.parse(details);
    } catch {
      return details;
    }
  }
  if (!obj || typeof obj !== 'object') return String(obj);
  return Object.entries(obj)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v && typeof v === 'object' ? (v.scope_key ? `${v.scope_type} ${v.scope_key}` : JSON.stringify(v)) : v}`)
    .join(' · ');
}

function GuestAuditList() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || events) return undefined;
    let active = true;
    api
      .fetchGuestAudit(200)
      .then((res) => { if (active) setEvents(res.events || []); })
      .catch((e) => { if (active) setError(e.message || 'Failed to load the audit log.'); });
    return () => { active = false; };
  }, [open, events]);
  return (
    <Section title="Recent access events">
      <button type="button" onClick={() => setOpen((o) => !o)} style={SMALL_BTN} aria-expanded={open}>
        {open ? '▾ Hide audit log' : '▸ Show audit log'}
      </button>
      {open ? (
        <div style={{ marginTop: '.75rem' }}>
          {error ? <div className="login-error" style={{ maxWidth: 600 }}>{error}</div> : null}
          {!events && !error ? <Placeholder label="Loading audit log…" /> : null}
          {events && events.length === 0 ? <Placeholder label="No access events recorded yet." /> : null}
          {events && events.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="breakdown-table">
                <thead><tr><th>When</th><th>Event</th><th>Subject</th><th>By</th><th>Detail</th></tr></thead>
                <tbody>
                  {events.map((ev, i) => (
                    <tr key={`${ev.event_timestamp}-${i}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(ev.event_timestamp)}</td>
                      <td>{(ev.event_type || '').replace(/_/g, ' ')}</td>
                      <td>{ev.subject_email || '—'}</td>
                      <td>{ev.actor_email || '—'}</td>
                      <td style={{ fontSize: '.75rem', color: '#666' }}>{auditDetail(ev.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function GuestAccessSubTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () =>
    api
      .fetchGuests()
      .then((res) => setData(res))
      .catch((e) => setError(e.message || 'Failed to load guest access.'));

  useEffect(() => {
    load();
  }, []);

  // Every write: email in the body, reload the lists afterwards (even on a
  // partial failure the server's state is the truth).
  const run = async (action, body, success) => {
    setActionError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.guestAction(action, body);
      setNotice(typeof success === 'function' ? success(res) : success || '');
      return true;
    } catch (e) {
      setActionError(e.message || 'Failed to save the change.');
      return false;
    } finally {
      setBusy(false);
      load();
    }
  };

  const onApprove = (email, grant, days) =>
    run('approve', { email, ...grant, days, whitelist: true }, `${email} approved and whitelisted — they can now request a sign-in link.`);
  const onReject = (email) => {
    const reason = window.prompt(`Reject the access request from ${email}? Optional reason (kept in the audit log):`, '');
    if (reason === null) return;
    run('reject', { email, reason: reason.trim() || null }, `Request from ${email} rejected.`);
  };
  const onRenew = (email) =>
    run('renew', { email, days: data.defaultDays }, (res) => `${email} renewed${res && res.expiresAt ? ` until ${formatDay(res.expiresAt)}` : ''}.`);
  const onRevoke = (email) => {
    if (!window.confirm(`Revoke guest access for ${email}? Their sessions end immediately.`)) return;
    run('revoke', { email }, (res) => `${email} revoked${res && res.sessionsRevoked ? ` · ${res.sessionsRevoked} session(s) ended` : ''}.`);
  };
  const onInvite = (body) =>
    run('invite', body, (res) => (res && res.linkSent
      ? `${body.email} invited — a sign-in link is on its way. Add them to the whitelist if they aren't already, or the link won't work.`
      : `${body.email} invited, but no email was sent (email is not configured).`));
  const onWhitelistAdd = (email) => run('whitelist/add', { email }, `${email} added to the whitelist.`);
  const onWhitelistRemove = (email) => run('whitelist/remove', { email }, `${email} removed from the whitelist.`);

  if (error) return <div className="login-error" style={{ maxWidth: 600 }}>{error}</div>;
  if (!data) return <Placeholder label="Loading guest access…" />;

  const requests = data.requests || [];
  const guests = data.guests || [];
  const canEdit = !!data.canEdit;

  return (
    <>
      <p style={{ color: '#666', fontSize: '.85rem', maxWidth: 760, marginTop: 0 }}>
        Guests (partners, personal email addresses) get their own time-limited access to one region or CU. A guest
        must be <strong>approved</strong> and their exact email <strong>whitelisted</strong> before a sign-in link
        will work. Revoking ends their sessions immediately.
        {canEdit ? '' : ' View-only — only access managers can change guest access.'}
      </p>
      {data.signInAvailable === false ? (
        <div className="login-error" style={{ maxWidth: 760 }}>
          Guest sign-in is unavailable: email sending is not configured on the server, so no sign-in links can be sent.
        </div>
      ) : null}
      {actionError ? <div className="login-error" style={{ maxWidth: 760 }}>{actionError}</div> : null}
      {notice ? (
        <div style={{ maxWidth: 760, background: '#eaf6ee', border: '1px solid #b7dfc3', color: '#155724', borderRadius: 8, padding: '.6rem .8rem', fontSize: '.85rem', marginBottom: '.9rem' }}>{notice}</div>
      ) : null}

      <Section title={`Pending requests (${requests.length})`}>
        {requests.length === 0 ? (
          <Placeholder label="No pending access requests." />
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead>
                <tr><th>Email</th><th>Organisation</th><th>Reason</th><th>Requested</th>{canEdit ? <th>Decision</th> : null}</tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <PendingRequestRow key={r.email} r={r} data={data} busy={busy} onApprove={onApprove} onReject={onReject} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Guests (${guests.length})`} subtitle={canEdit ? `Renew extends by ${data.defaultDays} days (max ${data.maxDays})` : undefined}>
        {guests.length === 0 ? (
          <Placeholder label="No guests yet." />
        ) : (
          <div className="table-wrap">
            <table className="breakdown-table">
              <thead>
                <tr>
                  <th>Email</th><th>Status</th><th>Scope</th><th>Access ends</th><th className="center">Whitelisted</th>
                  <th className="center">Can sign in</th><th>Last sign-in</th><th className="center">Sessions</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.email}>
                    <td className="item-name">
                      {g.email}
                      {g.organization ? <div style={{ fontSize: '.72rem', color: '#888', fontWeight: 400 }}>{g.organization}</div> : null}
                    </td>
                    <td><StatusPill status={g.status} /></td>
                    <td>{scopeLabel(g.grant)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDay(g.expires_at)}
                      {g.days_left != null && g.status === 'approved' ? (
                        <div style={{ fontSize: '.72rem', color: g.days_left <= 7 ? '#a00' : '#888' }}>{g.days_left} day{g.days_left !== 1 ? 's' : ''} left</div>
                      ) : null}
                    </td>
                    <td className="center">{g.whitelisted ? '✓' : '—'}</td>
                    <td className="center">{g.can_sign_in ? '✓' : '—'}</td>
                    <td>{g.last_login_at ? formatTimestamp(g.last_login_at) : '—'}</td>
                    <td className="center">{g.active_sessions || 0}</td>
                    {canEdit ? (
                      <td>
                        <div style={{ display: 'flex', gap: '.35rem' }}>
                          {g.status === 'approved' || g.status === 'expired' ? (
                            <button type="button" disabled={busy} onClick={() => onRenew(g.email)} style={SMALL_BTN} title={`Extend by ${data.defaultDays} days`}>Renew</button>
                          ) : null}
                          {g.status !== 'revoked' && g.status !== 'rejected' ? (
                            <button type="button" disabled={busy} onClick={() => onRevoke(g.email)} style={DANGER_BTN}>Revoke</button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Whitelist" subtitle="Exact emails allowed to receive a sign-in link (a separate control from approval)">
        <WhitelistEditor rows={data.whitelist || []} canEdit={canEdit} busy={busy} onAdd={onWhitelistAdd} onRemove={onWhitelistRemove} />
      </Section>

      {canEdit ? (
        <Section title="Invite a guest" subtitle="Approves the email for one region or CU and sends them a sign-in link">
          <InviteForm data={data} busy={busy} onInvite={onInvite} />
        </Section>
      ) : null}

      <GuestAuditList />
    </>
  );
}

export default function AdminView() {
  const [subTab, setSubTab] = useState('analytics');
  return (
    <Section title="Admin" subtitle="Dashboard usage analytics, access mapping and guest access">
      <div className="nat-tab-bar" style={{ marginBottom: '1.25rem' }}>
        {ADMIN_SUBTABS.map((t) => (
          <button key={t.id} type="button" className={`nat-tab-btn ${subTab === t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'analytics' ? <UsageAnalyticsSubTab /> : null}
      {subTab === 'access' ? <AccessMappingSubTab /> : null}
      {subTab === 'guests' ? <GuestAccessSubTab /> : null}
    </Section>
  );
}
