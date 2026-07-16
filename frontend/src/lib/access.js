// ─────────────────────────────────────────────────────────────────────────────
// Access resolution helpers. The server resolves the user's scope
// ({hasNational, nationalOnly, regions, cus}); we only consume it here to drive
// tab visibility and dropdown scoping (spec §7). No ACCESS_CONFIG lives here.
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY = { hasNational: false, nationalOnly: false, regions: [], cus: [] };

// Normalise an access object coming from the API into a predictable shape.
export function normalizeAccess(access) {
  if (!access) return { ...EMPTY };
  return {
    hasNational: !!access.hasNational,
    nationalOnly: !!access.nationalOnly,
    regions: Array.isArray(access.regions) ? access.regions.filter(Boolean) : [],
    cus: Array.isArray(access.cus) ? access.cus.filter(Boolean) : [],
    email: access.email,
  };
}

// Which top-level view tabs are visible (legacy buildViewTabs).
// national users → National only; regional officers → Regional + CU; FOA → CU only.
export function visibleViewTabs(access) {
  const a = normalizeAccess(access);
  if (a.hasNational) return ['national'];
  const tabs = [];
  if (!a.nationalOnly && a.regions.length > 0) tabs.push('regional');
  if (!a.nationalOnly && (a.regions.length > 0 || a.cus.length > 0)) tabs.push('cu');
  return tabs;
}

// The default view to land on given the user's access.
export function defaultView(access) {
  const a = normalizeAccess(access);
  if (a.hasNational || a.nationalOnly) return 'national';
  if (a.regions.length > 0) return 'regional';
  if (a.cus.length > 0) return 'cu';
  return 'national';
}

// Regions the user can pick from in the region dropdown.
export function scopedRegions(access, summaryData) {
  const a = normalizeAccess(access);
  const all = [...new Set(summaryData.map((d) => d.region).filter(Boolean))].sort();
  if (a.hasNational) return all;
  if (a.regions.length > 0) {
    const set = new Set(a.regions.map((r) => r.toLowerCase()));
    return all.filter((r) => set.has(String(r).toLowerCase()));
  }
  return all;
}

// CUs the user can pick from, optionally restricted to a selected region.
export function scopedCUs(access, summaryData, region) {
  const a = normalizeAccess(access);
  let rows = summaryData;
  if (region) rows = rows.filter((d) => String(d.region || '').toLowerCase() === String(region).toLowerCase());
  let cus = [...new Set(rows.map((d) => d.cu).filter(Boolean))];

  if (!a.hasNational) {
    if (a.regions.length > 0) {
      const rset = new Set(a.regions.map((r) => r.toLowerCase()));
      cus = cus.filter((cu) => {
        const row = summaryData.find((d) => d.cu === cu);
        return row && rset.has(String(row.region || '').toLowerCase());
      });
    } else if (a.cus.length > 0) {
      const cset = new Set(a.cus.map((c) => String(c).toLowerCase()));
      cus = cus.filter((cu) => cset.has(String(cu).toLowerCase()));
    }
  }
  return cus.sort((x, y) => String(x).localeCompare(String(y)));
}
