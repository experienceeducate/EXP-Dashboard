// ─────────────────────────────────────────────────────────────────────────────
// Client-side issue tracker (localStorage) — ported from the legacy dashboard.
// Persists CU priority-alert resolution state (status + notes + timeline) under
// the key `exp_issue_tracker`. Not backed by BigQuery (workflow state only).
// See DROPPED_SECTIONS.md §3.1.
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'exp_issue_tracker';

export function getIssueTracker() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export function saveIssueTracker(tracker) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tracker));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function getIssueKey(cuName, category, title) {
  return `${cuName}_${category}_${title}`.replace(/\s/g, '_').toLowerCase();
}

export function getIssueStatus(issueKey) {
  const tracker = getIssueTracker();
  return tracker[issueKey] || { status: 'open', timeline: [] };
}

export function updateIssueStatus(issueKey, status, notes, userName) {
  const tracker = getIssueTracker();
  if (!tracker[issueKey]) {
    tracker[issueKey] = { created: new Date().toISOString(), timeline: [] };
  }
  tracker[issueKey].status = status;
  tracker[issueKey].lastUpdated = new Date().toISOString();
  tracker[issueKey].timeline.push({
    timestamp: new Date().toISOString(),
    status,
    notes,
    user: userName || '—',
  });
  saveIssueTracker(tracker);
  return tracker[issueKey];
}
