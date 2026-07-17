// Global stylesheet (class-based reusable styles) ported from the legacy app.
// Kept as a JS string (not a .css file) and injected once at startup. Dynamic /
// per-element styling is done with inline styles in the components.
export const GLOBAL_CSS = `
:root {
  --educate-red:#870101; --educate-blue:#0F6A8C; --educate-yellow:#F1A01B;
  --educate-grey:#666666; --educate-green:#008148; --educate-navy:#0e313e;
  --educate-red-light:#A03434; --educate-blue-light:#4D889D;
  --educate-yellow-light:#f4b14d; --educate-green-light:#4F9262;
  --bg-light:#f5f7fa; --white:#ffffff; --border:#e5e9ed;
  --text-dark:#2c3e50; --text-muted:#95a5a6;
}
* { box-sizing:border-box; }
body { margin:0; font-family:'Inter',system-ui,-apple-system,sans-serif; background:var(--bg-light); color:var(--text-dark); }

/* Header */
.header { background:var(--educate-navy); color:#fff; }
.header-top { display:flex; justify-content:space-between; align-items:center; padding:.7rem 2rem; gap:1rem; flex-wrap:wrap; }
.header-left h1 { margin:0; font-size:1.15rem; font-weight:700; }
.header-left p { margin:.1rem 0 0; color:#B8C7D6; font-size:.75rem; }
.header-right { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }
.header-select, .header-input {
  background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2);
  color:#fff; border-radius:6px; min-width:80px; padding:.4rem .6rem; font-size:.85rem;
}
.header-input::placeholder { color:rgba(255,255,255,.55); }
.header-select option { background:#0e313e; color:#fff; }
.header-clear-btn { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.2); color:#fff; border-radius:6px; padding:.4rem .6rem; cursor:pointer; font-size:.8rem; }
.header-clear-btn:hover { background:rgba(255,255,255,.1); }
.header-input-wrap { position:relative; display:inline-flex; align-items:center; }
.header-input-wrap .header-input { padding-right:1.9rem; }
.header-input-clear {
  position:absolute; right:.3rem; top:50%; transform:translateY(-50%);
  background:none; border:none; color:rgba(255,255,255,.65); cursor:pointer;
  font-size:.85rem; line-height:1; padding:.3rem; border-radius:4px;
}
.header-input-clear:hover { color:#fff; background:rgba(255,255,255,.15); }

/* Mobile: full-width stacked filters + 16px inputs (prevents iOS Safari's
   auto-zoom-on-focus, which otherwise fires on any input font-size <16px). */
@media (max-width:640px) {
  .header-top { padding:.6rem 1rem; }
  .header-right { width:100%; }
  .header-select, .header-input-wrap, .header-input-wrap .header-input {
    width:100%;
  }
  .header-select, .header-input {
    font-size:1rem; padding:.55rem .7rem; min-height:2.6rem;
  }
  .header-clear-btn { width:100%; padding:.55rem .7rem; }
}
#userInfo { color:#B8C7D6; font-size:.8rem; padding:0 .4rem; }
.btn { border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.1); color:#fff; border-radius:6px; padding:.4rem .8rem; cursor:pointer; font-size:.82rem; font-weight:600; }
.btn:hover { background:rgba(255,255,255,.2); }
.btn.primary { background:var(--educate-red); border-color:var(--educate-red); }

/* View tabs */
.view-tabs { background:#0e313e; padding:0 2rem; display:flex; gap:0; border-bottom:1px solid rgba(255,255,255,.1); }
.view-tab { padding:.55rem 1.4rem; background:none; border:none; color:rgba(255,255,255,.55); font-weight:600; cursor:pointer; font-size:.82rem; border-bottom:2px solid transparent; transition:all .15s; }
.view-tab:hover { color:rgba(255,255,255,.85); background:rgba(255,255,255,.06); }
.view-tab.active { color:#fff; border-bottom-color:#E6C474; background:rgba(255,255,255,.05); }

/* National inner tabs */
.nat-tab-bar { display:flex; gap:4px; background:#fff; border-bottom:2px solid #e9ecef; padding:0 1.5rem; margin-bottom:1.25rem; flex-wrap:wrap; border-radius:8px 8px 0 0; }
.nat-tab-btn { padding:.65rem 1.1rem; background:none; border:none; border-bottom:3px solid transparent; margin-bottom:-2px; font-size:.85rem; font-weight:600; color:#666; cursor:pointer; white-space:nowrap; transition:all .15s; }
.nat-tab-btn:hover { color:var(--educate-navy); background:#f8f9fa; }
.nat-tab-btn.active { color:var(--educate-navy); border-bottom-color:var(--educate-navy); background:#f0f4ff; border-radius:4px 4px 0 0; }

/* Content */
.content { padding:2rem 3rem; max-width:1800px; margin:0 auto; }
@media (max-width:900px){ .content { padding:1.25rem 1rem; } }

/* Sections */
.section { background:#fff; padding:2rem; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08); margin-bottom:2rem; }
.section-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem; padding-bottom:.75rem; border-bottom:2px solid var(--border); }
.section-title { font-size:1.3rem; font-weight:800; color:var(--educate-navy); letter-spacing:-.5px; }
.section-subtitle { font-size:.85rem; color:var(--text-muted); margin-top:.3rem; font-weight:400; }

/* Score cards */
.score-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1.5rem; margin-bottom:2rem; }
.score-card { background:#fff; padding:2rem; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08); border-top:4px solid var(--educate-blue); transition:all .3s; }
.score-card:hover { transform:translateY(-4px); box-shadow:0 8px 20px rgba(0,0,0,.12); }
.score-card-label { font-size:.8rem; text-transform:uppercase; letter-spacing:.5px; color:var(--educate-navy); font-weight:700; margin-bottom:.75rem; }
.score-card-value { font-size:3rem; font-weight:800; color:var(--educate-navy); line-height:1; letter-spacing:-1px; margin-bottom:.5rem; }
.score-card-value .unit { font-size:1.5rem; color:var(--text-muted); font-weight:600; }
.score-card-subtext { font-size:.85rem; color:#555; }
.score-card.red { border-top-color:var(--educate-red); }
.score-card.green { border-top-color:var(--educate-green); }
.score-card.yellow { border-top-color:var(--educate-yellow); }
.score-card.blue { border-top-color:var(--educate-blue); }

/* KPI hero cards */
.kpi-hero-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(185px,1fr)); gap:12px; margin-bottom:1.5rem; max-width:1100px; }
.kpi-hero-card { background:#0e313e; color:#fff; border-radius:12px; padding:16px 16px 12px; display:flex; flex-direction:column; gap:4px; min-height:148px; position:relative; cursor:pointer; transition:transform .12s,box-shadow .12s; border:none; text-align:left; width:100%; font-family:inherit; }
.kpi-hero-card:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(0,0,0,.22); }
.kpi-hero-label { font-size:11px; color:#B8CCDA; text-transform:uppercase; letter-spacing:.5px; font-weight:700; line-height:1.3; }
.kpi-hero-val { font-size:36px; font-weight:800; line-height:1.05; letter-spacing:-1px; font-variant-numeric:tabular-nums; margin:2px 0; }
.kpi-hero-val.kpi-green { color:#8FD48A; }
.kpi-hero-val.kpi-amber { color:#E6C474; }
.kpi-hero-val.kpi-red { color:#F4A8A0; }
.kpi-hero-val.kpi-blue { color:#90CAF9; }
.kpi-hero-trend { font-size:11.5px; color:#C8DCE8; font-weight:500; line-height:1.4; }
.kpi-hero-sub { font-size:11.5px; color:#C8DCE8; line-height:1.5; margin-top:auto; padding-top:4px; }
.kpi-hero-sub strong { color:#fff; font-weight:700; }
.kpi-hero-drill { font-size:10px; color:#7AAFC4; font-weight:500; margin-top:6px; display:flex; align-items:center; gap:3px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px; }

/* Metric tiles */
.metric-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:1.25rem; }
.metric-tile { background:#fff; border:1px solid #e9ecef; border-radius:10px; padding:16px 16px 14px; display:flex; flex-direction:column; gap:8px; cursor:pointer; transition:transform .1s,box-shadow .1s; text-align:left; width:100%; font-family:inherit; }
.metric-tile:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.06); }
.mt-label { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
.mt-val { font-size:26px; font-weight:700; color:#1a1a2e; line-height:1; font-variant-numeric:tabular-nums; }
.mt-status-row { display:flex; align-items:center; gap:8px; }
.mt-badge { font-size:10px; padding:2px 8px; border-radius:999px; font-weight:600; border:1px solid; }
.mt-badge.on { background:#f1f7f1; border-color:#b8d4b8; color:#3b6b3b; }
.mt-badge.near { background:#fbf1dd; border-color:#e6d4a8; color:#7a5b1f; }
.mt-badge.off { background:#fcf3f1; border-color:#e8b8b0; color:#7a2e26; }
.mt-bar-track { background:#eee; height:6px; border-radius:3px; overflow:hidden; }
.mt-bar-fill { height:100%; border-radius:3px; transition:width .3s; }
.mt-diag { font-size:11px; color:#555; line-height:1.5; border-top:1px dashed #eee; padding-top:8px; margin-top:2px; }
.mt-diag strong { color:#1a1a2e; }

/* Key takeaways */
.key-takeaways-strip { background:#eef5ed; border:1px solid #c6ddc0; border-radius:10px; padding:16px 18px; margin-bottom:1.5rem; }
.kt-strip-label { font-size:10px; color:#3b6b3b; text-transform:uppercase; letter-spacing:.5px; font-weight:700; margin-bottom:10px; }
.kt-strip-list { display:flex; flex-direction:column; gap:8px; }
.kt-strip-item { display:flex; gap:10px; align-items:flex-start; font-size:.85rem; color:#2e2e2e; line-height:1.55; }
.kt-strip-bar { width:3px; background:#2e7d5a; align-self:stretch; border-radius:2px; flex-shrink:0; margin-top:3px; }
.kt-strip-bar.amber { background:#C38A1F; }
.kt-strip-bar.red { background:#C9554A; }

/* Tables */
.table-wrap { overflow-x:auto; }
.breakdown-table { width:100%; border-collapse:separate; border-spacing:0; font-size:.9rem; }
.breakdown-table thead th { background:linear-gradient(135deg,#f8f9fa 0%,#e9ecef 100%); padding:.875rem .75rem; text-align:left; font-weight:700; color:var(--educate-grey); font-size:.75rem; text-transform:uppercase; letter-spacing:.5px; border-bottom:2px solid var(--educate-navy); white-space:nowrap; }
.breakdown-table thead th.center { text-align:center; }
.breakdown-table tbody td { padding:1rem .75rem; border-bottom:1px solid var(--border); }
.breakdown-table tbody td.center { text-align:center; }
.breakdown-table tbody tr.clickable { cursor:pointer; transition:all .2s; }
.breakdown-table tbody tr.clickable:hover { background:linear-gradient(90deg,#f0f8ff 0%,#fff 100%); }
.item-name { font-weight:700; color:var(--educate-navy); font-size:1rem; }

/* Login */
.login-screen { min-height:100vh; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#870101 0%,#0e313e 100%); padding:1rem; }
.login-card { background:#fff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.3); padding:2.5rem; width:100%; max-width:420px; }
.login-logo { text-align:center; margin-bottom:1.5rem; }
.login-logo .brand { font-size:1.6rem; font-weight:800; color:var(--educate-red); }
.login-logo .sub { color:var(--educate-grey); font-size:.85rem; margin-top:.25rem; }
.login-field { width:100%; padding:.7rem .9rem; border:1px solid var(--border); border-radius:8px; font-size:.95rem; margin-bottom:.9rem; }
.login-btn { width:100%; padding:.8rem; background:var(--educate-red); color:#fff; border:none; border-radius:8px; font-size:1rem; font-weight:700; cursor:pointer; }
.login-btn:disabled { opacity:.6; cursor:default; }
.login-google { width:100%; padding:.75rem; display:flex; align-items:center; justify-content:center; gap:.6rem; background:#fff; color:#3c4043; border:1px solid #dadce0; border-radius:8px; font-size:.95rem; font-weight:600; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.06); }
.login-google:hover { background:#f7f8f8; box-shadow:0 1px 3px rgba(0,0,0,.12); }
.login-google:disabled { opacity:.6; cursor:default; }
.login-google svg { width:18px; height:18px; flex:none; }
.login-fallback-link { display:block; margin:1rem auto 0; background:none; border:none; color:var(--educate-grey); font-size:.78rem; text-decoration:underline; cursor:pointer; }
.login-info { margin-top:1.25rem; background:#f0f4f8; border-radius:8px; padding:.85rem; font-size:.78rem; color:#555; line-height:1.5; }
.login-error { background:#fcf3f1; border:1px solid #e8b8b0; color:#7a2e26; border-radius:8px; padding:.7rem; font-size:.85rem; margin-bottom:.9rem; }

/* Loading overlay */
.loading-overlay { position:fixed; inset:0; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(135deg,#870101 0%,#0e313e 100%); color:#fff; }
.loading-bar-track { width:280px; height:8px; background:rgba(255,255,255,.2); border-radius:4px; overflow:hidden; margin:1.25rem 0 .5rem; }
.loading-bar-fill { height:100%; background:#E6C474; border-radius:4px; transition:width .3s; }
@keyframes spin { to { transform:rotate(360deg); } }
.spinner { width:36px; height:36px; border:4px solid rgba(255,255,255,.25); border-top-color:#fff; border-radius:50%; animation:spin .8s linear infinite; }

/* Drill panel */
.drill-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:1000; }
.drill-panel { position:fixed; top:0; right:0; height:100vh; width:580px; max-width:96vw; background:#fff; z-index:1001; box-shadow:-8px 0 30px rgba(0,0,0,.2); display:flex; flex-direction:column; }
.drill-head { padding:1.25rem 1.5rem; border-bottom:1px solid var(--border); }
.drill-crumbs { font-size:.75rem; margin-bottom:.4rem; }
.drill-title { font-size:1.2rem; font-weight:800; color:var(--educate-navy); }
.drill-subtitle { font-size:.8rem; color:var(--text-muted); margin-top:.2rem; }
.drill-body { padding:1.25rem 1.5rem; overflow-y:auto; flex:1; }
.drill-close { position:absolute; top:1rem; right:1rem; background:none; border:none; font-size:1.4rem; cursor:pointer; color:#888; }

/* Debug pill */
.debug-pill { position:fixed; bottom:12px; right:12px; z-index:500; font-size:.72rem; background:#fff; border:1px solid var(--border); border-radius:999px; padding:5px 12px; box-shadow:0 2px 8px rgba(0,0,0,.12); display:flex; gap:8px; align-items:center; }

.placeholder { padding:1.25rem; background:#f0f4ff; border-radius:8px; color:#555; font-size:.9rem; }

@media print {
  .header, .view-tabs, .nat-tab-bar, .btn, .drill-panel, .drill-backdrop, .debug-pill, .no-print { display:none !important; }
  .nat-tab-panel { display:block !important; }
  .section { box-shadow:none !important; border:1px solid #ccc; break-inside:avoid; }
  .kpi-hero-card { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { background:#fff; }
}
`;
