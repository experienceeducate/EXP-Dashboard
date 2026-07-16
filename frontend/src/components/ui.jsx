// Small reusable presentational components shared across views.
import { ragColor } from '../lib/format.js';

export function Section({ title, subtitle, children, id }) {
  return (
    <div className="section" id={id}>
      <div className="section-header">
        <div>
          <div className="section-title">{title}</div>
          {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export function ScoreCard({ tone = 'blue', label, value, unit, subtext, onClick }) {
  return (
    <div className={`score-card ${tone}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="score-card-label">{label}</div>
      <div className="score-card-value">
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="score-card-subtext">{subtext}</div>
    </div>
  );
}

export function KpiHeroCard({ label, valueClass, value, unit, trend, sub, drill, onClick }) {
  return (
    <button className="kpi-hero-card" onClick={onClick} type="button">
      <div className="kpi-hero-label">{label}</div>
      <div className={`kpi-hero-val ${valueClass || ''}`}>
        {value}
        {unit ? <span style={{ fontSize: '1.1rem', fontWeight: 400, opacity: 0.7 }}>{unit}</span> : null}
      </div>
      {trend ? <div className="kpi-hero-trend">{trend}</div> : null}
      {sub ? <div className="kpi-hero-sub">{sub}</div> : null}
      {drill ? <div className="kpi-hero-drill">{drill}</div> : null}
    </button>
  );
}

export function MetricTile({ label, value, valueSuffix, status, statusLabel, pct, fill, diag, onClick, dark }) {
  return (
    <button
      className="metric-tile"
      onClick={onClick}
      type="button"
      style={dark ? { background: 'var(--educate-navy)', borderColor: 'var(--educate-navy)' } : undefined}
    >
      <div className="mt-label" style={dark ? { color: '#9BB5C4' } : undefined}>
        {label}
      </div>
      <div className="mt-val" style={dark ? { color: '#fff' } : undefined}>
        {value}
        {valueSuffix ? <span style={{ fontSize: '.75rem', fontWeight: 400, color: dark ? 'rgba(255,255,255,.6)' : '#888' }}> {valueSuffix}</span> : null}
      </div>
      {status ? (
        <div className="mt-status-row">
          <span className={`mt-badge ${status}`}>{statusLabel}</span>
          {pct != null ? <span style={{ fontSize: '.75rem', color: '#888' }}>{pct}%</span> : null}
        </div>
      ) : null}
      <div className="mt-bar-track" style={dark ? { background: 'rgba(255,255,255,.15)' } : undefined}>
        <div className="mt-bar-fill" style={{ width: `${Math.min(pct || 0, 100)}%`, background: fill }} />
      </div>
      {diag ? (
        <div className="mt-diag" style={dark ? { color: '#C5D1DE' } : undefined}>
          {diag}
        </div>
      ) : null}
    </button>
  );
}

// Progress bar cell used inside breakdown tables.
export function ProgressCell({ pct, color, minWidth = 130 }) {
  const col = color || ragColor(pct);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth }}>
      <div style={{ flex: 1, height: 10, background: '#e9ecef', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: col, borderRadius: 5 }} />
      </div>
      <span style={{ fontWeight: 700, color: col, fontSize: '.85rem', minWidth: 36 }}>{pct}%</span>
    </div>
  );
}

// Stacked rating bar (PB quality / timeliness). `segments` = [{color,pct,label}]
export function StackedBar({ segments, height = 14, minWidth = 80, track = '#e9ecef' }) {
  if (!segments || segments.length === 0) {
    return <span style={{ color: '#aaa', fontSize: '.8rem' }}>No data</span>;
  }
  return (
    <div style={{ height, borderRadius: 6, overflow: 'hidden', display: 'flex', minWidth, background: track }}>
      {segments.map((s, i) => (
        <div key={i} title={`${s.label}: ${s.pct}%`} style={{ width: `${s.pct}%`, background: s.color, height: '100%' }} />
      ))}
    </div>
  );
}

export function Tag({ tag }) {
  return (
    <span
      style={{
        background: tag.bg,
        color: tag.fg,
        padding: '.15rem .4rem',
        borderRadius: 4,
        fontSize: '.75rem',
        fontWeight: 600,
      }}
    >
      {tag.text}
    </span>
  );
}

export function Placeholder({ label }) {
  return <div className="placeholder">{label || 'Coming soon'}</div>;
}
