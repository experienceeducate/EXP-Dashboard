// ─────────────────────────────────────────────────────────────────────────────
// Data layer against the NEW FastAPI backend.
// Every /api request sends X-Exp-Client: dashboard-v1 and (except the public
// auth endpoints) a Bearer access token.
//
// Sessions are server-side (backend/app/auth.py): a 15-minute access JWT plus a
// rotating refresh token, both kept in sessionStorage. The access token is
// refreshed ~1 minute before it expires (while the user is active) and on any
// 401, with a single in-flight refresh shared by every caller; the original
// request is retried once. A refresh that fails with 400/401 signs the user out.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'exp_token';
const REFRESH_KEY = 'exp_refresh';
const EXPIRES_KEY = 'exp_token_expires'; // epoch ms
const CLIENT_HEADER = 'dashboard-v1';
const REFRESH_LEAD_MS = 60 * 1000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function readStore(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getToken() {
  return readStore(TOKEN_KEY);
}

function getRefreshToken() {
  return readStore(REFRESH_KEY);
}

function getExpiresAt() {
  const v = Number(readStore(EXPIRES_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ── Session lifecycle ────────────────────────────────────────────────────────
let refreshTimer = null;
let lastActivity = Date.now();
let sessionEndedHandler = null;

// App registers this so a failed refresh (session revoked, idle, expired)
// drops the user back to the login screen from wherever it happened.
export function onSessionEnded(fn) {
  sessionEndedHandler = fn;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  const expiresAt = getExpiresAt();
  if (!expiresAt || !getRefreshToken()) return;
  const delay = Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    // Only keep an active user's session warm: refreshing an untouched tab
    // forever would defeat the server's idle timeout. An idle tab refreshes
    // on its next request instead (ensureFreshToken / the 401 path).
    const issuedAt = expiresAt - 15 * 60 * 1000;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (lastActivity > issuedAt && !hidden) refreshSession().catch(() => {});
  }, delay);
}

// Store a session response ({token, refresh_token, expires_in, ...}).
function setSession(json) {
  writeStore(TOKEN_KEY, json.token);
  writeStore(REFRESH_KEY, json.refresh_token);
  const seconds = Number(json.expires_in) || 900;
  writeStore(EXPIRES_KEY, String(Date.now() + seconds * 1000));
  scheduleRefresh();
}

export function clearToken() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  writeStore(TOKEN_KEY, null);
  writeStore(REFRESH_KEY, null);
  writeStore(EXPIRES_KEY, null);
}

function endSession() {
  clearToken();
  if (sessionEndedHandler) sessionEndedHandler();
}

// Re-arm the proactive refresh after a page reload (tokens survive in
// sessionStorage, timers don't).
export function resumeSession() {
  if (getToken()) scheduleRefresh();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postRefresh(refreshToken) {
  let res;
  try {
    res = await fetch(`${BASE}/api/auth/session/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Exp-Client': CLIENT_HEADER },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    throw new ApiError(`Network error: ${e.message}`, 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((json && json.detail) || `Refresh failed (${res.status})`, res.status);
  return json;
}

async function doRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new ApiError('Your session has ended. Please sign in again.', 401);
  try {
    setSession(await postRefresh(refreshToken));
    return true;
  } catch (e) {
    if (e.status !== 409) throw e;
  }
  // 409: this refresh token was rotated moments ago (another tab sharing this
  // session's storage). Wait, re-read, and retry once with the newer token.
  // Never re-send the same rotated token after the grace window — the server
  // treats that as theft and revokes the session.
  await sleep(1000);
  const latest = getRefreshToken();
  if (latest && latest !== refreshToken) {
    setSession(await postRefresh(latest));
    return true;
  }
  if (getToken() && getExpiresAt() > Date.now()) return true; // already refreshed
  throw new ApiError('Your session has ended. Please sign in again.', 401);
}

let refreshInFlight = null;

// Single in-flight refresh: concurrent callers share one rotation.
export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh()
      .catch((e) => {
        // Network/5xx: keep the session (the next call retries). Anything
        // else (400/401/409-after-retry) means the session is gone.
        if (e.status && e.status !== 429 && e.status < 500) endSession();
        throw e;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function ensureFreshToken() {
  const expiresAt = getExpiresAt();
  if (getRefreshToken() && expiresAt && expiresAt - Date.now() < REFRESH_LEAD_MS) {
    try {
      await refreshSession();
    } catch {
      /* fall through: the request itself will 401 and be handled */
    }
  }
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// fetch() for an authenticated /api call: refreshes ahead of expiry, and on a
// 401 refreshes once and retries the original request once.
async function authedFetch(path, init) {
  lastActivity = Date.now();
  await ensureFreshToken();
  const send = () => fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, ...authHeaders() } });
  let res;
  try {
    res = await send();
    if (res.status === 401 && getRefreshToken()) {
      let refreshed = false;
      try {
        refreshed = await refreshSession();
      } catch {
        refreshed = false;
      }
      if (refreshed) res = await send();
    }
  } catch (e) {
    throw new ApiError(`Network error: ${e.message}`, 0);
  }
  if (res.status === 401) {
    endSession();
    throw new ApiError('Unauthorized', 401);
  }
  return res;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'X-Exp-Client': CLIENT_HEADER };
  if (body) headers['Content-Type'] = 'application/json';
  const init = { method, headers, body: body ? JSON.stringify(body) : undefined };

  let res;
  if (auth) {
    res = await authedFetch(path, init);
  } else {
    try {
      res = await fetch(`${BASE}${path}`, init);
    } catch (e) {
      throw new ApiError(`Network error: ${e.message}`, 0);
    }
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok || (json && json.status && json.status !== 'ok')) {
    const msg = (json && (json.detail || json.message)) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return json;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────
// Full URL that kicks off the Google SSO flow. The backend redirects the browser
// to Google and, on success, back to FRONTEND_URL/#login_code=<one-time code>
// (never a token in a URL). We navigate the whole window here (not fetch) so the
// browser follows the OAuth redirects.
export function googleLoginUrl() {
  return `${BASE}/api/auth/google/login`;
}

// Consume the auth fragment left in the URL — #login_code=<code> (Google SSO),
// #magic=<token> (guest email link) or #error=<code> — strip the hash at once
// (no history entry, nothing left to leak or re-consume) and return what it
// found. Nothing is stored or redeemed here: the caller exchanges the login
// code, and a magic link is only redeemed when the guest presses "Sign in"
// (email scanners prefetch links). Call once at module load.
export function consumeAuthRedirect() {
  let hash = '';
  try {
    hash = window.location.hash || '';
  } catch {
    return {};
  }
  if (!hash || hash.length < 2) return {};
  const params = new URLSearchParams(hash.slice(1)); // drop leading '#'
  const loginCode = params.get('login_code');
  const magic = params.get('magic');
  const error = params.get('error');
  if (!loginCode && !magic && !error) return {};

  try {
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);
  } catch {
    /* ignore */
  }

  if (loginCode) return { loginCode };
  if (magic) return { magic };
  return { error };
}

// GET /api/auth/config (public) → { status, google, guest_sign_in_available }
export async function fetchAuthConfig() {
  return request('/api/auth/config', { auth: false });
}

// POST /api/auth/session/exchange {code} → session response
// { status, token, refresh_token, expires_in, session_expires_at, auth_kind, user }
export async function exchangeLoginCode(code) {
  const json = await request('/api/auth/session/exchange', { method: 'POST', body: { code }, auth: false });
  setSession(json);
  return json;
}

// POST /api/auth/magic-link/redeem {token} → session response (same shape)
export async function redeemMagicLink(token) {
  const json = await request('/api/auth/magic-link/redeem', { method: 'POST', body: { token }, auth: false });
  setSession(json);
  return json;
}

// POST /api/auth/request-access → 202 { status, message } (generic, whatever the email's state)
export async function requestGuestAccess({ email, organization, reason }) {
  return request('/api/auth/request-access', { method: 'POST', body: { email, organization, reason }, auth: false });
}

// POST /api/auth/magic-link {email} → 202 { status, message } (generic)
export async function requestMagicLink(email) {
  return request('/api/auth/magic-link', { method: 'POST', body: { email }, auth: false });
}

// POST /api/auth/logout — revokes the server-side session, then clears storage
// whatever the outcome (signing out must never fail on the client).
export async function logout() {
  const token = getToken();
  clearToken();
  if (!token) return;
  try {
    await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-Exp-Client': CLIENT_HEADER, Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort */
  }
}

// GET /api/auth/me → { status, user }
export async function fetchMe() {
  return request('/api/auth/me');
}

// GET /api/overview/summary?term=term1 → { status, data, cu, schools, access }
export async function fetchSummary(term) {
  const q = term && term !== 'all' ? `?term=${encodeURIComponent(term)}` : '';
  return request(`/api/overview/summary${q}`);
}

// GET /api/cu?cu=NAME&term=term1 → { status, data:[school rows] }
export async function fetchCU(cu, term) {
  const params = new URLSearchParams({ cu });
  if (term && term !== 'all') params.set('term', term);
  return request(`/api/cu?${params.toString()}`);
}

// ── Mentor Quality (second BigQuery source — see docs/DECISION.md ADR-008) ──
function mentorQualityQuery(term) {
  const q = term && term !== 'all' ? `?term=${encodeURIComponent(term)}` : '';
  return q;
}

// GET /api/mentor-quality/summary?term=term1 → { status, data:[region/cu/term rows] }
// One row per (region, cu, term) — for the per-term CU rankings table only.
export async function fetchMentorQualitySummary(term) {
  return request(`/api/mentor-quality/summary${mentorQualityQuery(term)}`);
}

// GET /api/mentor-quality/summary-by-cu?term=term1 → { status, data:[region/cu rows] }
// One row per (region, cu), term collapsed — use for headline KPIs / region
// rollups so an "All Terms" selection doesn't double-count mentors observed
// in more than one term.
export async function fetchMentorQualitySummaryByCu(term) {
  return request(`/api/mentor-quality/summary-by-cu${mentorQualityQuery(term)}`);
}

// GET /api/mentor-quality/sessions?term=term1 → { status, data:[session rows] }
export async function fetchMentorQualitySessions(term) {
  return request(`/api/mentor-quality/sessions${mentorQualityQuery(term)}`);
}

// GET /api/mentor-quality/questions?term=term1 → { status, data:[question rows] }
export async function fetchMentorQualityQuestions(term) {
  return request(`/api/mentor-quality/questions${mentorQualityQuery(term)}`);
}

// GET /api/mentor-quality/comments?term=term1 → { status, data:[tagged comments], theme_summary }
export async function fetchMentorQualityComments(term) {
  return request(`/api/mentor-quality/comments${mentorQualityQuery(term)}`);
}

// GET /api/mentor-quality/mentors?cu=NAME&term=term1 → { status, data:[per-mentor rows] }
// The region → CU → mentor ID drill-down.
export async function fetchMentorQualityMentors(cu, term) {
  const params = new URLSearchParams({ cu });
  if (term && term !== 'all') params.set('term', term);
  return request(`/api/mentor-quality/mentors?${params.toString()}`);
}

// GET /api/mentor-quality/mentor-observations?cu=NAME&mentor_id=ID&term=term1
// → { status, data:[per-observation rows incl. observer_name, mentor_name, comment] }
// The drill-down's leaf level: every individual observation for one mentor.
export async function fetchMentorQualityMentorObservations(cu, mentorId, term) {
  const params = new URLSearchParams({ cu, mentor_id: mentorId });
  if (term && term !== 'all') params.set('term', term);
  return request(`/api/mentor-quality/mentor-observations?${params.toString()}`);
}

// GET /api/mentor-quality/highlights?term=term1 → { status, lec, skills_day, group_mentoring, combined_theme_summary }
// National top-line rollup across all 3 Mentor Quality sources — the Highlights sub-tab.
export async function fetchMentorQualityHighlights(term) {
  return request(`/api/mentor-quality/highlights${mentorQualityQuery(term)}`);
}

// Skills Day and Group Mentoring (3rd/4th Mentor Quality sources) share the
// same shape as the LEC endpoints above (summary-by-cu / mentors / mentor-
// observations / comments) — built generically over the URL prefix.
function mentorQualitySourceApi(prefix) {
  return {
    fetchSummaryByCu: (term) => request(`/api/mentor-quality/${prefix}/summary-by-cu${mentorQualityQuery(term)}`),
    fetchMentors: (cu, term) => {
      const params = new URLSearchParams({ cu });
      if (term && term !== 'all') params.set('term', term);
      return request(`/api/mentor-quality/${prefix}/mentors?${params.toString()}`);
    },
    fetchMentorObservations: (cu, mentorId, term) => {
      const params = new URLSearchParams({ cu, mentor_id: mentorId });
      if (term && term !== 'all') params.set('term', term);
      return request(`/api/mentor-quality/${prefix}/mentor-observations?${params.toString()}`);
    },
    fetchComments: (term) => request(`/api/mentor-quality/${prefix}/comments${mentorQualityQuery(term)}`),
  };
}

const skillsDayApi = mentorQualitySourceApi('skills-day');
export const fetchSkillsDaySummaryByCu = skillsDayApi.fetchSummaryByCu;
export const fetchSkillsDayMentors = skillsDayApi.fetchMentors;
export const fetchSkillsDayMentorObservations = skillsDayApi.fetchMentorObservations;
export const fetchSkillsDayComments = skillsDayApi.fetchComments;

const groupMentoringApi = mentorQualitySourceApi('group-mentoring');
export const fetchGroupMentoringSummaryByCu = groupMentoringApi.fetchSummaryByCu;
export const fetchGroupMentoringMentors = groupMentoringApi.fetchMentors;
export const fetchGroupMentoringMentorObservations = groupMentoringApi.fetchMentorObservations;
export const fetchGroupMentoringComments = groupMentoringApi.fetchComments;

// ── E!nsight (see docs/ENSIGHT.md) ───────────────────────────────────────────
// GET /api/ensight/availability → { status, available }
export async function fetchEnsightAvailability() {
  return request('/api/ensight/availability');
}

// POST /api/ensight/ask → { status, answer, route, cached, cached_minutes_ago, sources, rows, row_count, notes }
export async function askEnsight(question, history, filters = {}, forceRefresh = false) {
  return request('/api/ensight/ask', {
    method: 'POST',
    body: {
      question,
      history: history || [],
      term: filters.term || null,
      cu: filters.cu || null,
      force_refresh: !!forceRefresh,
    },
  });
}

// POST /api/ensight/export → a binary .pptx/.docx file. Not routed through
// request() — that helper only ever parses JSON — so this uses authedFetch
// (Bearer + refresh/retry) and does its own Content-Disposition parsing (a
// plain <a href> can't attach either header). Each item must echo /ask's
// answer_sig and every SQL source's sig unchanged, or the server refuses (400).
export async function exportEnsight(format, items) {
  const res = await authedFetch('/api/ensight/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Exp-Client': CLIENT_HEADER },
    body: JSON.stringify({ format, items }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.detail || `Export failed (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob, filename: match ? match[1] : `E!nsight-Report.${format}` };
}

// ── Admin usage analytics ────────────────────────────────────────────────────
// GET /api/admin/availability → { status, available }
export async function fetchAdminAvailability() {
  return request('/api/admin/availability');
}

// GET /api/admin/analytics-summary?days=30 → { status, page_views_by_tab,
// active_users, total_sessions, avg_session_seconds,
// by_user: [{ user_email, role: 'national'|'regional'|'cu'|'other', ... }],
// role_totals: { national, regional, cu } (fixed roster sizes),
// by_week_role: [{ week_start, national: {active_users,total_users,usability_pct}, regional: {...}, cu: {...} }] }
export async function fetchAdminAnalytics(days = 30) {
  return request(`/api/admin/analytics-summary?days=${encodeURIComponent(days)}`);
}

// GET /api/admin/access/mapping → { status, regional: {region: [emails]},
// cu: {cu: [emails]}, canEdit }
export async function fetchAccessMapping() {
  return request('/api/admin/access/mapping');
}

// POST /api/admin/access/mapping — add, remove, or switch (both) an email
// under a region/CU. { scopeType, scopeKey, addEmail?, removeEmail? }
export async function updateAccessMapping({ scopeType, scopeKey, addEmail, removeEmail }) {
  return request('/api/admin/access/mapping', {
    method: 'POST',
    body: { scope_type: scopeType, scope_key: scopeKey, add_email: addEmail || null, remove_email: removeEmail || null },
  });
}

// ── Guest access administration (backend/app/routers/guests_admin.py) ──────
// GET /api/admin/guests → { status, requests, guests, whitelist, defaultDays,
// maxDays, scopes: { regional: [...], cu: [...] }, signInAvailable, canEdit }.
// Rows are snake_case: { email, status, organization, reason,
// grant: { scope_type, scope_key }, requested_at, expires_at, days_left,
// whitelisted, can_sign_in, last_login_at, active_sessions }.
export async function fetchGuests() {
  return request('/api/admin/guests');
}

// GET /api/admin/guests/audit?limit=200 → { status, events: [{ event_type,
// event_timestamp, subject_email, actor_email, ... }] }
export async function fetchGuestAudit(limit = 200) {
  return request(`/api/admin/guests/audit?limit=${encodeURIComponent(limit)}`);
}

// POST /api/admin/guests/<action> — email always in the body, never the URL.
// invite {email, scope_type, scope_key, days?, organization?} → { linkSent }
// approve {email, scope_type, scope_key, days?, whitelist} · reject {email, reason?}
// renew {email, days?} · revoke {email} · whitelist/add|remove {email}
const GUEST_ACTIONS = ['invite', 'approve', 'reject', 'renew', 'revoke', 'whitelist/add', 'whitelist/remove'];
export async function guestAction(action, body) {
  if (!GUEST_ACTIONS.includes(action)) throw new ApiError(`Unknown guest action: ${action}`, 0);
  return request(`/api/admin/guests/${action}`, { method: 'POST', body });
}

// POST /api/analytics/event — fire-and-forget usage tracking. Never throws:
// a tracking hiccup shouldn't surface as a user-visible error or block
// navigation, so failures are swallowed here rather than left to callers.
export async function trackEvent(payload) {
  try {
    await request('/api/analytics/event', { method: 'POST', body: payload });
  } catch {
    /* best-effort */
  }
}

// Same as trackEvent, but with `keepalive: true` so the request survives page
// unload/tab-hide (a plain fetch started in beforeunload/visibilitychange can
// be cancelled by the browser before it completes). Not navigator.sendBeacon:
// that can't carry the Authorization header, and putting the JWT in the URL
// instead would leak it into server access logs.
export function trackEventBeacon(payload) {
  try {
    const token = getToken();
    if (!token) return;
    fetch(`${BASE}/api/analytics/event`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Exp-Client': CLIENT_HEADER,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

// ── Issue tracking (Regional Issues / CU Priority Alerts follow-up) ─────────
// GET /api/tasks → { status, tasks: { [issue_key]: { status, timeline } } }
export async function fetchTaskStatuses() {
  return request('/api/tasks');
}

// POST /api/tasks → { status, timestamp, user_email, notes }
export async function updateTaskStatus(payload) {
  return request('/api/tasks', { method: 'POST', body: payload });
}

// ── E-Lab completion (mentor digital-lesson activity) ───────────────────────
// GET /api/elab/summary-by-cu?term=term3 → { status, term, expected_sessions,
// data: [{ region, cu, active_mentors, sessions_completed, sessions_in_progress,
// session_completion_pct (session-instance rate), mentors_fully_completed,
// mentor_completion_pct (mentors who finished ALL sessions — a different,
// stricter metric than session_completion_pct), sessions: [...], breakdowns: [...] }] }
export async function fetchElabSummaryByCu(term = 'term3') {
  return request(`/api/elab/summary-by-cu?term=${encodeURIComponent(term)}`);
}

// GET /api/mentoring-week/schools?term=term3 → { status, data: [{ school_id,
// year, term, trip1, trip2 }] } — one row per school/year/term with a
// Mentoring Week report; read live (no server cache). Term is sent the same
// way as every Mentor Quality call (omitted for All Terms); the caller
// applies the year selector to each row's year.
export async function fetchMentoringWeekSchools(term) {
  return request(`/api/mentoring-week/schools${mentorQualityQuery(term)}`);
}

// GET /api/elab/mentors?cu=NAME&term=term3 → { status, term, expected_sessions,
// data: [{ mentor_id, mentor_name, gender, role, sessions_completed,
// sessions_in_progress, completion_pct, sessions: [...] }] }
export async function fetchElabMentors(cu, term = 'term3') {
  const params = new URLSearchParams({ cu, term });
  return request(`/api/elab/mentors?${params.toString()}`);
}
