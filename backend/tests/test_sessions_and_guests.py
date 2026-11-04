"""Server-side sessions, Google login codes, guest access and the security
review's access-control fixes (DATA-894, plan v1.3 §5).

The store's own rules (single-use links, refresh rotation, revoke_all_for
scoping, …) are pinned in test_guest_access_core.py; these tests pin the HTTP
layer: what each endpoint returns, who may call it, and that guests never get
more than the one region/CU they were approved for.
"""
from __future__ import annotations

import time

import pytest
import jwt

from app.auth import create_token
from app.core import access_runtime
from app.core import guest_access as ga
from app.core.access import resolve_access
from app.core.config import settings

H = {"X-Exp-Client": "dashboard-v1"}
MANAGER = "access-manager@experienceeducate.org"
VIEW_ADMIN = "analytics-admin@experienceeducate.org"
GUEST = "partner@example.org"


def _auth(token):
    return {**H, "Authorization": f"Bearer {token}"}


class _Outbox:
    configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body):
        self.sent.append((to, subject, body))

    def last_token(self):
        body = self.sent[-1][2]
        return body.split("#magic=")[1].split()[0]


@pytest.fixture
def outbox(monkeypatch):
    box = _Outbox()
    access_runtime.reset_for_tests(sender=box)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://dash.example")
    return box


# ── tokens & sessions ────────────────────────────────────────────────────────
def test_token_without_session_id_is_refused(client):
    now = int(time.time())
    legacy = jwt.encode({"sub": "admin@experienceeducate.org", "iat": now, "exp": now + 600},
                        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    assert client.get("/api/auth/me", headers=_auth(legacy)).status_code == 401


def test_token_for_unknown_session_is_refused(client):
    token = create_token(resolve_access("admin@experienceeducate.org"), "no-such-session")
    assert client.get("/api/auth/me", headers=_auth(token)).status_code == 401


def test_alg_none_token_is_refused(client, make_token):
    good = make_token("admin@experienceeducate.org")
    claims = jwt.decode(good, options={"verify_signature": False})
    import base64
    import json

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    forged = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}."
    assert client.get("/api/auth/me", headers=_auth(forged)).status_code == 401


def test_staff_me_reports_session(client, make_token):
    r = client.get("/api/auth/me", headers=_auth(make_token("admin@experienceeducate.org")))
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["authKind"] == "staff"
    assert user["sessionExpiresAt"]


def test_logout_revokes_session_immediately(client, make_token):
    token = make_token("admin@experienceeducate.org")
    assert client.post("/api/auth/logout", headers=_auth(token)).status_code == 200
    assert client.get("/api/auth/me", headers=_auth(token)).status_code == 401


def test_login_code_exchange_and_refresh_rotation(client):
    code = access_runtime.store.issue_login_code("admin@experienceeducate.org", ga.KIND_STAFF, "google")
    r = client.post("/api/auth/session/exchange", json={"code": code}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["auth_kind"] == "staff" and body["expires_in"] == ga.ACCESS_TOKEN_SECONDS
    # Single use.
    assert client.post("/api/auth/session/exchange", json={"code": code}, headers=H).status_code == 400

    r2 = client.post("/api/auth/session/refresh", json={"refresh_token": body["refresh_token"]}, headers=H)
    assert r2.status_code == 200
    assert r2.json()["refresh_token"] != body["refresh_token"]
    assert client.get("/api/auth/me", headers=_auth(r2.json()["token"])).status_code == 200


def test_auth_config_is_public(client):
    r = client.get("/api/auth/config", headers=H)
    assert r.status_code == 200
    assert set(r.json()) >= {"google", "guest_sign_in_available"}


def test_api_docs_are_off_by_default(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


# ── guest request / magic link ───────────────────────────────────────────────
def test_request_access_is_generic_and_records_pending(client):
    r = client.post("/api/auth/request-access",
                    json={"email": " Partner@Example.org ", "organization": "Partner NGO", "reason": "Review"},
                    headers=H)
    assert r.status_code == 202
    assert r.json()["message"] == ga.GENERIC_REQUEST_MESSAGE
    assert access_runtime.store.guests[GUEST].status == ga.PENDING


def test_magic_link_response_is_identical_for_unknown_and_approved(client, outbox):
    unknown = client.post("/api/auth/magic-link", json={"email": "nobody@example.org"}, headers=H)
    access_runtime.store.invite(GUEST, MANAGER, {"scope_type": "regional", "scope_key": "Central"})
    known = client.post("/api/auth/magic-link", json={"email": GUEST}, headers=H)
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert [s[0] for s in outbox.sent] == [GUEST]


def test_pending_guest_gets_no_link(client, outbox):
    access_runtime.store.request_access(GUEST, "NGO", "why")
    client.post("/api/auth/magic-link", json={"email": GUEST}, headers=H)
    assert outbox.sent == []


def test_approved_but_not_whitelisted_guest_gets_no_link(client, outbox):
    store = access_runtime.store
    store.request_access(GUEST, "NGO", "why")
    store.approve(GUEST, MANAGER, {"scope_type": "regional", "scope_key": "Central"})
    client.post("/api/auth/magic-link", json={"email": GUEST}, headers=H)
    assert outbox.sent == []


def test_magic_link_redeem_once_gives_scoped_guest_session(client, outbox):
    access_runtime.store.invite(GUEST, MANAGER, {"scope_type": "cu", "scope_key": "mpigi"})
    client.post("/api/auth/magic-link", json={"email": GUEST}, headers=H)
    token = outbox.last_token()
    assert "#magic=" in outbox.sent[-1][2] and "?" not in outbox.sent[-1][2].split("#magic=")[0][-1:]

    r = client.post("/api/auth/magic-link/redeem", json={"token": token}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["auth_kind"] == "guest"
    assert body["user"]["cus"] == ["mpigi"] and body["user"]["regions"] == []
    assert body["user"]["hasNational"] is False and body["user"]["isAdmin"] is False

    again = client.post("/api/auth/magic-link/redeem", json={"token": token}, headers=H)
    assert again.status_code == 400
    assert again.json()["detail"] == ga.GENERIC_REDEEM_ERROR


def test_guest_on_admin_lists_still_gets_only_their_scope(client, make_guest_token, monkeypatch):
    """Even if a guest's address were on the admin/national lists, the guest
    path never grants national, admin or access-manager rights."""
    from app.core import access as access_mod

    cfg = dict(access_mod.ACCESS_CONFIG)
    cfg["national"] = list(cfg["national"]) + [GUEST]
    cfg["admin"] = list(cfg["admin"]) + [GUEST]
    cfg["access_managers"] = list(cfg["access_managers"]) + [GUEST]
    monkeypatch.setattr(access_mod, "get_live_config", lambda: cfg)
    token = make_guest_token(GUEST, "regional", "Central")
    user = client.get("/api/auth/me", headers=_auth(token)).json()["user"]
    assert user == {**user, "hasNational": False, "isAdmin": False, "canManageAccess": False, "regions": ["Central"]}
    assert client.get("/api/admin/guests", headers=_auth(token)).status_code == 403


def test_revoking_a_guest_ends_their_session_now(client, make_guest_token, make_token):
    token = make_guest_token(GUEST)
    assert client.get("/api/auth/me", headers=_auth(token)).status_code == 200
    r = client.post("/api/admin/guests/revoke", json={"email": GUEST}, headers=_auth(make_token(MANAGER)))
    assert r.status_code == 200 and r.json()["sessionsRevoked"] == 1
    assert client.get("/api/auth/me", headers=_auth(token)).status_code == 401


def test_removing_from_whitelist_ends_their_session(client, make_guest_token, make_token):
    token = make_guest_token(GUEST)
    r = client.post("/api/admin/guests/whitelist/remove", json={"email": GUEST}, headers=_auth(make_token(MANAGER)))
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=_auth(token)).status_code == 401


def test_rate_limit_by_ip_returns_429(client):
    access_runtime.ip_limiter._hits.clear()
    codes = [client.post("/api/auth/magic-link", json={"email": f"x{i}@example.org"}, headers=H).status_code
             for i in range(12)]
    assert codes[:10] == [202] * 10 and codes[-1] == 429


def test_rate_limit_by_email_is_silent(client, outbox):
    access_runtime.store.invite(GUEST, MANAGER, {"scope_type": "regional", "scope_key": "Central"})
    for _ in range(5):
        assert client.post("/api/auth/magic-link", json={"email": GUEST}, headers=H).status_code == 202
    assert len(outbox.sent) == 3


def test_guest_grant_fails_closed_when_log_unwritable(client, make_token):
    class Broken(ga.MemoryPersistence):
        def append(self, events):
            raise ga.PersistenceError("down")

    access_runtime.reset_for_tests(ga.AccessStore(Broken()))
    token = make_token(MANAGER)  # staff session tolerates the outage (in memory)
    r = client.post("/api/admin/guests/invite",
                    json={"email": GUEST, "scope_type": "regional", "scope_key": "Central"}, headers=_auth(token))
    assert r.status_code == 502
    ok, _ = access_runtime.store.guest_status(GUEST)
    assert ok is False


# ── admin guest panel ────────────────────────────────────────────────────────
def test_view_admin_can_list_but_not_change(client, make_token):
    token = make_token(VIEW_ADMIN)
    r = client.get("/api/admin/guests", headers=_auth(token))
    assert r.status_code == 200 and r.json()["canEdit"] is False
    assert "Central" in r.json()["scopes"]["regional"]
    r = client.post("/api/admin/guests/invite",
                    json={"email": GUEST, "scope_type": "regional", "scope_key": "Central"}, headers=_auth(token))
    assert r.status_code == 403


def test_non_admin_cannot_view_guests(client, make_token):
    assert client.get("/api/admin/guests", headers=_auth(make_token("central@experienceeducate.org"))).status_code == 403


def test_manager_approve_flow_and_audit(client, make_token):
    token = make_token(MANAGER)
    access_runtime.store.request_access(GUEST, "NGO", "why")
    listing = client.get("/api/admin/guests", headers=_auth(token)).json()
    assert [r["email"] for r in listing["requests"]] == [GUEST]

    r = client.post("/api/admin/guests/approve",
                    json={"email": GUEST, "scope_type": "cu", "scope_key": "MPIGI", "days": 30}, headers=_auth(token))
    assert r.status_code == 200
    g = access_runtime.store.guests[GUEST]
    assert g.grant == {"scope_type": "cu", "scope_key": "mpigi"}
    assert GUEST in access_runtime.store.whitelist
    assert 29 <= (g.expires_at - time.time()) / 86400 <= 30

    renewed = client.post("/api/admin/guests/renew", json={"email": GUEST}, headers=_auth(token))
    assert renewed.status_code == 200 and renewed.json()["expiresAt"]

    events = client.get("/api/admin/guests/audit", headers=_auth(token)).json()["events"]
    kinds = {e["event_type"] for e in events}
    assert {"guest_access_requested", "guest_approved", "whitelist_added", "guest_renewed"} <= kinds
    assert all("token" not in str(e.get("details") or "").lower() for e in events)


def test_approve_rejects_unknown_scope_and_national(client, make_token):
    token = make_token(MANAGER)
    access_runtime.store.request_access(GUEST, "NGO", "why")
    bad = client.post("/api/admin/guests/approve",
                      json={"email": GUEST, "scope_type": "regional", "scope_key": "Atlantis"}, headers=_auth(token))
    assert bad.status_code == 422
    national = client.post("/api/admin/guests/approve",
                           json={"email": GUEST, "scope_type": "national", "scope_key": "all"}, headers=_auth(token))
    assert national.status_code == 422


def test_approve_unknown_email_404(client, make_token):
    r = client.post("/api/admin/guests/approve",
                    json={"email": "ghost@example.org", "scope_type": "regional", "scope_key": "Central"},
                    headers=_auth(make_token(MANAGER)))
    assert r.status_code == 404


# ── national-view-only tier & other access fixes ─────────────────────────────
NATIONAL_ONLY = "someone@experienceeducate.org"


@pytest.mark.parametrize("path", [
    "/api/cu?cu=mpigi",
    "/api/mentor-quality/mentors?cu=mpigi",
    "/api/mentor-quality/mentor-observations?mentor_id=1",
    "/api/mentor-quality/comments",
    "/api/mentor-quality/group-mentoring/mentors?cu=mpigi",
    "/api/mentor-quality/group-mentoring/comments",
    "/api/mentor-quality/skills-day/mentors?cu=mpigi",
    "/api/mentor-quality/skills-day/comments",
    "/api/elab/mentors?cu=mpigi",
])
def test_national_only_cannot_open_person_level_detail(client, make_token, monkeypatch, path):
    from app.core import database

    monkeypatch.setattr(database, "run_query", lambda *a, **k: [])
    r = client.get(path, headers=_auth(make_token(NATIONAL_ONLY)))
    assert r.status_code in (403, 422), (path, r.status_code)
    if r.status_code == 422:  # path needs other params; the dependency must still be the gate
        pytest.fail(f"{path} needs extra query params for this test")


def test_national_only_cannot_change_task_status(client, make_token, monkeypatch):
    from app.core import database

    monkeypatch.setattr(database, "insert_rows", lambda *a, **k: [])
    r = client.post("/api/tasks", json={"issue_key": "mpigi_x_y", "region": "Central", "cu": "mpigi", "status": "open"},
                    headers=_auth(make_token(NATIONAL_ONLY)))
    assert r.status_code == 403


def test_cu_user_cannot_post_another_cus_issue_key(client, make_token, monkeypatch):
    from app.core import database

    monkeypatch.setattr(database, "insert_rows", lambda *a, **k: [])
    r = client.post("/api/tasks", json={"issue_key": "wakiso_lec_x", "region": "", "cu": "mpigi", "status": "resolved"},
                    headers=_auth(make_token("cu@experienceeducate.org")))
    assert r.status_code == 422


def test_access_mapping_only_accepts_domain_addresses(client, make_token, monkeypatch):
    from app.core import database

    monkeypatch.setattr(database, "insert_rows", lambda *a, **k: [])
    r = client.post("/api/admin/access/mapping",
                    json={"scope_type": "cu", "scope_key": "mpigi", "add_email": "someone@gmail.com"},
                    headers=_auth(make_token(MANAGER)))
    assert r.status_code == 422
