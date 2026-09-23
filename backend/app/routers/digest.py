"""Weekly automated digest.

Triggered by scheduled/manual GitHub Actions workflows, not an authenticated
dashboard user — protected by a shared-secret header instead of the JWT
`current_user` dependency every other /api/* route uses (there's no user
session to check on a cron job).

Two modes, deliberately never combined into one auto-send:
  - "preview" (the Friday scheduled workflow) — computes the digest and
    emails it ONLY to DIGEST_REVIEWER_EMAILS, clearly marked as a draft.
    Never touches the full recipient list, never writes a snapshot (so a
    week without an approved send doesn't pollute next week's trend).
  - "send" (a separate, manually-triggered `workflow_dispatch` workflow) —
    recomputes the same day's digest, emails the full ACCESS_CONFIG
    "national" list, and writes this week's snapshot. Only ever run by a
    human after reading the preview.

`dry_run` is a third, simplest option (compute only, no email either way) —
for local testing without sending any real email.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from google.cloud import bigquery
from pydantic import BaseModel

from app.core import database
from app.core.access import ACCESS_CONFIG
from app.core.config import settings
from app.core.metric_rollup import compute_rollup, flag_struggling
from app.core.tables import DASHBOARD_MODEL, LEVEL_CU
from app.digest_email import render_html, send_digest_email
from app.digest_narrative import generate_narrative

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/digest", tags=["digest"])


class DigestRunRequest(BaseModel):
    year: int | None = None
    term: str | None = None  # defaults to the latest term with data for `year`
    mode: Literal["preview", "send"] = "preview"
    dry_run: bool = False  # compute only — no email either way, for local testing


def _require_internal_token(x_digest_token: str | None = Header(default=None)) -> None:
    if not settings.DIGEST_INTERNAL_TOKEN:
        raise HTTPException(status_code=503, detail="Digest is not configured (DIGEST_INTERNAL_TOKEN unset).")
    if x_digest_token != settings.DIGEST_INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid or missing X-Digest-Token header.")


def _fetch_cu_rows() -> list[dict]:
    sql = f"SELECT * FROM {DASHBOARD_MODEL} WHERE level = @level"
    params = [bigquery.ScalarQueryParameter("level", "STRING", LEVEL_CU)]
    return database.run_query(sql, params, scope_key="digest|national", use_cache=False)


def _last_snapshot(level: str, entity: str) -> dict | None:
    sql = f"""
    SELECT * FROM `{settings.digest_snapshots_table}`
    WHERE level = @level AND entity = @entity AND run_date < @today
    ORDER BY run_date DESC
    LIMIT 1
    """
    params = [
        bigquery.ScalarQueryParameter("level", "STRING", level),
        bigquery.ScalarQueryParameter("entity", "STRING", entity),
        bigquery.ScalarQueryParameter("today", "DATE", date.today().isoformat()),
    ]
    rows = database.query_rows_ignore_missing_table(sql, params)
    return rows[0] if rows else None


def _deltas(current: dict, prior: dict | None) -> dict:
    if not prior:
        return {}
    fields = ["lec_delivery_pct", "retention_pct", "pb_quality_pct", "mentor_coverage_pct", "recruitment_pct"]
    return {f: round(current[f] - prior[f], 1) for f in fields if prior.get(f) is not None}


def _compute_digest(year: int | None, term: str | None) -> dict:
    rows = _fetch_cu_rows()
    if not rows:
        raise HTTPException(status_code=502, detail="No CU-level rows returned from BigQuery.")

    year = year or max(int(r["year"]) for r in rows if r.get("year") is not None)
    year_rows = [r for r in rows if r.get("year") is not None and int(r["year"]) == year]
    if not term:
        term = "term2" if any(r.get("term") == "term2" for r in year_rows) else "term1"
    term_rows = [r for r in year_rows if r.get("term") == term]
    if not term_rows:
        raise HTTPException(status_code=404, detail=f"No data for year={year} term={term}.")
    # Recruitment/activation are genuinely term1-only fields — always sourced
    # from term1 rows regardless of which term the digest is otherwise
    # reporting on (see compute_rollup's docstring for the bug this avoids).
    t1_year_rows = [r for r in year_rows if r.get("term") == "term1"]

    national = compute_rollup(term_rows, t1_year_rows, term)
    national_deltas = _deltas(national, _last_snapshot("national", "—"))

    regions = sorted({r.get("region") for r in term_rows if r.get("region")})
    region_rollups = {
        region: compute_rollup(
            [r for r in term_rows if r.get("region") == region],
            [r for r in t1_year_rows if r.get("region") == region],
            term,
        )
        for region in regions
    }

    cus = sorted({(r.get("region"), r.get("cu")) for r in term_rows if r.get("cu")})
    flags: list[dict] = []
    for region, cu in cus:
        cu_rollup = compute_rollup(
            [r for r in term_rows if r.get("cu") == cu],
            [r for r in t1_year_rows if r.get("cu") == cu],
            term,
        )
        flags.extend(flag_struggling(cu, region, cu_rollup))
    flags.sort(key=lambda f: (f["severity"] != "high", f["cu"]))

    return {
        "run_date": date.today().isoformat(),
        "year": year,
        "term": term,
        "national": national,
        "national_deltas": national_deltas,
        "regions": region_rollups,
        "flags": flags,
    }


def _write_snapshot(digest_data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    nat = digest_data["national"]
    rows = [{
        "run_date": digest_data["run_date"], "level": "national", "entity": "—",
        "year": digest_data["year"], "term": digest_data["term"],
        "lec_delivery_pct": nat["lec_delivery_pct"], "retention_pct": nat["retention_pct"],
        "pb_quality_pct": nat["pb_quality_pct"], "mentor_coverage_pct": nat["mentor_coverage_pct"],
        "recruitment_pct": nat["recruitment_pct"], "open_issue_count": len(digest_data["flags"]),
        "created_timestamp": now,
    }]
    for region, rollup in digest_data["regions"].items():
        rows.append({
            "run_date": digest_data["run_date"], "level": "region", "entity": region,
            "year": digest_data["year"], "term": digest_data["term"],
            "lec_delivery_pct": rollup["lec_delivery_pct"], "retention_pct": rollup["retention_pct"],
            "pb_quality_pct": rollup["pb_quality_pct"], "mentor_coverage_pct": rollup["mentor_coverage_pct"],
            "recruitment_pct": rollup["recruitment_pct"],
            "open_issue_count": sum(1 for f in digest_data["flags"] if f["region"] == region),
            "created_timestamp": now,
        })
    errors = database.insert_rows(settings.digest_snapshots_table, rows)
    if errors:
        logger.warning("Digest snapshot write failed (table may not exist yet): %s", errors)
        return False
    return True


@router.post("/run")
def run_digest(body: DigestRunRequest, x_digest_token: str | None = Header(default=None)):
    _require_internal_token(x_digest_token)
    digest_data = _compute_digest(body.year, body.term)
    narrative = generate_narrative(digest_data)
    result = {
        "status": "ok", "mode": body.mode, "computed": digest_data, "narrative": narrative,
        "emailed": False, "email_recipients": [], "snapshot_written": False,
    }

    if body.dry_run:
        return result

    html = render_html(digest_data, narrative)

    if body.mode == "preview":
        recipients = settings.digest_reviewer_list
        subject = f"[DRAFT — review before sending] EXP Programme Weekly Digest — {digest_data['run_date']}"
        html = (
            '<div style="background:#fff3cd;border:1px solid #f0dfa0;border-radius:8px;'
            'padding:.85rem 1.1rem;margin-bottom:1.25rem;font-family:Arial,sans-serif;font-size:.9rem;color:#664d03">'
            "This is a <strong>draft</strong> — it has NOT been sent to the full distribution list. "
            'Run the "Send Weekly Digest" GitHub Actions workflow manually once you\'re happy with it.'
            "</div>"
        ) + html
        # Preview never writes a snapshot — an un-approved week shouldn't count
        # as "last week's" baseline for whoever eventually approves it.
    else:
        recipients = ACCESS_CONFIG.get("national", [])
        subject = f"EXP Programme Weekly Digest — {digest_data['run_date']}"

    result["email_recipients"] = recipients
    result["emailed"] = send_digest_email(recipients, subject, html)

    if body.mode == "send":
        result["snapshot_written"] = _write_snapshot(digest_data)

    return result
