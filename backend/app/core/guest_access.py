"""
Individual, auditable, time-limited access: guest requests and approval, an
email whitelist, magic-link sign-in, and server-side sessions with refresh-token
rotation and immediate revocation.

This module is framework-free (stdlib only) so its rules can be unit-tested in
isolation. The web layer (routers) wraps it: it encodes/decodes the short-lived
access JWT, reads the client IP, sends the mail and maps AccessError to HTTP.
The SAME file is used by the EXP Training Toolkit and the EXP Dashboard — keep
the two copies identical (tests/test_guest_access_core.py pins the behaviour).

Plan reference: "EXP Security Review and Guest Access Plan" v1.3, section 5.

STORAGE MODEL — append-only event log, state rebuilt in memory
---------------------------------------------------------------
Every change is an event appended to an app-owned BigQuery table (one row per
event, never updated or deleted — so the BigQuery streaming-buffer limits on
UPDATE/DELETE never apply). On startup the store replays the log to rebuild
state; afterwards the in-memory state is authoritative and every change is
written to the log first.

  * Single process only, like each app's query cache: a second replica would
    hold its own copy of sessions and revocations. Do not scale either backend
    past one replica / one uvicorn worker without moving this to a shared store.
  * Fail closed: an event that GRANTS access (approve, renew, whitelist add,
    session creation, link issue) is applied only if it was persisted. An event
    that REMOVES access (revoke, whitelist removal, reject, session revocation)
    is applied in memory even when persisting fails, and the failure is raised
    so the admin sees it — the removal is effective now and must be retried so
    it also survives a restart.
  * Secrets never stored: magic-link tokens and refresh tokens are kept only as
    SHA-256 hashes; nothing in an event or a log line contains a token.

Definitions (the plan's "define session lifetime, idle timeout, refresh"):
  * Access token: a JWT minted by the web layer, valid ACCESS_TOKEN_SECONDS
    (15 min), carrying the session id (`sid`). Every request re-validates the
    sid here, so revocation is immediate — expiry is not relied on.
  * Refresh token: opaque `<sid>.<secret>`, single use. Each refresh returns a
    new one and the old one stops working (rotation). Presenting a rotated
    token again after a short grace window (concurrent tabs) is treated as
    theft and revokes the whole session.
  * Idle timeout: no request and no refresh for IDLE_TIMEOUT_SECONDS ends the
    session. Absolute lifetime: a session never outlives its abs expiry, nor
    (for guests) the guest's access end date.
  * Every login creates a brand-new session id (no fixation).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import queue
import re
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional, Protocol

logger = logging.getLogger(__name__)
audit_logger = logging.getLogger("audit")

# ── Defaults (overridable per app via AccessConfig) ──────────────────────────
MAGIC_LINK_TTL_SECONDS = 15 * 60
LOGIN_CODE_TTL_SECONDS = 60
ACCESS_TOKEN_SECONDS = 15 * 60
REFRESH_REUSE_GRACE_SECONDS = 30
DEFAULT_ACCESS_DAYS = 90
MAX_ACCESS_DAYS = 365

# Same message whether or not the email is eligible (plan §5, Responses).
GENERIC_LINK_MESSAGE = (
    "If that email is approved for access, a sign-in link is on its way. "
    "It expires in 15 minutes and works once."
)
GENERIC_REQUEST_MESSAGE = (
    "Thanks — your request has been recorded. An administrator will review it, "
    "and you'll be able to request a sign-in link once it is approved."
)
GENERIC_REDEEM_ERROR = "This sign-in link is invalid, already used or expired. Request a new one."

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")

# Guest statuses
PENDING, APPROVED, REJECTED, REVOKED = "pending", "approved", "rejected", "revoked"
KIND_GUEST, KIND_STAFF = "guest", "staff"


class AccessError(Exception):
    """Raised for any authentication failure. `public` is safe to show the
    client; `reason` is for the audit log only."""

    def __init__(self, reason: str, public: str = "Your session has ended. Please sign in again.",
                 status: int = 401):
        super().__init__(reason)
        self.reason = reason
        self.public = public
        self.status = status


class PersistenceError(Exception):
    """The event could not be written to the durable log."""


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


def normalize_email(raw: Optional[str]) -> str:
    """Trim + lowercase (plan §5 Whitelist). Raises ValueError if not an email."""
    email = (raw or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise ValueError("must be a valid email address")
    return email


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _iso(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _parse_ts(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


# ── Persistence ──────────────────────────────────────────────────────────────
class Persistence(Protocol):
    def append(self, events: list[dict]) -> None: ...
    def load(self) -> list[dict]: ...


class MemoryPersistence:
    """Tests and local dev. `fail_next` lets tests simulate a write failure."""

    def __init__(self, events: Optional[list[dict]] = None):
        self.events: list[dict] = list(events or [])
        self.fail_next = False

    def append(self, events: list[dict]) -> None:
        if self.fail_next:
            self.fail_next = False
            raise PersistenceError("simulated write failure")
        self.events.extend(json.loads(json.dumps(events)))

    def load(self) -> list[dict]:
        return list(self.events)


class CallablePersistence:
    """Adapter for a BigQuery-backed log: `insert(rows) -> errors` and
    `select() -> rows`. Each app passes its own BigQuery helpers so the
    tests' monkeypatch seams keep working."""

    def __init__(self, insert: Callable[[list[dict]], Any], select: Callable[[], list[dict]]):
        self._insert = insert
        self._select = select

    def append(self, events: list[dict]) -> None:
        try:
            errors = self._insert(events)
        except Exception as exc:  # noqa: BLE001 — any write failure is a PersistenceError
            raise PersistenceError(f"event log write failed: {type(exc).__name__}") from exc
        if errors:
            raise PersistenceError(f"event log write failed: {errors!r}"[:500])

    def load(self) -> list[dict]:
        return list(self._select() or [])


# ── State records ────────────────────────────────────────────────────────────
@dataclass
class Guest:
    email: str
    status: str = PENDING
    organization: Optional[str] = None
    reason: Optional[str] = None
    grant: dict = field(default_factory=dict)          # app-specific: role / scope
    requested_at: Optional[float] = None
    invited_by: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[float] = None
    expires_at: Optional[float] = None
    last_login_at: Optional[float] = None
    request_count: int = 0

    def effective_status(self, now: float) -> str:
        if self.status == APPROVED and self.expires_at is not None and now >= self.expires_at:
            return "expired"
        return self.status


@dataclass
class MagicLink:
    link_id: str
    email: str
    token_hash: str
    issued_at: float
    expires_at: float
    used: bool = False
    invalidated: bool = False


@dataclass
class Session:
    sid: str
    email: str
    kind: str                     # guest | staff
    method: str                   # magic_link | google | basic_dev
    created_at: float
    abs_expires_at: float
    last_activity: float
    refresh_hash: str
    prev_refresh_hash: Optional[str] = None
    rotated_at: Optional[float] = None
    revoked: bool = False
    revoked_reason: Optional[str] = None


@dataclass
class SessionGrant:
    """What the web layer hands to the browser (plus an access JWT it mints)."""
    sid: str
    email: str
    kind: str
    refresh_token: str
    abs_expires_at: float


@dataclass
class AccessConfig:
    magic_link_ttl: int = MAGIC_LINK_TTL_SECONDS
    login_code_ttl: int = LOGIN_CODE_TTL_SECONDS
    idle_timeout: int = 60 * 60
    staff_session_lifetime: int = 12 * 60 * 60
    guest_session_lifetime: int = 8 * 60 * 60
    refresh_reuse_grace: int = REFRESH_REUSE_GRACE_SECONDS
    # Staff (Google) sign-in keeps working if the event log is unwritable —
    # e.g. before the table exists: the session then lives in memory only and
    # ends at the next restart. Guest grants and guest sessions never do this.
    staff_sessions_tolerate_log_outage: bool = True
    default_access_days: int = DEFAULT_ACCESS_DAYS
    max_access_days: int = MAX_ACCESS_DAYS
    audit_memory: int = 5000


# ── The store ────────────────────────────────────────────────────────────────
class AccessStore:
    def __init__(self, persistence: Persistence, config: Optional[AccessConfig] = None,
                 clock: Callable[[], float] = time.time):
        self._p = persistence
        self.config = config or AccessConfig()
        self._clock = clock
        self._lock = threading.RLock()
        self.guests: dict[str, Guest] = {}
        self.whitelist: dict[str, dict] = {}       # email -> {added_by, added_at}
        self.links: dict[str, MagicLink] = {}      # link_id -> link
        self.sessions: dict[str, Session] = {}     # sid -> session
        self._login_codes: dict[str, dict] = {}    # hash(code) -> {email, kind, method, exp}
        self.audit: list[dict] = []
        self.loaded = False
        self.load_error: Optional[str] = None

    # ---- lifecycle --------------------------------------------------------
    def load(self) -> None:
        """Rebuild state from the durable log. On failure the store stays
        EMPTY (no guest can authenticate) — fail closed — and load_error says why."""
        try:
            events = self._p.load()
        except Exception as exc:  # noqa: BLE001
            self.load_error = f"{type(exc).__name__}: {exc}"[:300]
            logger.warning("Access event log could not be loaded; guest sign-in is unavailable: %s",
                           self.load_error)
            return
        events = sorted(events, key=lambda e: (_parse_ts(e.get("event_timestamp")) or 0.0))
        with self._lock:
            for e in events:
                self._apply(e)
            self.loaded = True
            self.load_error = None

    def now(self) -> float:
        return self._clock()

    # ---- event plumbing ---------------------------------------------------
    def _event(self, event_type: str, subject: Optional[str], actor: Optional[str] = None,
               ip: Optional[str] = None, **details) -> dict:
        sid = details.pop("session_id", None)
        link_id = details.pop("link_id", None)
        token_hash = details.pop("token_hash", None)
        return {
            "event_id": str(uuid.uuid4()),
            "event_timestamp": _iso(self.now()),
            "event_type": event_type,
            "subject_email": subject,
            "actor_email": actor,
            "session_id": sid,
            "link_id": link_id,
            "token_hash": token_hash,
            "client_ip": ip,
            "details": json.dumps(details, default=str, sort_keys=True) if details else None,
        }

    def _commit(self, events: list[dict], *, removes_access: bool = False, tolerate: bool = False) -> None:
        """Persist then apply. For access-removing events, apply even if the
        write fails (then re-raise) so the removal takes effect immediately.
        `tolerate` (staff sessions only) applies in memory and only logs."""
        try:
            self._p.append(events)
        except PersistenceError:
            if removes_access or tolerate:
                for e in events:
                    self._apply(e)
            if tolerate:
                logger.warning("Access event log unavailable; %s kept in memory only",
                               ",".join(e["event_type"] for e in events))
                return
            raise
        for e in events:
            self._apply(e)

    def _remember(self, e: dict) -> None:
        self.audit.append({k: e.get(k) for k in (
            "event_id", "event_timestamp", "event_type", "subject_email", "actor_email",
            "session_id", "link_id", "client_ip", "details")})
        if len(self.audit) > self.config.audit_memory:
            del self.audit[: len(self.audit) - self.config.audit_memory]
        audit_logger.info("%s subject=%s actor=%s", e.get("event_type"), e.get("subject_email"),
                          e.get("actor_email"))

    def _apply(self, e: dict) -> None:  # noqa: C901 — one branch per event type, by design
        et = e.get("event_type")
        email = e.get("subject_email")
        ts = _parse_ts(e.get("event_timestamp")) or self.now()
        try:
            d = json.loads(e.get("details") or "{}")
        except (TypeError, ValueError):
            d = {}
        self._remember(e)

        if et == "guest_access_requested":
            g = self.guests.get(email) or Guest(email=email)
            g.request_count += 1
            if g.status in (PENDING, REJECTED, REVOKED) or g.effective_status(ts) == "expired":
                g.status = PENDING
                g.organization = d.get("organization") or g.organization
                g.reason = d.get("reason") or g.reason
                g.requested_at = ts
            self.guests[email] = g
        elif et in ("guest_approved", "guest_invited"):
            g = self.guests.get(email) or Guest(email=email, requested_at=ts)
            g.status = APPROVED
            g.grant = d.get("grant") or {}
            g.organization = d.get("organization") or g.organization
            g.expires_at = _parse_ts(d.get("expires_at"))
            g.decided_by, g.decided_at = e.get("actor_email"), ts
            if et == "guest_invited":
                g.invited_by = e.get("actor_email")
            self.guests[email] = g
        elif et == "guest_renewed":
            g = self.guests.get(email)
            if g:
                g.status = APPROVED
                g.expires_at = _parse_ts(d.get("expires_at"))
                g.decided_by, g.decided_at = e.get("actor_email"), ts
        elif et == "guest_rejected":
            g = self.guests.get(email) or Guest(email=email)
            g.status = REJECTED
            g.decided_by, g.decided_at = e.get("actor_email"), ts
            self.guests[email] = g
        elif et == "guest_revoked":
            g = self.guests.get(email)
            if g:
                g.status = REVOKED
                g.decided_by, g.decided_at = e.get("actor_email"), ts
        elif et == "whitelist_added":
            self.whitelist[email] = {"added_by": e.get("actor_email"), "added_at": ts}
        elif et == "whitelist_removed":
            self.whitelist.pop(email, None)
        elif et == "magic_link_issued":
            self.links[e["link_id"]] = MagicLink(
                link_id=e["link_id"], email=email, token_hash=e.get("token_hash") or "",
                issued_at=ts, expires_at=_parse_ts(d.get("expires_at")) or ts)
        elif et == "magic_link_redeemed":
            link = self.links.get(e.get("link_id"))
            if link:
                link.used = True
        elif et == "magic_link_invalidated":
            link = self.links.get(e.get("link_id"))
            if link:
                link.invalidated = True
        elif et == "session_created":
            sid = e.get("session_id")
            self.sessions[sid] = Session(
                sid=sid, email=email, kind=d.get("kind", KIND_STAFF), method=d.get("method", ""),
                created_at=ts, abs_expires_at=_parse_ts(d.get("abs_expires_at")) or ts,
                last_activity=ts, refresh_hash=e.get("token_hash") or "")
            if d.get("kind") == KIND_GUEST and email in self.guests:
                self.guests[email].last_login_at = ts
        elif et == "session_refreshed":
            s = self.sessions.get(e.get("session_id"))
            if s:
                s.prev_refresh_hash, s.rotated_at = s.refresh_hash, ts
                s.refresh_hash = e.get("token_hash") or ""
                s.last_activity = max(s.last_activity, ts)
        elif et == "session_revoked":
            s = self.sessions.get(e.get("session_id"))
            if s:
                s.revoked, s.revoked_reason = True, d.get("reason")
        # auth_failed / login_succeeded / guest_* audit-only events: nothing to apply

    # ---- eligibility -------------------------------------------------------
    def guest_status(self, email: str) -> tuple[bool, str]:
        """(can authenticate, reason). A guest needs BOTH approval and the
        whitelist (plan §5: separate controls), unexpired and unrevoked."""
        g = self.guests.get(email)
        if g is None:
            return False, "not_requested"
        st = g.effective_status(self.now())
        if st != APPROVED:
            return False, st
        if email not in self.whitelist:
            return False, "not_whitelisted"
        return True, "ok"

    # ---- request / admin lifecycle ----------------------------------------
    def request_access(self, email: str, organization: Optional[str], reason: Optional[str],
                       ip: Optional[str] = None) -> None:
        """Records a pending request. Never reveals the guest's current state."""
        email = normalize_email(email)
        with self._lock:
            g = self.guests.get(email)
            if g and g.effective_status(self.now()) in (APPROVED, PENDING) and g.request_count >= 5:
                return  # cap repeated requests from one address; nothing to change
            self._commit([self._event("guest_access_requested", email, ip=ip,
                                      organization=(organization or "")[:200] or None,
                                      reason=(reason or "")[:1000] or None)])

    def _expiry(self, days: Optional[int]) -> float:
        days = self.config.default_access_days if days is None else int(days)
        if not 1 <= days <= self.config.max_access_days:
            raise ValueError(f"days must be between 1 and {self.config.max_access_days}")
        return self.now() + days * 86400

    def approve(self, email: str, actor: str, grant: dict, days: Optional[int] = None,
                organization: Optional[str] = None, invited: bool = False) -> Guest:
        email = normalize_email(email)
        with self._lock:
            if not invited and email not in self.guests:
                raise NotFoundError(email)
            expires = self._expiry(days)
            et = "guest_invited" if invited else "guest_approved"
            self._commit([self._event(et, email, actor, grant=grant, expires_at=_iso(expires),
                                      organization=organization)])
            return self.guests[email]

    def invite(self, email: str, actor: str, grant: dict, days: Optional[int] = None,
               organization: Optional[str] = None) -> Guest:
        """Admin invite: approved + whitelisted in one step (both controls are
        still recorded separately). The caller then sends a magic link."""
        email = normalize_email(email)
        with self._lock:
            g = self.approve(email, actor, grant, days, organization, invited=True)
            if email not in self.whitelist:
                self.whitelist_add(email, actor)
            return g

    def reject(self, email: str, actor: str, reason: Optional[str] = None) -> None:
        email = normalize_email(email)
        with self._lock:
            if email not in self.guests:
                raise NotFoundError(email)
            events = [self._event("guest_rejected", email, actor, reason=(reason or "")[:500] or None)]
            events += self._revocation_events(email, actor, "rejected")
            self._commit(events, removes_access=True)

    def renew(self, email: str, actor: str, days: Optional[int] = None) -> Guest:
        email = normalize_email(email)
        with self._lock:
            g = self.guests.get(email)
            if g is None or g.status not in (APPROVED,):
                # Renewal re-extends an approved (possibly expired) guest; a
                # revoked or rejected guest must be re-approved deliberately.
                raise ConflictError("only approved or expired guests can be renewed")
            self._commit([self._event("guest_renewed", email, actor,
                                      expires_at=_iso(self._expiry(days)))])
            return g

    def revoke(self, email: str, actor: str) -> int:
        email = normalize_email(email)
        with self._lock:
            if email not in self.guests:
                raise NotFoundError(email)
            events = [self._event("guest_revoked", email, actor)]
            events += self._revocation_events(email, actor, "guest_revoked")
            self._commit(events, removes_access=True)
            return sum(1 for e in events if e["event_type"] == "session_revoked")

    def whitelist_add(self, email: str, actor: str) -> None:
        email = normalize_email(email)
        with self._lock:
            self._commit([self._event("whitelist_added", email, actor)])

    def whitelist_remove(self, email: str, actor: str) -> None:
        email = normalize_email(email)
        with self._lock:
            if email not in self.whitelist:
                raise NotFoundError(email)
            events = [self._event("whitelist_removed", email, actor)]
            events += self._revocation_events(email, actor, "whitelist_removed")
            self._commit(events, removes_access=True)

    # ---- revocation --------------------------------------------------------
    def _revocation_events(self, email: str, actor: Optional[str], reason: str) -> list[dict]:
        """Events ending every live session and every outstanding link that
        belongs to `email` — and ONLY to `email`."""
        now = self.now()
        out = []
        for s in self.sessions.values():
            if s.email == email and not s.revoked:
                out.append(self._event("session_revoked", email, actor, session_id=s.sid, reason=reason))
        for link in self.links.values():
            if link.email == email and not link.used and not link.invalidated and link.expires_at > now:
                out.append(self._event("magic_link_invalidated", email, actor, link_id=link.link_id,
                                       reason=reason))
        return out

    def revoke_all_for(self, email: str, actor: Optional[str] = None, reason: str = "revoked") -> int:
        """Revoke every active session and refresh token, and invalidate every
        pending magic link, for ONE person. Scoped by exact (normalised)
        email: other guests' and staff sessions are untouched. Effective
        immediately — the next request on a revoked session is refused, even
        though its access token has not expired. Returns sessions revoked."""
        email = normalize_email(email)
        with self._lock:
            events = self._revocation_events(email, actor, reason)
            if events:
                self._commit(events, removes_access=True)
            return sum(1 for e in events if e["event_type"] == "session_revoked")

    # ---- magic links -------------------------------------------------------
    def issue_magic_link(self, email: str, ip: Optional[str] = None) -> Optional[str]:
        """Returns a fresh single-use token, or None if the email may not
        authenticate. Earlier outstanding links for the email are invalidated."""
        try:
            email = normalize_email(email)
        except ValueError:
            return None
        with self._lock:
            ok, why = self.guest_status(email)
            if not ok:
                self._audit_only("magic_link_denied", email, ip=ip, reason=why)
                return None
            token = secrets.token_urlsafe(32)
            link_id = uuid.uuid4().hex
            now = self.now()
            events = []
            for link in self.links.values():
                if link.email == email and not link.used and not link.invalidated and link.expires_at > now:
                    events.append(self._event("magic_link_invalidated", email, link_id=link.link_id,
                                              reason="superseded"))
            events.append(self._event("magic_link_issued", email, ip=ip, link_id=link_id,
                                      token_hash=hash_token(token),
                                      expires_at=_iso(now + self.config.magic_link_ttl)))
            self._commit(events)
            return token

    def redeem_magic_link(self, token: str, ip: Optional[str] = None) -> SessionGrant:
        """Single use, unexpired, still-eligible guest. Every failure raises the
        same AccessError (no oracle on why)."""
        th = hash_token(token or "")
        with self._lock:
            link = next((l for l in self.links.values() if hmac.compare_digest(l.token_hash, th)), None)
            now = self.now()
            if link is None:
                self._fail("magic_link_unknown", None, ip)
            if link.used or link.invalidated:
                self._fail("magic_link_reused" if link.used else "magic_link_invalidated", link.email, ip)
            if now >= link.expires_at:
                self._fail("magic_link_expired", link.email, ip)
            ok, why = self.guest_status(link.email)
            if not ok:
                self._fail(f"guest_{why}", link.email, ip)
            self._commit([self._event("magic_link_redeemed", link.email, ip=ip, link_id=link.link_id)])
            return self._new_session(link.email, KIND_GUEST, "magic_link", ip)

    def _fail(self, reason: str, email: Optional[str], ip: Optional[str]):
        self._audit_only("auth_failed", email, ip=ip, reason=reason)
        raise AccessError(reason, GENERIC_REDEEM_ERROR, status=400)

    def _audit_only(self, event_type: str, email: Optional[str], ip: Optional[str] = None,
                    **details) -> None:
        e = self._event(event_type, email, ip=ip, **details)
        try:
            self._p.append([e])
        except PersistenceError:
            logger.warning("Could not persist audit event %s", event_type)
        self._remember(e)

    # ---- staff login codes (OAuth callback -> SPA exchange) ---------------
    def issue_login_code(self, email: str, kind: str, method: str) -> str:
        """One-time, 60-second code the OAuth callback puts in the redirect
        fragment instead of a token; the SPA POSTs it to get a session."""
        code = secrets.token_urlsafe(32)
        with self._lock:
            now = self.now()
            self._login_codes = {k: v for k, v in self._login_codes.items() if v["exp"] > now}
            self._login_codes[hash_token(code)] = {
                "email": normalize_email(email), "kind": kind, "method": method,
                "exp": now + self.config.login_code_ttl}
        return code

    def exchange_login_code(self, code: str, ip: Optional[str] = None) -> SessionGrant:
        with self._lock:
            entry = self._login_codes.pop(hash_token(code or ""), None)
            if entry is None or self.now() >= entry["exp"]:
                self._audit_only("auth_failed", entry["email"] if entry else None, ip=ip,
                                 reason="login_code_invalid")
                raise AccessError("login_code_invalid", "Sign-in failed. Please try again.", status=400)
            return self._new_session(entry["email"], entry["kind"], entry["method"], ip)

    # ---- sessions ----------------------------------------------------------
    def create_staff_session(self, email: str, method: str, ip: Optional[str] = None) -> SessionGrant:
        with self._lock:
            return self._new_session(normalize_email(email), KIND_STAFF, method, ip)

    def _new_session(self, email: str, kind: str, method: str, ip: Optional[str]) -> SessionGrant:
        now = self.now()
        lifetime = self.config.guest_session_lifetime if kind == KIND_GUEST else self.config.staff_session_lifetime
        abs_exp = now + lifetime
        if kind == KIND_GUEST:
            g = self.guests.get(email)
            if g and g.expires_at:
                abs_exp = min(abs_exp, g.expires_at)
        sid = secrets.token_urlsafe(18)
        refresh = f"{sid}.{secrets.token_urlsafe(32)}"
        self._commit([
            self._event("session_created", email, ip=ip, session_id=sid, token_hash=hash_token(refresh),
                        kind=kind, method=method, abs_expires_at=_iso(abs_exp)),
            self._event("login_succeeded", email, ip=ip, session_id=sid, method=method, kind=kind),
        ], tolerate=self._tolerates(kind))
        return SessionGrant(sid=sid, email=email, kind=kind, refresh_token=refresh, abs_expires_at=abs_exp)

    def _tolerates(self, kind: str) -> bool:
        return kind == KIND_STAFF and self.config.staff_sessions_tolerate_log_outage

    def _check_session(self, s: Optional[Session], now: float) -> Session:
        if s is None:
            raise AccessError("session_unknown")
        if s.revoked:
            raise AccessError("session_revoked")
        if now >= s.abs_expires_at:
            raise AccessError("session_expired")
        if now - s.last_activity >= self.config.idle_timeout:
            raise AccessError("session_idle")
        if s.kind == KIND_GUEST:
            ok, why = self.guest_status(s.email)
            if not ok:
                raise AccessError(f"guest_{why}", "Your access has ended. Ask an administrator to renew it.",
                                  status=403)
        return s

    def validate(self, sid: str) -> Session:
        """Called on EVERY authenticated request. Touches idle activity."""
        with self._lock:
            now = self.now()
            s = self._check_session(self.sessions.get(sid or ""), now)
            s.last_activity = now
            return s

    def refresh(self, refresh_token: str, ip: Optional[str] = None) -> SessionGrant:
        """Rotate: returns a new refresh token and disables the presented one.
        A rotated token presented again after the grace window revokes the session."""
        sid = (refresh_token or "").split(".", 1)[0]
        th = hash_token(refresh_token or "")
        with self._lock:
            now = self.now()
            s = self.sessions.get(sid)
            if s is None:
                self._audit_only("auth_failed", None, ip=ip, reason="refresh_unknown")
                raise AccessError("refresh_unknown")
            if not hmac.compare_digest(s.refresh_hash, th):
                if s.prev_refresh_hash and hmac.compare_digest(s.prev_refresh_hash, th):
                    if s.rotated_at is not None and now - s.rotated_at <= self.config.refresh_reuse_grace:
                        raise AccessError("refresh_rotated", "Session refreshed in another tab.", status=409)
                    # Reuse after rotation: likely a stolen token. Kill the session.
                    self._commit([self._event("session_revoked", s.email, session_id=s.sid,
                                              reason="refresh_token_reuse")], removes_access=True)
                    self._audit_only("auth_failed", s.email, ip=ip, reason="refresh_token_reuse")
                    raise AccessError("refresh_token_reuse")
                self._audit_only("auth_failed", s.email, ip=ip, reason="refresh_mismatch")
                raise AccessError("refresh_mismatch")
            try:
                self._check_session(s, now)
            except AccessError as exc:
                self._audit_only("auth_failed", s.email, ip=ip, reason=exc.reason)
                raise
            new_refresh = f"{sid}.{secrets.token_urlsafe(32)}"
            self._commit([self._event("session_refreshed", s.email, ip=ip, session_id=sid,
                                      token_hash=hash_token(new_refresh))], tolerate=self._tolerates(s.kind))
            s.last_activity = now
            return SessionGrant(sid=sid, email=s.email, kind=s.kind, refresh_token=new_refresh,
                                abs_expires_at=s.abs_expires_at)

    def logout(self, sid: str) -> None:
        with self._lock:
            s = self.sessions.get(sid or "")
            if s and not s.revoked:
                self._commit([self._event("session_revoked", s.email, s.email, session_id=sid,
                                          reason="logout")], removes_access=True)

    def record_auth_failure(self, reason: str, email: Optional[str] = None, ip: Optional[str] = None) -> None:
        self._audit_only("auth_failed", email, ip=ip, reason=reason)

    # ---- admin views -------------------------------------------------------
    def active_session_count(self, email: str) -> int:
        now = self.now()
        n = 0
        for s in self.sessions.values():
            if s.email != email or s.revoked or now >= s.abs_expires_at:
                continue
            if now - s.last_activity >= self.config.idle_timeout:
                continue
            n += 1
        return n

    def guest_rows(self) -> list[dict]:
        now = self.now()
        with self._lock:
            rows = []
            for g in self.guests.values():
                rows.append({
                    "email": g.email,
                    "status": g.effective_status(now),
                    "organization": g.organization,
                    "reason": g.reason,
                    "grant": g.grant,
                    "requested_at": _iso(g.requested_at),
                    "invited_by": g.invited_by,
                    "decided_by": g.decided_by,
                    "decided_at": _iso(g.decided_at),
                    "expires_at": _iso(g.expires_at),
                    "days_left": (max(0, int((g.expires_at - now) // 86400)) if g.expires_at else None),
                    "whitelisted": g.email in self.whitelist,
                    "can_sign_in": self.guest_status(g.email)[0],
                    "last_login_at": _iso(g.last_login_at),
                    "active_sessions": self.active_session_count(g.email),
                })
            return sorted(rows, key=lambda r: (r["status"] != PENDING, r["email"]))

    def whitelist_rows(self) -> list[dict]:
        with self._lock:
            return [{"email": e, "added_by": v.get("added_by"), "added_at": _iso(v.get("added_at"))}
                    for e, v in sorted(self.whitelist.items())]

    def audit_rows(self, limit: int = 200) -> list[dict]:
        with self._lock:
            return list(reversed(self.audit[-limit:]))


# ── Rate limiting ────────────────────────────────────────────────────────────
class RateLimiter:
    """Sliding-window limiter, in memory (single process). `limits` is a list of
    (max_events, window_seconds); every limit must allow the event."""

    def __init__(self, limits: Iterable[tuple[int, int]], clock: Callable[[], float] = time.time,
                 max_keys: int = 10000):
        self.limits = list(limits)
        self._clock = clock
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()
        self._max_keys = max_keys

    def allow(self, key: str) -> bool:
        if not key:
            return True
        now = self._clock()
        longest = max(w for _, w in self.limits)
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < longest]
            for count, window in self.limits:
                if sum(1 for t in hits if now - t < window) >= count:
                    self._hits[key] = hits
                    return False
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > self._max_keys:
                for k in list(self._hits)[: len(self._hits) - self._max_keys]:
                    self._hits.pop(k, None)
            return True


# ── Mail ─────────────────────────────────────────────────────────────────────
class MailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class DisabledMailSender:
    """No mail configured: magic links cannot be delivered (guest sign-in off)."""
    configured = False

    def send(self, to: str, subject: str, body: str) -> None:
        logger.warning("Mail is not configured; a sign-in email could not be sent.")


class FileMailSender:
    """Local development only: writes each email to a file in `directory`
    (never to the log — the body contains a sign-in link)."""
    configured = True

    def __init__(self, directory: str):
        self.directory = directory

    def send(self, to: str, subject: str, body: str) -> None:
        import os
        os.makedirs(self.directory, exist_ok=True)
        name = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}.eml"
        with open(os.path.join(self.directory, name), "w", encoding="utf-8") as fh:
            fh.write(f"To: {to}\nSubject: {subject}\n\n{body}\n")


class SmtpMailSender:
    configured = True

    def __init__(self, host: str, port: int, username: Optional[str], password: Optional[str],
                 sender: str, starttls: bool = True, timeout: float = 20.0):
        self.host, self.port, self.username, self.password = host, port, username, password
        self.sender, self.starttls, self.timeout = sender, starttls, timeout

    def send(self, to: str, subject: str, body: str) -> None:
        import smtplib
        import ssl
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(body)
        ctx = ssl.create_default_context()
        if self.port == 465:
            with smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=ctx) as s:
                if self.username:
                    s.login(self.username, self.password or "")
                s.send_message(msg)
            return
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as s:
            if self.starttls:
                s.starttls(context=ctx)
            if self.username:
                s.login(self.username, self.password or "")
            s.send_message(msg)


def build_mail_sender(backend: Optional[str], *, smtp_host=None, smtp_port=587, smtp_username=None,
                      smtp_password=None, smtp_from=None, smtp_starttls=True, outbox_dir=None):
    backend = (backend or "").strip().lower()
    if backend == "smtp" and smtp_host and smtp_from:
        return SmtpMailSender(smtp_host, int(smtp_port or 587), smtp_username, smtp_password, smtp_from,
                              bool(smtp_starttls))
    if backend == "file" and outbox_dir:
        return FileMailSender(outbox_dir)
    return DisabledMailSender()


class JobQueue:
    """Runs jobs on one background thread, so an HTTP response never waits on
    (or reveals the timing of) whitelist checks, token issue or SMTP."""

    def __init__(self, name: str = "access-mail"):
        self._q: "queue.Queue[Callable[[], None]]" = queue.Queue(maxsize=1000)
        self._thread = threading.Thread(target=self._run, name=name, daemon=True)
        self._started = False
        self._lock = threading.Lock()

    def _ensure_started(self):
        with self._lock:
            if not self._started:
                self._thread.start()
                self._started = True

    def submit(self, job: Callable[[], None]) -> bool:
        self._ensure_started()
        try:
            self._q.put_nowait(job)
            return True
        except queue.Full:
            logger.warning("Access job queue is full; dropping a sign-in email job")
            return False

    def _run(self):
        while True:
            job = self._q.get()
            try:
                job()
            except Exception:  # noqa: BLE001 — a failed job must never kill the worker
                logger.exception("Access background job failed")
            finally:
                self._q.task_done()

    def drain(self, timeout: float = 5.0) -> None:
        """Tests: wait until queued jobs finish."""
        deadline = time.time() + timeout
        while self._q.unfinished_tasks and time.time() < deadline:
            time.sleep(0.01)


class InlineJobQueue:
    """Tests: run jobs immediately."""

    def submit(self, job: Callable[[], None]) -> bool:
        job()
        return True

    def drain(self, timeout: float = 0) -> None:
        return None


def magic_link_email(app_name: str, link: str, minutes: int = 15) -> tuple[str, str]:
    subject = f"Your {app_name} sign-in link"
    body = (
        f"Hello,\n\nUse the link below to sign in to {app_name}. It works once and expires in "
        f"{minutes} minutes.\n\n{link}\n\nThe link opens a page with a \"Sign in\" button — "
        "you are not signed in until you press it.\n\n"
        "If you did not ask for this, ignore this email; nobody can use it without access to your inbox.\n"
    )
    return subject, body
