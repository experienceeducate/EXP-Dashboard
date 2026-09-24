// Admin: dashboard usage analytics (page views, active users, session length).
// Gated server-side (ACCESS_CONFIG["admin"], see core/access.py) — App.jsx
// only renders this tab once GET /api/admin/availability says so.
import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { Section, ScoreCard, Placeholder } from '../components/ui.jsx';

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

export default function AdminView() {
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
    <Section title="Admin" subtitle="Dashboard usage analytics">
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
    </Section>
  );
}
