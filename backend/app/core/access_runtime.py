"""
Process-wide wiring for individual guest access and server-side sessions
(core/guest_access.py, shared verbatim with the EXP Training Toolkit): the
BigQuery event-log persistence, the mail sender, the background job queue
and the rate limiters. app/auth.py (sign-in routes, current_user) and
routers/guests_admin.py (admin panel) both use the single instances here.

The event log is app-owned: settings.access_events_table
(`<project>.<DASHBOARD_APP_DATASET>.raw_exp_dashboard_access_events`, see
DATA_ENG_BIGQUERY_TABLES_REQUEST.md table 6). Single process only, like the
query cache (docs/CONTEXT.md).
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from app.core import database
from app.core import guest_access as ga
from app.core.config import settings

logger = logging.getLogger(__name__)

APP_NAME = "EXP Programme Dashboard"
GUEST_SCOPE_TYPES = ("regional", "cu")


def _config() -> ga.AccessConfig:
    return ga.AccessConfig(
        idle_timeout=settings.SESSION_IDLE_MINUTES * 60,
        staff_session_lifetime=settings.STAFF_SESSION_HOURS * 3600,
        guest_session_lifetime=settings.GUEST_SESSION_HOURS * 3600,
    )


def _bq_persistence() -> ga.CallablePersistence:
    table = settings.access_events_table

    def insert(rows):
        # Looked up on the module at call time so the tests' monkeypatch of
        # database.insert_rows reaches it. Returns BigQuery's error list.
        return database.insert_rows(table, rows)

    def select():
        return database.run_query(
            "SELECT event_id, event_timestamp, event_type, subject_email, actor_email, session_id, "
            f"link_id, token_hash, client_ip, details FROM `{table}` ORDER BY event_timestamp",
            use_cache=False, timeout=20,
        )

    return ga.CallablePersistence(insert, select)


def _build_store() -> ga.AccessStore:
    if settings.ACCESS_EVENTS_IN_MEMORY:
        return ga.AccessStore(ga.MemoryPersistence(), _config())
    return ga.AccessStore(_bq_persistence(), _config())


store: ga.AccessStore = _build_store()
mail_sender = ga.build_mail_sender(
    settings.MAIL_BACKEND,
    smtp_host=settings.SMTP_HOST, smtp_port=settings.SMTP_PORT,
    smtp_username=settings.SMTP_USERNAME, smtp_password=settings.SMTP_PASSWORD,
    smtp_from=settings.SMTP_FROM, smtp_starttls=settings.SMTP_STARTTLS,
    outbox_dir=settings.MAIL_OUTBOX_DIR,
)
jobs = ga.JobQueue("exp-dashboard-access")
ip_limiter = ga.RateLimiter([(10, 60), (40, 3600)])
email_limiter = ga.RateLimiter([(3, 15 * 60), (10, 86400)])

_load_lock = threading.Lock()
_last_load_attempt = 0.0
_RELOAD_RETRY_SECONDS = 30


def ensure_loaded() -> ga.AccessStore:
    """Lazy, retried load (never in the lifespan hook — see main.py's incident
    note). Until it loads, sessions from before a restart aren't recognised
    and guests can't sign in: fail closed."""
    global _last_load_attempt
    if store.loaded:
        return store
    with _load_lock:
        if store.loaded or time.time() - _last_load_attempt < _RELOAD_RETRY_SECONDS:
            return store
        _last_load_attempt = time.time()
        store.load()
    return store


def reset_for_tests(new_store: Optional[ga.AccessStore] = None, sender=None, job_queue=None) -> None:
    global store, mail_sender, jobs, _last_load_attempt
    store = new_store or ga.AccessStore(ga.MemoryPersistence(), _config())
    store.loaded = True
    mail_sender = sender or ga.DisabledMailSender()
    jobs = job_queue or ga.InlineJobQueue()
    ip_limiter._hits.clear()
    email_limiter._hits.clear()
    _last_load_attempt = 0.0


def guest_sign_in_available() -> bool:
    return bool(getattr(mail_sender, "configured", False)) and bool(settings.FRONTEND_URL)


def magic_link_url(token: str) -> str:
    # Fragment: never sent to a server, so never in an access log or Referer.
    # The page only shows a "Sign in" button; redemption is a POST.
    return f"{settings.FRONTEND_URL.rstrip('/')}/#magic={token}"


def send_magic_link_job(email: str, ip: Optional[str]):
    def job():
        current = ensure_loaded()
        token = current.issue_magic_link(email, ip=ip)
        if not token:
            return
        subject, body = ga.magic_link_email(APP_NAME, magic_link_url(token))
        try:
            mail_sender.send(email, subject, body)
        except Exception:  # noqa: BLE001
            logger.exception("Sign-in email could not be sent")   # never log the link
            current.record_auth_failure("magic_link_send_failed", email)

    return job
