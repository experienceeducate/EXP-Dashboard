"""Pure programme-metric rollup computation — no I/O.

Shared by the weekly digest (``app/digest_metrics.py`` used to own this) and
E!nsight (``core/ensight_metrics.py``), so a formula fix only has to happen
once. Formulas are ported line-for-line from the frontend (``frontend/src/
lib/metrics.js`` and ``frontend/src/lib/config.js``'s ``METRIC_DEFINITIONS``),
which are the validated source of truth for these calculations. Keep these
in sync if a formula changes there — see docs/METRICS.md.
"""
from __future__ import annotations

TERM_LECS: dict[str, list[int]] = {
    "term1": [1, 2, 3, 4, 5],
    "term2": [6, 7, 8, 9, 10, 11, 12, 13, 14],
    "term3": [15, 16, 17, 18, 19, 20],
}

# Thresholds mirror METRIC_DEFINITIONS in config.js — used to flag CUs/regions
# needing support in the digest.
LEC_DELIVERY_BEHIND = 60
MENTOR_COVERAGE_CRITICAL = 50
RECRUITMENT_BELOW_TARGET = 80
PB_QUALITY_NEEDS_ATTENTION = 60


def n(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def lecs_for_term(term: str) -> list[int]:
    return TERM_LECS.get(term, TERM_LECS["term1"])


def lec_delivery_pct(rows: list[dict], lec_nums: list[int]) -> tuple[float, int, int]:
    """Returns (pct, delivered, expected)."""
    total_schools = sum(n(r.get("total_target_schools")) for r in rows)
    delivered = sum(sum(n(r.get(f"schools_with_lec{i}")) for r in rows) for i in lec_nums)
    expected = total_schools * len(lec_nums)
    pct = round((delivered / expected) * 100, 1) if expected > 0 else 0.0
    return pct, int(delivered), int(expected)


def resolve_last_lec_scholars(rows: list[dict], lec_nums: list[int]) -> tuple[int, int, bool]:
    """Ported from resolveLastLecScholars (metrics.js). Returns
    (last_lec, last_lec_scholars, is_projected)."""
    if not lec_nums:
        return 0, 0, False
    last_lec = lec_nums[-1]
    actual = sum(n(r.get(f"lec{last_lec}_scholars")) for r in rows)
    delivered_schools = sum(n(r.get(f"schools_with_lec{last_lec}")) for r in rows)
    total_schools = sum(n(r.get("total_target_schools")) for r in rows)
    coverage = (delivered_schools / total_schools) if total_schools > 0 else 0.0
    if actual > 0 and coverage >= 0.9:
        return last_lec, int(actual), False

    delivered_lecs = [ln for ln in lec_nums if any(n(r.get(f"schools_with_lec{ln}")) > 0 for r in rows)]
    recent = delivered_lecs[-2:]
    recent_s = 0.0
    recent_del = 0.0
    for ln in recent:
        s = sum(n(r.get(f"lec{ln}_scholars")) for r in rows)
        d = sum(n(r.get(f"schools_with_lec{ln}")) for r in rows)
        if d > 0:
            recent_s += s
            recent_del += d
    if recent_del > 0:
        avg_per_school = recent_s / recent_del
        school_count = sum(n(r.get("total_target_schools")) for r in rows)
        return last_lec, round(avg_per_school * school_count), True
    return last_lec, 0, False


def retention_pct(rows: list[dict], t1_rows: list[dict], lec_nums: list[int]) -> tuple[float, bool]:
    activated = sum(n(r.get("lec2_scholars")) for r in t1_rows)
    _, last_lec_scholars, is_projected = resolve_last_lec_scholars(rows, lec_nums)
    base = activated if activated > 0 else sum(n(r.get("total_scholars_recruited")) for r in t1_rows)
    pct = round((last_lec_scholars / base) * 100, 1) if base > 0 else 0.0
    return pct, is_projected


def pb_quality_pct(rows: list[dict], term: str) -> float:
    fields = ["m1", "m2"] if term == "term1" else ["m3", "m4"] if term == "term2" else ["m1", "m2", "m3", "m4"]
    q = sum(sum(n(r.get(f"{f}_quality_rated")) for f in fields) for r in rows)
    t = sum(sum(n(r.get(f"{f}_total_rated")) for f in fields) for r in rows)
    return round((q / t) * 100, 1) if t > 0 else 0.0


def mentor_coverage_pct(rows: list[dict]) -> tuple[float, int, int]:
    active = sum(n(r.get("total_active_mentors")) for r in rows)
    observed = sum(min(n(r.get("total_observed_mentors")), n(r.get("total_active_mentors"))) for r in rows)
    pct = round((observed / active) * 100, 1) if active > 0 else 0.0
    return pct, int(observed), int(active)


def recruitment_pct(t1_rows: list[dict]) -> tuple[float, int, int]:
    recruited = sum(n(r.get("total_scholars_recruited")) for r in t1_rows)
    target = sum(n(r.get("total_target_schools")) for r in t1_rows) * 45
    pct = round((recruited / target) * 100, 1) if target > 0 else 0.0
    return pct, int(recruited), int(target)


def compute_rollup(rows: list[dict], t1_rows: list[dict], term: str) -> dict:
    """All headline metrics for one group of CU rows (national, a region, or a
    CU). `rows` is scoped to `term` (e.g. only that entity's term2 rows);
    `t1_rows` MUST be that same entity's term1 rows from the full-year
    dataset, passed in separately — recruitment/activation are genuinely
    term1-only fields (null/0 on a term2 row), so deriving t1_rows by
    filtering `rows` itself is wrong whenever `term != 'term1'` (it finds
    nothing and silently falls back to the term2 rows, which read ~0 for
    those fields — verified live: this produced a 30,000%+ retention rate
    before the fix, dividing real term2 attendance by a near-zero base)."""
    lec_nums = lecs_for_term(term)
    if not t1_rows:
        t1_rows = rows
    delivery_pct, delivered, expected = lec_delivery_pct(rows, lec_nums)
    ret_pct, ret_projected = retention_pct(rows, t1_rows, lec_nums)
    pb_pct = pb_quality_pct(rows, term)
    cov_pct, observed, active = mentor_coverage_pct(rows)
    rec_pct, recruited, rec_target = recruitment_pct(t1_rows)
    return {
        "lec_delivery_pct": delivery_pct,
        "lec_delivered": delivered,
        "lec_expected": expected,
        "retention_pct": ret_pct,
        "retention_projected": ret_projected,
        "pb_quality_pct": pb_pct,
        "mentor_coverage_pct": cov_pct,
        "mentors_observed": observed,
        "mentors_active": active,
        "recruitment_pct": rec_pct,
        "scholars_recruited": recruited,
        "recruitment_target": rec_target,
        "total_schools": int(sum(n(r.get("total_target_schools")) for r in (rows if rows else t1_rows))),
    }


def flag_struggling(cu_name: str, region: str, rollup: dict) -> list[dict]:
    """Returns a list of {cu, region, issue_type, detail, severity} for any
    metric below its threshold, for one CU's rollup."""
    flags = []
    if rollup["lec_delivery_pct"] < LEC_DELIVERY_BEHIND:
        flags.append({
            "cu": cu_name, "region": region, "issue_type": "LEC Delivery Behind",
            "detail": f"{rollup['lec_delivery_pct']}% ({rollup['lec_delivered']}/{rollup['lec_expected']} sessions)",
            "severity": "high" if rollup["lec_delivery_pct"] < 40 else "medium",
        })
    if rollup["mentors_active"] > 0 and rollup["mentor_coverage_pct"] < MENTOR_COVERAGE_CRITICAL:
        flags.append({
            "cu": cu_name, "region": region, "issue_type": "Low Mentor Observation Coverage",
            "detail": f"{rollup['mentor_coverage_pct']}% ({rollup['mentors_observed']}/{rollup['mentors_active']} mentors)",
            "severity": "high" if rollup["mentor_coverage_pct"] < 25 else "medium",
        })
    if rollup["recruitment_target"] > 0 and rollup["recruitment_pct"] < RECRUITMENT_BELOW_TARGET:
        flags.append({
            "cu": cu_name, "region": region, "issue_type": "Recruitment Below Target",
            "detail": f"{rollup['recruitment_pct']}% ({rollup['scholars_recruited']}/{rollup['recruitment_target']} scholars)",
            "severity": "medium",
        })
    if rollup["pb_quality_pct"] > 0 and rollup["pb_quality_pct"] < PB_QUALITY_NEEDS_ATTENTION:
        flags.append({
            "cu": cu_name, "region": region, "issue_type": "Low Passbook Quality",
            "detail": f"{rollup['pb_quality_pct']}% rated Good/Excellent",
            "severity": "medium",
        })
    return flags
