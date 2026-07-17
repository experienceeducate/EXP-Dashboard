import { useState } from 'react';
import { googleLoginUrl } from '../lib/api.js';

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

// Primary sign-in is Google SSO. The email+password form is kept as a hidden
// break-glass fallback (local dev, non-domain accounts) — revealed by a link.
export default function LoginScreen({ onLogin, error, busy }) {
  const [showFallback, setShowFallback] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onLogin(email.trim().toLowerCase(), password);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="brand">EXP Dashboard</div>
          <div className="sub">Educate! Program Monitoring</div>
        </div>

        {error ? <div className="login-error">{error}</div> : null}

        {!showFallback ? (
          <>
            <button
              className="login-google"
              type="button"
              disabled={busy}
              onClick={() => {
                window.location.href = googleLoginUrl();
              }}
            >
              <GoogleMark />
              {busy ? 'Signing in…' : 'Sign in with Google'}
            </button>
            <div className="login-info">
              Sign in with your <strong>@experienceeducate.org</strong> Google account. Your access
              level (National, Regional, or CU) is determined automatically from your role.
            </div>
            <button
              className="login-fallback-link"
              type="button"
              onClick={() => setShowFallback(true)}
            >
              Sign in with a password instead
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <input
              className="login-field"
              type="email"
              required
              placeholder="yourname@experienceeducate.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <input
              className="login-field"
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="login-btn" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Access Dashboard'}
            </button>
            <button
              className="login-fallback-link"
              type="button"
              onClick={() => setShowFallback(false)}
            >
              Back to Google sign-in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
