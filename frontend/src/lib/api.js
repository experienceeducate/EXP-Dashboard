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
