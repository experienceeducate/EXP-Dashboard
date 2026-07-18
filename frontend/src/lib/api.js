// ─────────────────────────────────────────────────────────────────────────────
// Data layer against the NEW FastAPI backend.
// Every /api request sends X-Exp-Client: dashboard-v1 and (except login) a Bearer
// token. JWT is stored in sessionStorage. On 401 the token is cleared.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'exp_token';
const CLIENT_HEADER = 'dashboard-v1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  setToken(null);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'X-Exp-Client': CLIENT_HEADER };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(`Network error: ${e.message}`, 0);
  }

  if (res.status === 401) {
    clearToken();
    throw new ApiError('Unauthorized', 401);
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

// Full URL that kicks off the Google SSO flow. The backend redirects the browser
// to Google and, on success, back to FRONTEND_URL/#token=<jwt>. We navigate the
// whole window here (not fetch) so the browser follows the OAuth redirects.
export function googleLoginUrl() {
  return `${BASE}/api/auth/google/login`;
}

// Consume the auth fragment the OAuth callback leaves in the URL
// (FRONTEND_URL/#token=<jwt> or /#error=<msg>). Stores the token, strips the hash
// so it can't be re-consumed or leak into history, and returns what it found.
// Call once at startup, before the first render decides auth state.
export function consumeAuthRedirect() {
  let hash = '';
  try {
    hash = window.location.hash || '';
  } catch {
    return {};
  }
  if (!hash || hash.length < 2) return {};
  const params = new URLSearchParams(hash.slice(1)); // drop leading '#'
  const token = params.get('token');
  const error = params.get('error');
  if (!token && !error) return {};

  // Strip the fragment without adding a history entry.
  try {
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);
  } catch {
    /* ignore */
  }

  if (token) {
    setToken(token);
    return { token };
  }
  return { error };
}

// POST /api/auth/login → { status:"ok", token, user }
export async function login(email, password) {
  const json = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  if (json.token) setToken(json.token);
  return json;
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
