import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';

// Google's "G" mark, inlined so it renders without an external asset request
// (CSP / offline safe).
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function errorText(e) {
  if (e && e.status === 429) return e.message || 'Too many requests. Please wait a few minutes and try again.';
  return (e && e.message) || 'Something went wrong. Please try again.';
}

// Guest: ask for access (an access manager approves + whitelists the email).
function RequestAccessForm({ onBack }) {
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.requestGuestAccess({ email: email.trim(), organization: organization.trim(), reason: reason.trim() });
      setMessage((res && res.message) || 'Thanks — if your request can be considered, an access manager will be in touch.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h3 style={{ margin: '0 0 .75rem', fontSize: '1rem' }}>Request guest access</h3>
      {error ? <div className="login-error">{error}</div> : null}
      {message ? (
        <div className="login-info" style={{ marginTop: 0 }}>{message}</div>
      ) : (
        <>
          <input className="login-field" type="email" required maxLength={254} placeholder="Your email address"
            value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input className="login-field" type="text" required maxLength={200} placeholder="Organisation"
            value={organization} onChange={(e) => setOrganization(e.target.value)} autoComplete="organization" />
          <textarea className="login-field" required maxLength={1000} rows={3} placeholder="Why do you need access?"
            value={reason} onChange={(e) => setReason(e.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Request access'}
          </button>
        </>
      )}
      <button className="login-link" type="button" onClick={onBack}>Back to sign-in</button>
    </form>
  );
}

// Guest: email me a single-use sign-in link.
function MagicLinkForm({ onBack }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.requestMagicLink(email.trim());
      setMessage((res && res.message) || 'If that email has guest access, a sign-in link is on its way.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h3 style={{ margin: '0 0 .75rem', fontSize: '1rem' }}>Email me a sign-in link</h3>
      {error ? <div className="login-error">{error}</div> : null}
      {message ? (
        <div className="login-info" style={{ marginTop: 0 }}>{message}</div>
      ) : (
        <>
          <input className="login-field" type="email" required maxLength={254} placeholder="Your approved guest email"
            value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send sign-in link'}
          </button>
          <div className="login-info">
            Links work once and expire after 15 minutes.
          </div>
        </>
      )}
      <button className="login-link" type="button" onClick={onBack}>Back to sign-in</button>
    </form>
  );
}

// Landing card for a guest's emailed link. The token is held in memory only and
// is redeemed ONLY when the guest presses "Sign in" — never on page load, since
// email security scanners prefetch links and would burn the single-use token.
function MagicLanding({ busy, error, onRedeem, onRequestNew }) {
  return (
    <>
      <h3 style={{ margin: '0 0 .75rem', fontSize: '1.05rem', textAlign: 'center' }}>Sign in to EXP Programme Dashboard</h3>
      {error ? <div className="login-error">{error}</div> : null}
      {!error ? (
        <button className="login-btn" type="button" disabled={busy} onClick={onRedeem}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      ) : null}
      <button className="login-link" type="button" onClick={onRequestNew}>
        {error ? 'Request a new sign-in link' : 'Not you? Back to sign-in'}
      </button>
    </>
  );
}

// Staff sign in with Google; guests (partners, personal addresses) request
// access and then sign in with a single-use emailed link. There is no shared
// password. /api/auth/config says which options are available.
export default function LoginScreen({ error, busy, onDismissError, magicToken, onRedeemMagic, onDiscardMagic }) {
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('main'); // 'main' | 'request' | 'link'
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .fetchAuthConfig()
      .then((res) => {
        if (active) setConfig({ google: !!res.google, guest: !!res.guest_sign_in_available });
      })
      .catch(() => {
        // Config unreachable: still offer Google (the backend answers 503 if
        // it really isn't configured), hide the guest options.
        if (active) setConfig({ google: true, guest: false });
      });
    return () => {
      active = false;
    };
  }, []);

  const go = (next) => {
    if (onDismissError) onDismissError();
    setMode(next);
  };

  let body;
  if (magicToken) {
    body = (
      <MagicLanding
        busy={busy}
        error={error}
        onRedeem={onRedeemMagic}
        onRequestNew={() => {
          onDiscardMagic();
          setMode(error ? 'link' : 'main');
        }}
      />
    );
  } else if (mode === 'request') {
    body = <RequestAccessForm onBack={() => go('main')} />;
  } else if (mode === 'link') {
    body = <MagicLinkForm onBack={() => go('main')} />;
  } else {
    body = (
      <>
        {error ? <div className="login-error">{error}</div> : null}
        {!config ? (
          <div className="login-info" style={{ marginTop: 0, textAlign: 'center' }}>Loading sign-in options…</div>
        ) : null}
        {config && config.google ? (
          <>
            <button
              className="login-google"
              type="button"
              disabled={busy || redirecting}
              onClick={() => {
                setRedirecting(true);
                window.location.href = api.googleLoginUrl();
              }}
            >
              <GoogleMark />
              {busy ? 'Signing in…' : redirecting ? 'Redirecting…' : 'Sign in with Google'}
            </button>
            <div className="login-info">
              Educate! staff: sign in with your <strong>@experienceeducate.org</strong> Google account. Your access
              level (National, Regional, or CU) is determined automatically from your role.
            </div>
          </>
        ) : null}
        {config && !config.google ? (
          <div className="login-info" style={{ marginTop: 0 }}>Google sign-in is not configured on this server.</div>
        ) : null}
        {config && config.guest ? (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #eee', paddingTop: '.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '.8rem', color: '#666' }}>Not on an Educate! Google account?</div>
            <button className="login-link" type="button" onClick={() => go('link')} style={{ marginTop: '.5rem' }}>
              Email me a sign-in link
            </button>
            <button className="login-link" type="button" onClick={() => go('request')} style={{ marginTop: '.35rem' }}>
              Request guest access
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="brand">EXP Dashboard</div>
          <div className="sub">Educate! Program Monitoring</div>
        </div>
        {body}
      </div>
    </div>
  );
}
