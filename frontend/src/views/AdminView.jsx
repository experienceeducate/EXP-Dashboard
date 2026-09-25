// Admin: usage analytics + the CU->FOA / Region->PO access mapping editor.
// Gated server-side (ACCESS_CONFIG["admin"], see core/access.py) — App.jsx
// only renders this tab once GET /api/admin/availability says so. Within it,
// the Access Mapping sub-tab is viewable by every admin but only editable by
// ACCESS_CONFIG["access_managers"] (GET /api/admin/access/mapping's
// `canEdit` field) — narrower than plain admin.
import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { Section, ScoreCard, Placeholder } from '../components/ui.jsx';

const ADMIN_SUBTABS = [
  { id: 'analytics', label: '📊 Usage Analytics' },
  { id: 'access', label: '👥 Access Mapping' },
];

const WINDOW_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

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

function UsageAnalyticsSubTab() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

export default function AdminView() {
  const [subTab, setSubTab] = useState('analytics');
  return (
    <Section title="Admin" subtitle="Dashboard usage analytics and access mapping">
      <div className="nat-tab-bar" style={{ marginBottom: '1.25rem' }}>
        {ADMIN_SUBTABS.map((t) => (
          <button key={t.id} type="button" className={`nat-tab-btn ${subTab === t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'analytics' ? <UsageAnalyticsSubTab /> : null}
      {subTab === 'access' ? <AccessMappingSubTab /> : null}
    </Section>
  );
}
