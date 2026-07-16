import { useState } from 'react';

// Login screen. Unlike the legacy email-only login, the new backend requires
// BOTH email and a (shared) password (spec: NEW backend API contract).
export default function LoginScreen({ onLogin, error, busy }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onLogin(email.trim().toLowerCase(), password);
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <div className="brand">EXP Dashboard</div>
          <div className="sub">Educate! Program Monitoring</div>
        </div>
        {error ? <div className="login-error">{error}</div> : null}
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
        <div className="login-info">
          Enter your email address and password to access the dashboard. Your access level will be
          determined based on your role and region.
        </div>
      </form>
    </div>
  );
}
