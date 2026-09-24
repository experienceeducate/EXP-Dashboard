// ─────────────────────────────────────────────────────────────────────────────
// Issue tracker — CU priority-alert / Regional-issue follow-up state.
// BigQuery-backed (see backend/app/routers/tasks.py) — not localStorage.
// The read side (getIssueStatus) stays synchronous, backed by an in-memory
// cache populated by loadIssueTracker(); callers must call that once (e.g. on
// view mount) and re-render (a tick/counter state works) once it resolves, the
// same way they already re-render after updateIssueStatus.
// ─────────────────────────────────────────────────────────────────────────────
import * as api from './api.js';

let cache = {};

export function getIssueKey(cuName, category, title) {
  return `${cuName}_${category}_${title}`.replace(/\s/g, '_').toLowerCase();
}

// Fetch every issue's status + timeline within the caller's access scope and
// populate the in-memory cache. Safe to call repeatedly (e.g. once per view
// mount) — each call replaces the cache with a fresh read.
export async function loadIssueTracker() {
  try {
    const res = await api.fetchTaskStatuses();
    cache = res.tasks || {};
  } catch {
    cache = {};
  }
  return cache;
}

export function getIssueStatus(issueKey) {
  return cache[issueKey] || { status: 'open', timeline: [] };
}

// context: { region, cu, issueType, issueDetail, severity, reason, notes }
export async function updateIssueStatus(issueKey, status, context = {}) {
  const { region, cu, issueType, issueDetail, severity, reason, notes } = context;
  const res = await api.updateTaskStatus({
    issue_key: issueKey,
    region: region || '',
    cu: cu || '',
    issue_type: issueType || '',
    issue_detail: issueDetail || '',
    severity: severity || '',
    status,
    reason: reason || null,
    notes: notes || null,
  });

  // Optimistic: append locally rather than re-fetching — a BigQuery
  // streaming insert isn't guaranteed visible to a query run immediately
  // after it (see routers/tasks.py), so a refetch here could read stale data.
  const entry = cache[issueKey] || { status: 'open', timeline: [] };
  entry.status = status;
  entry.timeline = [
    ...entry.timeline,
    { timestamp: res.timestamp, status, notes: res.notes, user: res.user_email },
  ];
  cache[issueKey] = entry;
  return entry;
}
