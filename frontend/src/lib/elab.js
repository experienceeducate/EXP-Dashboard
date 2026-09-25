// ─────────────────────────────────────────────────────────────────────────────
// Shared E-Lab completion helpers (pure, no I/O). Used by RegionalView, CuView
// and NationalView's Mentor Quality > E-Lab sub-tab — factored out here rather
// than duplicated (or imported National<->Regional, which would be circular:
// RegionalView.jsx already imports from NationalView.jsx).
// v1 is Term 3 only — see docs/DECISION.md.
// ─────────────────────────────────────────────────────────────────────────────

export const ELAB_LEC_NUMS = [15, 16, 17, 18, 19, 20];

export const ELAB_SLICE_LABELS = { mentor: 'Mentor', co_mentor: 'Co-Mentor', female: 'Female', male: 'Male', unknown: 'Unknown' };

const N = (v) => Number(v) || 0;

// Sums a `breakdowns` dimension (role or gender) across CU rows from
// GET /api/elab/summary-by-cu — one entry per distinct slice_value.
export function aggregateElabBreakdown(rows, dimension) {
  const totals = {};
  for (const cu of rows) {
    for (const b of cu.breakdowns || []) {
      if (b.dimension !== dimension) continue;
      const key = b.slice_value;
      if (!totals[key]) totals[key] = { slice_value: key, mentors_with_activity: 0, sessions_completed: 0, sessions_in_progress: 0 };
      totals[key].mentors_with_activity += N(b.mentors_with_activity);
      totals[key].sessions_completed += N(b.sessions_completed);
      totals[key].sessions_in_progress += N(b.sessions_in_progress);
    }
  }
  return Object.values(totals).sort((a, b) => String(a.slice_value).localeCompare(String(b.slice_value)));
}

// Sums each CU's `sessions` array (per-LEC completed counts) into one
// per-session total across the given rows.
export function aggregateElabPerSession(rows) {
  const totals = {};
  for (const cu of rows) {
    for (const s of cu.sessions || []) {
      if (!totals[s.lec_num]) totals[s.lec_num] = { lec_num: s.lec_num, lesson_name: s.lesson_name, completed_mentors: 0 };
      totals[s.lec_num].completed_mentors += N(s.completed_mentors);
    }
  }
  return Object.values(totals).sort((a, b) => a.lec_num - b.lec_num);
}
