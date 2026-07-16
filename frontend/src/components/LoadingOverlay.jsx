import { DASHBOARD_VERSION } from '../lib/config.js';

export default function LoadingOverlay({ progress = 30, message = 'Loading…' }) {
  return (
    <div className="loading-overlay">
      <div style={{ fontSize: '2rem', fontWeight: 800 }}>Educate!</div>
      <div style={{ fontSize: '.95rem', opacity: 0.9, marginTop: '.25rem' }}>
        EXP Programme Dashboard {DASHBOARD_VERSION}
      </div>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div style={{ fontSize: '.8rem', opacity: 0.85 }}>{message}</div>
    </div>
  );
}
