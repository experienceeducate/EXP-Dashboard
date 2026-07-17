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
