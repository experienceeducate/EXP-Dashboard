import { useCallback, useEffect, useMemo, useState } from 'react';
import { DASHBOARD_VERSION, getTermLabel } from './lib/config.js';
import * as api from './lib/api.js';
import { normalizeAccess, visibleViewTabs, defaultView, scopedRegions, scopedCUs } from './lib/access.js';
import { getTermLabelShort } from './lib/format.js';
import LoginScreen from './components/LoginScreen.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';
import DrillPanel from './components/DrillPanel.jsx';
import NationalView from './views/NationalView.jsx';
import RegionalView from './views/RegionalView.jsx';
import CuView from './views/CuView.jsx';

const VIEW_LABELS = { national: 'National View', regional: 'Regional View', cu: 'CU View' };
const TERM_ORDER = ['term1', 'term2', 'term3'];

const SSO_ERRORS = {
  domain_not_allowed: 'That Google account is not an @experienceeducate.org address.',
  no_access: 'Your account has no dashboard access configured. Contact an admin.',
  oauth_failed: 'Google sign-in failed. Please try again.',
};

// Consume the OAuth redirect fragment (#token / #error) exactly once at module
// load — before React renders. Token storage and hash-stripping are side effects
// and must NOT run inside a component render (render must stay pure; StrictMode
// double-invokes initializers, and concurrent renders can be discarded).
const INITIAL_SSO_ERROR = (() => {
  const { error } = api.consumeAuthRedirect();
  return error ? SSO_ERRORS[error] || 'Sign-in failed. Please try again.' : '';
})();

export default function App() {
  const [authed, setAuthed] = useState(() => !!api.getToken());
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState(INITIAL_SSO_ERROR);
  const [loginBusy, setLoginBusy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('Loading…');
  const [loadPct, setLoadPct] = useState(20);
  const [dataError, setDataError] = useState('');

  const [summaryData, setSummaryData] = useState([]);
  const [schoolData, setSchoolData] = useState([]);
  const [access, setAccess] = useState(null);
  const [dataSource, setDataSource] = useState('bigquery');
  const [loadedAt, setLoadedAt] = useState(null);

  const [view, setView] = useState('national');
  const [year, setYear] = useState('');
  const [term, setTerm] = useState('term1');
  const [region, setRegion] = useState('');
  const [cu, setCu] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [mentorFilter, setMentorFilter] = useState('');

  const [cuData, setCuData] = useState([]);
  const [drill, setDrill] = useState(null);

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setDataError('');
    setLoadPct(20);
    setLoadMsg('Loading programme data…');
    try {
      const res = await api.fetchSummary(); // omit term → all rows
      setLoadPct(70);
      const cuRows = res.cu || (res.data || []).filter((d) => d.level === 'cu');
      const schoolRows = res.schools || (res.data || []).filter((d) => d.level === 'school');
      setSummaryData(cuRows);
      setSchoolData(schoolRows);
      const acc = normalizeAccess(res.access || (res.user && res.user.access));
      setAccess(acc);
      setDataSource('bigquery');
      setLoadedAt(new Date());

      // Years (desc) + auto-selected term (latest term with data first).
      const years = [...new Set(cuRows.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a);
      const y = years[0] ? String(years[0]) : '';
      setYear(y);
      const termsWithData = TERM_ORDER.filter((t) => cuRows.some((d) => d.term === t && String(d.year) === y));
      setTerm(termsWithData.length > 0 ? termsWithData[termsWithData.length - 1] : 'term1');

      // Initial view + scope defaults.
      const dv = defaultView(acc);
      setView(dv);
      if (dv === 'regional') {
        setRegion(scopedRegions(acc, cuRows)[0] || '');
      } else if (dv === 'cu') {
        setCu(scopedCUs(acc, cuRows)[0] || '');
      }
      setLoadPct(100);
    } catch (e) {
      if (e.status === 401) {
        api.clearToken();
        setAuthed(false);
        return;
      }
      setDataError(e.message || 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) loadData();
  }, [authed, loadData]);

  // After a Google SSO redirect we have a token but no in-memory user object
  // (handleLogin never ran). Hydrate it from /api/auth/me.
  useEffect(() => {
    if (!authed || user) return;
    let active = true;
    api
      .fetchMe()
      .then((res) => {
        if (active && res && res.user) setUser(res.user);
      })
      .catch(() => {
        /* loadData still populates access; userEmail falls back to access.email */
      });
    return () => {
      active = false;
    };
  }, [authed, user]);

  // Fetch CU school rows when a CU is selected in CU view.
  useEffect(() => {
    let active = true;
    if (view === 'cu' && cu) {
      api
        .fetchCU(cu)
        .then((res) => {
          if (active) setCuData(res.data || []);
        })
        .catch(() => {
          if (active) setCuData([]); // fall back to schoolData filtering
        });
    } else {
      setCuData([]);
    }
    return () => {
      active = false;
    };
  }, [view, cu]);

  // ── Auth handlers ────────────────────────────────────────────────────────
  const handleLogin = async (email, password) => {
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await api.login(email, password);
      setUser(res.user || { email });
      setAuthed(true);
    } catch (e) {
      setLoginError(e.status === 401 ? 'Access denied. Please check your email and password.' : e.message);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => {
    api.clearToken();
    setAuthed(false);
    setUser(null);
    setLoginError('');
    setSummaryData([]);
    setSchoolData([]);
    setAccess(null);
  };

  const handleRefresh = () => loadData();
  const handleExport = () => window.print();

  // ── Derived options ──────────────────────────────────────────────────────
  const years = useMemo(
    () => [...new Set(summaryData.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a),
    [summaryData],
  );
  const terms = useMemo(
    () => TERM_ORDER.filter((t) => summaryData.some((d) => d.term === t && String(d.year) === String(year))),
    [summaryData, year],
  );
  const regionOptions = useMemo(() => (access ? scopedRegions(access, summaryData) : []), [access, summaryData]);
  const cuOptions = useMemo(() => (access ? scopedCUs(access, summaryData, view === 'cu' ? '' : region) : []), [access, summaryData, region, view]);
  const tabs = useMemo(() => (access ? visibleViewTabs(access) : []), [access]);

  // School/Mentor filter options — every distinct name on record for the
  // selected CU/year (not term-scoped, so switching term doesn't make the
  // currently-selected filter value disappear from its own dropdown).
  const cuSchoolRows = useMemo(
    () => (view === 'cu' && cu ? schoolData.filter((d) => String(d.year) == year && String(d.cu || '').toLowerCase() === String(cu).toLowerCase()) : []),
    [schoolData, year, cu, view],
  );
  const schoolOptions = useMemo(
    () => [...new Set(cuSchoolRows.map((d) => d.school_name).filter(Boolean))].sort(),
    [cuSchoolRows],
  );
  const mentorOptions = useMemo(
    () => [...new Set(cuSchoolRows.map((d) => d.mentor_name).filter(Boolean))].sort(),
    [cuSchoolRows],
  );

  const userEmail = (user && user.email) || (access && access.email) || '';

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        error={loginError}
        busy={loginBusy}
        onDismissError={() => setLoginError('')}
      />
    );
  }

  if (loading && summaryData.length === 0) {
    return <LoadingOverlay progress={loadPct} message={loadMsg} />;
  }

  const headerSubtitle = `${VIEW_LABELS[view] || ''} · ${year} ${getTermLabelShort(term)}`;

  return (
    <div>
      {loading ? <LoadingOverlay progress={loadPct} message={loadMsg} /> : null}
      <header className="header">
        <div className="header-top">
          <div className="header-left">
            <h1>EXP Programme Monitoring Dashboard</h1>
            <p>{headerSubtitle}</p>
          </div>
          <div className="header-right">
            {view !== 'cu' ? (
              <select className="header-select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            ) : null}
            <select className="header-select" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
              {terms.map((t) => (
                <option key={t} value={t}>{getTermLabel(t)}</option>
              ))}
              <option value="all">All Terms</option>
            </select>
            {(view === 'national' || view === 'regional') && regionOptions.length > 0 ? (
              <select
                className="header-select"
                value={view === 'regional' ? region : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) { setView('regional'); setRegion(val); } else { setView('national'); setRegion(''); }
                }}
                aria-label="Region"
              >
                {access && access.hasNational ? <option value="">🌍 National Overview</option> : null}
                {regionOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            ) : null}
            {view === 'cu' ? (
              <>
                <select className="header-select" value={cu} onChange={(e) => { setCu(e.target.value); setSchoolFilter(''); setMentorFilter(''); }} aria-label="Cluster Unit">
                  <option value="">All CUs…</option>
                  {cuOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {cu ? (
                  <>
                    <select className="header-select" value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)} aria-label="School">
                      <option value="">All schools…</option>
                      {schoolOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <select className="header-select" value={mentorFilter} onChange={(e) => setMentorFilter(e.target.value)} aria-label="Mentor">
                      <option value="">All mentors…</option>
                      {mentorOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {(schoolFilter || mentorFilter) ? (
                      <button className="header-clear-btn" onClick={() => { setSchoolFilter(''); setMentorFilter(''); }}>✕ Clear all</button>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            <span id="userInfo">{userEmail}</span>
            <button className="btn" onClick={handleExport}>⬇ Export</button>
            <button className="btn" onClick={handleRefresh} title="Refresh">🔄</button>
            <button className="btn primary" onClick={handleLogout}>Logout</button>
          </div>
        </div>
        <nav className="view-tabs">
          {tabs.map((t) => (
            <button key={t} className={`view-tab ${view === t ? 'active' : ''}`} onClick={() => setView(t)}>
              {VIEW_LABELS[t]}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {dataError ? <div className="login-error" style={{ maxWidth: 600 }}>{dataError}</div> : null}
        {view === 'national' ? (
          <NationalView summaryData={summaryData} schoolData={schoolData} year={year} term={term} onDrill={setDrill} />
        ) : null}
        {view === 'regional' ? (
          <RegionalView
            summaryData={summaryData}
            schoolData={schoolData}
            year={year}
            term={term}
            region={region}
            onSelectCU={(name) => { setView('cu'); setCu(name); }}
            onDrill={setDrill}
          />
        ) : null}
        {view === 'cu' ? (
          <CuView
            schoolData={schoolData}
            cuData={cuData}
            year={year}
            term={term}
            cu={cu}
            allowedCUs={cuOptions}
            schoolFilter={schoolFilter}
            mentorFilter={mentorFilter}
            onSelectCU={(name) => setCu(name)}
          />
        ) : null}
      </main>

      {drill ? (
        <DrillPanel drill={drill} summaryData={summaryData} schoolData={schoolData} year={year} term={term} onClose={() => setDrill(null)} />
      ) : null}

      <div className="debug-pill">
        <span>{dataSource === 'bigquery' ? '🗄 Live' : '🎭 Demo'}</span>
        <span>·</span>
        <span>EXP {DASHBOARD_VERSION}</span>
        {loadedAt ? <span>· Data as of {loadedAt.toLocaleTimeString()}</span> : null}
      </div>
    </div>
  );
}
