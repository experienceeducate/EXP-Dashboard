// Small reusable presentational components shared across views.
import { ragColor } from '../lib/format.js';
import { C } from '../lib/config.js';

// LEC × Week delivery heatmap (#schools per cell). Shared by National + Regional.
// `matrix` = { lecN: { 'Wk n': count } } (see metrics.buildLecWeekMatrix).
export function LecWeekHeatmap({ matrix, lecNums, totalSchools, emptyLabel, onCellClick }) {
  const weeks = [...new Set(lecNums.flatMap((n) => Object.keys(matrix[`lec${n}`] || {})))].sort(
    (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0),
  );
  const allVals = lecNums.flatMap((n) => Object.values(matrix[`lec${n}`] || {}));
  const globalMax = Math.max(...allVals, 1);
  if (weeks.length === 0) {
    return <Placeholder label={emptyLabel || 'No LEC delivery data yet for this term.'} />;
  }
  return (
    <div className="table-wrap">
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.85rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '.5rem .75rem', background: '#f8f9fa', fontWeight: 700, color: C.navy }}>LEC</th>
            {weeks.map((w) => (
              <th key={w} style={{ minWidth: 56, textAlign: 'center', padding: '.4rem .25rem', fontSize: '.72rem', color: '#555', background: '#f8f9fa' }}>{w}</th>
            ))}
            {totalSchools != null ? (
              <th style={{ minWidth: 70, textAlign: 'center', padding: '.4rem .5rem', background: '#f8f9fa', fontWeight: 700, color: C.navy }}>Total</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lecNums.map((n) => {
            const lecData = matrix[`lec${n}`] || {};
            const lecTotal = Object.values(lecData).reduce((s, v) => s + v, 0);
            const pctDel = totalSchools > 0 ? Math.round((lecTotal / totalSchools) * 100) : 0;
            return (
              <tr key={n} style={{ borderBottom: '1px solid #e9ecef' }}>
                <th style={{ textAlign: 'left', padding: '.45rem .75rem', fontWeight: 700, color: C.navy, background: '#fafbff' }}>LEC {n}</th>
                {weeks.map((w) => {
                  const count = lecData[w] || 0;
                  const intensity = count ? Math.max(0.12, (count / globalMax) * 0.85 + 0.1) : 0;
                  const bg = count ? `rgba(13,71,161,${intensity.toFixed(2)})` : '#f8f9fa';
                  const fg = count / globalMax > 0.55 ? '#fff' : '#0d47a1';
                  const clickable = !!onCellClick && count > 0;
                  return (
                    <td key={w} style={{ padding: 3 }}>
                      <div
                        onClick={clickable ? () => onCellClick(n, w, count) : undefined}
                        title={clickable ? `Click to see schools that delivered LEC ${n} in ${w}` : undefined}
                        style={{
                          background: bg, borderRadius: 5, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: clickable ? 'pointer' : undefined, transition: 'opacity .15s',
                        }}
                        onMouseOver={clickable ? (e) => { e.currentTarget.style.opacity = '.75'; } : undefined}
                        onMouseOut={clickable ? (e) => { e.currentTarget.style.opacity = '1'; } : undefined}
                      >
                        <span style={{ fontWeight: 700, fontSize: '.85rem', color: fg }}>{count > 0 ? count : ''}</span>
                      </div>
                    </td>
                  );
                })}
                {totalSchools != null ? (
                  <td style={{ padding: '.45rem .5rem', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, color: pctDel >= 80 ? C.green : pctDel >= 50 ? C.blue : '#aaa' }}>{lecTotal > 0 ? lecTotal : '—'}</div>
                    <div style={{ fontSize: '.7rem', color: '#888' }}>{lecTotal > 0 ? `${pctDel}%` : ''}</div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
