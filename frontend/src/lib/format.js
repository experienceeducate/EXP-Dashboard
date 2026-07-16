// ─────────────────────────────────────────────────────────────────────────────
// Formatting / label / tag helpers ported from the legacy dashboard (spec §5, §9).
// Tag helpers return small JSX-friendly style objects rather than HTML strings.
// ─────────────────────────────────────────────────────────────────────────────
import { C, RAG } from './config.js';

// Safe percentage (0-100, rounded). Returns 0 when total is falsy.
export function formatPercentage(value, total) {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
}

// RAG class from a percentage: high ≥80 / medium ≥60 / low
export function getPercentageClass(p) {
  const n = parseInt(p, 10);
  return n >= 80 ? 'high' : n >= 60 ? 'medium' : 'low';
}

// PB quality score: % of ratings that are Good(2) or Excellent(3)
export function calculatePBQualityScore(r0, r1, r2, r3) {
  const total = (r0 || 0) + (r1 || 0) + (r2 || 0) + (r3 || 0);
  if (total === 0) return 0;
  return Math.round((((r2 || 0) + (r3 || 0)) / total) * 100);
}

// Returns the segments for a stacked PB rating bar (data, not HTML).
export function generatePBQualityBar(r0, r1, r2, r3) {
  const total = (r0 || 0) + (r1 || 0) + (r2 || 0) + (r3 || 0);
  if (total === 0) return { total: 0, segments: [] };
  const pct = (v) => Math.round(((v || 0) / total) * 100);
  const segments = [
    { key: 'r0', label: 'Not Observed', color: RAG.rating0, pct: pct(r0) },
    { key: 'r1', label: 'Poor Quality', color: RAG.rating1, pct: pct(r1) },
    { key: 'r2', label: 'Good', color: RAG.rating2, pct: pct(r2) },
    { key: 'r3', label: 'Excellent', color: RAG.rating3, pct: pct(r3) },
  ].filter((s) => s.pct > 0);
  return { total, segments };
}

// Observation quality label / color from an average score (out of 3).
export function getObsQualityLabel(score) {
  const s = Number(score);
  if (isNaN(s) || s === 0) return null;
  if (s > 2.5) return '🟢 Excellent';
  if (s >= 2.0) return '🟡 Good';
  return '🔴 Poor';
}

export function getObsQualityColor(score) {
  const s = Number(score);
  if (isNaN(s) || s === 0) return '#aaa';
  if (s > 2.5) return C.green;
  if (s >= 2.0) return C.yellow;
  return C.red;
}

export function getGMLabel() {
  return 'Group Mentoring (GM)';
}

export function getNonLECActivityLabel(term) {
  return term === 'term2' ? 'Skills Day' : 'Community Day';
}

export function getTermLabelShort(term) {
  if (term === 'all') return 'All Terms';
  return term ? 'Term ' + term.replace('term', '') : '';
}

// RAG colour helpers used across tables ---------------------------------------
export function ragColor(pct, green = 80, amber = 60) {
  const p = parseInt(pct, 10);
  return p >= green ? C.green : p >= amber ? C.yellow : C.red;
}

export function ragKpiClass(pct, green = 80, amber = 60) {
  const p = parseInt(pct, 10);
  return p >= green ? 'kpi-green' : p >= amber ? 'kpi-amber' : 'kpi-red';
}

export function ragScoreClass(pct, green = 80, amber = 60) {
  const p = parseInt(pct, 10);
  return p >= green ? 'green' : p >= amber ? 'yellow' : 'red';
}

// Tag descriptors (fg,bg + text) -----------------------------------------------
export function getSchoolTypeTag(type) {
  const map = {
    'O-level': ['#084298', '#cfe2ff'],
    'A-level': ['#6f42c1', '#e2d9f3'],
    Mixed: ['#0c5460', '#d1ecf1'],
  };
  const [fg, bg] = map[type] || ['#555', '#f8f9fa'];
  return { fg, bg, text: type || '—' };
}

export function getMentorStatusTag(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'new') return { fg: '#856404', bg: '#fff3cd', text: 'New' };
  if (s === 'experienced') return { fg: '#0c5460', bg: '#d1ecf1', text: 'Experienced' };
  return { fg: '#555', bg: '#f8f9fa', text: status || '—' };
}

export function getSchoolStatusTag(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'new') return { fg: '#856404', bg: '#fff3cd', text: 'New MOU' };
  return { fg: '#155724', bg: '#d4edda', text: 'Renewal' };
}

// Term-comparison delta arrow (legacy delta() line 10680 / arrow() 10904)
export function delta(cur, prev) {
  if (prev === null || prev === undefined) return { icon: '–', color: '#999', text: 'no prior data' };
  const d = parseFloat(cur) - parseFloat(prev);
  if (Math.abs(d) < 0.5) return { icon: '→', color: '#666', text: 'stable' };
  return d > 0
    ? { icon: '↑', color: C.green, text: `+${Math.abs(d).toFixed(1)}` }
    : { icon: '↓', color: C.red, text: `-${Math.abs(d).toFixed(1)}` };
}

export function num(v) {
  return (Number(v) || 0).toLocaleString();
}
