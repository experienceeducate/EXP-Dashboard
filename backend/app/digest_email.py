"""HTML rendering + SMTP send for the weekly digest email."""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def _trend_arrow(delta: float | None) -> str:
    if delta is None:
        return ""
    if abs(delta) < 0.5:
        return " <span style=\"color:#666\">(→ stable)</span>"
    color = "#008148" if delta > 0 else "#870101"
    arrow = "↑" if delta > 0 else "↓"
    return f' <span style="color:{color}">({arrow} {abs(delta):.1f}pp vs last week)</span>'


def _metric_row(label: str, value: float, unit: str, delta: float | None) -> str:
    return (
        f'<tr><td style="padding:.5rem .75rem;color:#444">{label}</td>'
        f'<td style="padding:.5rem .75rem;font-weight:700;color:#0e313e">{value}{unit}{_trend_arrow(delta)}</td></tr>'
    )


def _flags_table(flags: list[dict]) -> str:
    if not flags:
        return '<p style="color:#008148">No CUs currently below threshold on any tracked metric. 🎉</p>'
    rows = "".join(
        f'<tr><td style="padding:.4rem .6rem">{f["cu"]}</td>'
        f'<td style="padding:.4rem .6rem">{f["region"]}</td>'
        f'<td style="padding:.4rem .6rem">{f["issue_type"]}</td>'
        f'<td style="padding:.4rem .6rem;color:{"#870101" if f["severity"] == "high" else "#a17a00"}">{f["detail"]}</td></tr>'
        for f in flags[:25]
    )
    more = f'<p style="color:#888;font-size:.85rem">+ {len(flags) - 25} more not shown</p>' if len(flags) > 25 else ""
    return (
        '<table style="width:100%;border-collapse:collapse;font-size:.9rem">'
        '<thead><tr style="background:#f0f4f8;text-align:left">'
        '<th style="padding:.4rem .6rem">CU</th><th style="padding:.4rem .6rem">Region</th>'
        '<th style="padding:.4rem .6rem">Issue</th><th style="padding:.4rem .6rem">Detail</th></tr></thead>'
        f"<tbody>{rows}</tbody></table>{more}"
    )


def render_html(digest_data: dict, narrative: str | None) -> str:
    nat = digest_data["national"]
    deltas = digest_data.get("national_deltas") or {}
    narrative_html = (
        f'<div style="background:#f8f9fa;border-radius:8px;padding:1.25rem;margin:1.25rem 0;line-height:1.6">{narrative}</div>'
        if narrative
        else ""
    )
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">
      <h2 style="color:#0e313e">EXP Programme — Weekly Digest</h2>
      <p style="color:#666;font-size:.85rem">{digest_data['run_date']} · {digest_data['year']} {digest_data['term']}</p>
      {narrative_html}
      <h3 style="color:#0e313e">Headline metrics (national)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:.95rem">
        {_metric_row('LEC Delivery', nat['lec_delivery_pct'], '%', deltas.get('lec_delivery_pct'))}
        {_metric_row('Scholar Retention', nat['retention_pct'], '%', deltas.get('retention_pct'))}
        {_metric_row('Passbook Quality', nat['pb_quality_pct'], '%', deltas.get('pb_quality_pct'))}
        {_metric_row('Mentor Observation Coverage', nat['mentor_coverage_pct'], '%', deltas.get('mentor_coverage_pct'))}
        {_metric_row('Scholar Recruitment', nat['recruitment_pct'], '%', deltas.get('recruitment_pct'))}
      </table>
      <h3 style="color:#0e313e">Regions/CUs needing support ({len(digest_data['flags'])})</h3>
      {_flags_table(digest_data['flags'])}
      <p style="color:#999;font-size:.75rem;margin-top:2rem">Automated weekly digest — EXP Programme Dashboard.</p>
    </div>
    """


def send_digest_email(recipients: list[str], subject: str, html_body: str) -> bool:
    if not settings.DIGEST_SMTP_USERNAME or not settings.DIGEST_SMTP_PASSWORD:
        logger.info("Digest SMTP credentials not set — skipping send. Recipients would have been: %s", recipients)
        return False
    if not recipients:
        logger.warning("No digest recipients resolved — skipping send.")
        return False

    from_addr = settings.DIGEST_FROM_EMAIL or settings.DIGEST_SMTP_USERNAME
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.DIGEST_SMTP_HOST, settings.DIGEST_SMTP_PORT) as server:
        server.starttls()
        server.login(settings.DIGEST_SMTP_USERNAME, settings.DIGEST_SMTP_PASSWORD)
        server.sendmail(from_addr, recipients, msg.as_string())
    return True
