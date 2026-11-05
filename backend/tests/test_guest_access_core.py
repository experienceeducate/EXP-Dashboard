"""
Behaviour of the shared guest-access core (identical in the EXP Training
Toolkit and the EXP Dashboard). Plan v1.3 §5 — every acceptance criterion that
lives in this layer has a test here, including the five revocation tests.
"""
import json

import pytest

try:  # EXP Dashboard layout
    from app.core import guest_access as ga
except ImportError:  # EXP Training Toolkit layout
    from core import guest_access as ga


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def persistence():
    return ga.MemoryPersistence()


@pytest.fixture
def store(persistence, clock):
    s = ga.AccessStore(persistence, clock=clock)
    s.load()
    return s


ADMIN = "admin@experienceeducate.org"
GRANT = {"role": "observer"}


def approved_guest(store, email, days=None):
    store.request_access(email, "Partner Org", "Reviewing the programme")
    store.approve(email, ADMIN, GRANT, days=days)
    store.whitelist_add(email, ADMIN)


def signed_in(store, email):
    token = store.issue_magic_link(email)
    assert token
    return store.redeem_magic_link(token)


# ── Request, approval and whitelist are separate controls ───────────────────
class TestApprovalAndWhitelist:
    def test_request_alone_cannot_authenticate(self, store):
        store.request_access("Guest@Example.org ", "Org", "Why")
        assert store.issue_magic_link("guest@example.org") is None
        assert store.guests["guest@example.org"].status == ga.PENDING

    def test_approved_but_not_whitelisted_cannot_authenticate(self, store):
        store.request_access("g@example.org", "Org", "Why")
        store.approve("g@example.org", ADMIN, GRANT)
        assert store.issue_magic_link("g@example.org") is None

    def test_whitelisted_but_not_approved_cannot_authenticate(self, store):
        store.request_access("g@example.org", "Org", "Why")
        store.whitelist_add("g@example.org", ADMIN)
        assert store.issue_magic_link("g@example.org") is None

    def test_approved_and_whitelisted_can_authenticate(self, store):
        approved_guest(store, "g@example.org")
        assert store.issue_magic_link("g@example.org")

    def test_removed_from_whitelist_cannot_authenticate(self, store):
        approved_guest(store, "g@example.org")
        grant = signed_in(store, "g@example.org")
        store.whitelist_remove("g@example.org", ADMIN)
        assert store.issue_magic_link("g@example.org") is None
        with pytest.raises(ga.AccessError):
            store.validate(grant.sid)

    def test_emails_are_normalised_and_exact(self, store):
        approved_guest(store, "  Mixed.Case@Example.ORG ")
        assert store.issue_magic_link("mixed.case@example.org")
        # Exact match only: no domain wildcard.
        assert store.issue_magic_link("other@example.org") is None

    def test_invalid_email_rejected(self, store):
        with pytest.raises(ValueError):
            store.request_access("not-an-email", None, None)

    def test_rejected_guest_cannot_authenticate(self, store):
        approved_guest(store, "g@example.org")
        store.reject("g@example.org", ADMIN, "no longer needed")
        assert store.issue_magic_link("g@example.org") is None

    def test_invite_approves_and_whitelists(self, store):
        store.invite("new@example.org", ADMIN, GRANT, organization="Org")
        assert store.guests["new@example.org"].invited_by == ADMIN
        assert "new@example.org" in store.whitelist
        assert store.issue_magic_link("new@example.org")

    def test_request_cannot_downgrade_an_approved_guest(self, store):
        approved_guest(store, "g@example.org")
        store.request_access("g@example.org", "Org", "again")
        assert store.guests["g@example.org"].status == ga.APPROVED


# ── Magic links ──────────────────────────────────────────────────────────────
class TestMagicLinks:
    def test_single_use(self, store):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        store.redeem_magic_link(token)
        with pytest.raises(ga.AccessError) as exc:
            store.redeem_magic_link(token)
        assert exc.value.public == ga.GENERIC_REDEEM_ERROR

    def test_expires_after_15_minutes(self, store, clock):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        clock.advance(15 * 60)
        with pytest.raises(ga.AccessError):
            store.redeem_magic_link(token)

    def test_still_valid_just_before_expiry(self, store, clock):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        clock.advance(15 * 60 - 1)
        assert store.redeem_magic_link(token).email == "g@example.org"

    def test_new_link_invalidates_earlier_links(self, store):
        approved_guest(store, "g@example.org")
        first = store.issue_magic_link("g@example.org")
        second = store.issue_magic_link("g@example.org")
        with pytest.raises(ga.AccessError):
            store.redeem_magic_link(first)
        assert store.redeem_magic_link(second)

    def test_link_bound_to_its_email(self, store):
        approved_guest(store, "a@example.org")
        approved_guest(store, "b@example.org")
        grant = store.redeem_magic_link(store.issue_magic_link("a@example.org"))
        assert grant.email == "a@example.org" and grant.kind == ga.KIND_GUEST

    def test_only_a_hash_is_stored(self, store, persistence):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        dump = json.dumps(persistence.events)
        assert token not in dump
        assert ga.hash_token(token) in dump

    def test_unknown_token_gives_the_generic_error(self, store):
        with pytest.raises(ga.AccessError) as exc:
            store.redeem_magic_link("nope")
        assert exc.value.public == ga.GENERIC_REDEEM_ERROR and exc.value.status == 400

    def test_guest_revoked_between_issue_and_redeem(self, store):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        store.revoke("g@example.org", ADMIN)
        with pytest.raises(ga.AccessError):
            store.redeem_magic_link(token)


# ── Expiry and renewal ───────────────────────────────────────────────────────
class TestExpiry:
    def test_default_access_is_90_days(self, store, clock):
        approved_guest(store, "g@example.org")
        g = store.guests["g@example.org"]
        assert g.expires_at == pytest.approx(clock.t + 90 * 86400)

    def test_expired_guest_cannot_authenticate_until_renewed(self, store, clock):
        approved_guest(store, "g@example.org", days=1)
        clock.advance(86400)
        assert store.guest_rows()[0]["status"] == "expired"
        assert store.issue_magic_link("g@example.org") is None
        store.renew("g@example.org", ADMIN)
        assert store.issue_magic_link("g@example.org")

    def test_session_never_outlives_access_end_date(self, store, clock):
        approved_guest(store, "g@example.org", days=1)
        clock.advance(86400 - 60)
        grant = signed_in(store, "g@example.org")
        assert grant.abs_expires_at <= store.guests["g@example.org"].expires_at
        clock.advance(61)
        with pytest.raises(ga.AccessError):
            store.validate(grant.sid)

    def test_revoked_guest_cannot_be_renewed_by_mistake(self, store):
        approved_guest(store, "g@example.org")
        store.revoke("g@example.org", ADMIN)
        with pytest.raises(ga.ConflictError):
            store.renew("g@example.org", ADMIN)

    def test_days_bounds(self, store):
        store.request_access("g@example.org", None, None)
        with pytest.raises(ValueError):
            store.approve("g@example.org", ADMIN, GRANT, days=0)
        with pytest.raises(ValueError):
            store.approve("g@example.org", ADMIN, GRANT, days=10_000)


# ── Sessions ─────────────────────────────────────────────────────────────────
class TestSessions:
    def test_every_login_creates_a_new_session_id(self, store):
        approved_guest(store, "g@example.org")
        a = signed_in(store, "g@example.org")
        b = signed_in(store, "g@example.org")
        assert a.sid != b.sid

    def test_refresh_rotates_and_old_refresh_token_stops_working(self, store, clock):
        approved_guest(store, "g@example.org")
        grant = signed_in(store, "g@example.org")
        new = store.refresh(grant.refresh_token)
        assert new.refresh_token != grant.refresh_token and new.sid == grant.sid
        clock.advance(ga.REFRESH_REUSE_GRACE_SECONDS + 1)
        with pytest.raises(ga.AccessError) as exc:
            store.refresh(grant.refresh_token)
        assert exc.value.reason == "refresh_token_reuse"
        # Reuse is treated as theft: the whole session is dead.
        with pytest.raises(ga.AccessError):
            store.validate(new.sid)

    def test_concurrent_tab_reuse_inside_grace_is_a_409_not_a_revocation(self, store):
        approved_guest(store, "g@example.org")
        grant = signed_in(store, "g@example.org")
        new = store.refresh(grant.refresh_token)
        with pytest.raises(ga.AccessError) as exc:
            store.refresh(grant.refresh_token)
        assert exc.value.status == 409
        assert store.validate(new.sid)

    def test_idle_timeout(self, store, clock):
        grant = store.create_staff_session("staff@experienceeducate.org", "google")
        clock.advance(store.config.idle_timeout)
        with pytest.raises(ga.AccessError) as exc:
            store.validate(grant.sid)
        assert exc.value.reason == "session_idle"

    def test_activity_keeps_session_alive(self, store, clock):
        grant = store.create_staff_session("staff@experienceeducate.org", "google")
        for _ in range(5):
            clock.advance(store.config.idle_timeout - 10)
            store.validate(grant.sid)

    def test_absolute_lifetime(self, store, clock):
        grant = store.create_staff_session("staff@experienceeducate.org", "google")
        for _ in range(int(store.config.staff_session_lifetime // 1000) + 1):
            clock.advance(1000)
            try:
                store.validate(grant.sid)
            except ga.AccessError as exc:
                assert exc.reason == "session_expired"
                return
        pytest.fail("session outlived its absolute lifetime")

    def test_logout_revokes(self, store):
        grant = store.create_staff_session("staff@experienceeducate.org", "google")
        store.logout(grant.sid)
        with pytest.raises(ga.AccessError):
            store.validate(grant.sid)
        with pytest.raises(ga.AccessError):
            store.refresh(grant.refresh_token)

    def test_login_code_single_use_and_short_lived(self, store, clock):
        code = store.issue_login_code("Staff@ExperienceEducate.org", ga.KIND_STAFF, "google")
        assert store.exchange_login_code(code).email == "staff@experienceeducate.org"
        with pytest.raises(ga.AccessError):
            store.exchange_login_code(code)
        code2 = store.issue_login_code("staff@experienceeducate.org", ga.KIND_STAFF, "google")
        clock.advance(ga.LOGIN_CODE_TTL_SECONDS)
        with pytest.raises(ga.AccessError):
            store.exchange_login_code(code2)

    def test_refresh_token_never_persisted_in_clear(self, store, persistence):
        grant = store.create_staff_session("staff@experienceeducate.org", "google")
        new = store.refresh(grant.refresh_token)
        dump = json.dumps(persistence.events)
        assert grant.refresh_token not in dump and new.refresh_token not in dump


# ── Revocation: the plan's five required tests (§5 Revocation requirements) ─
class TestRevokeAllFor:
    @pytest.fixture
    def two_guests_and_staff(self, store):
        approved_guest(store, "target@example.org")
        approved_guest(store, "bystander@example.org")
        target = [signed_in(store, "target@example.org") for _ in range(3)]
        bystander = signed_in(store, "bystander@example.org")
        staff = store.create_staff_session("staff@experienceeducate.org", "google")
        return target, bystander, staff

    def test_1_revokes_all_sessions_of_the_selected_guest_only(self, store, two_guests_and_staff):
        target, bystander, staff = two_guests_and_staff
        assert store.revoke_all_for("target@example.org", ADMIN) == 3
        for g in target:
            with pytest.raises(ga.AccessError):
                store.validate(g.sid)
        assert store.validate(bystander.sid).email == "bystander@example.org"
        assert store.validate(staff.sid).email == "staff@experienceeducate.org"

    def test_2_invalidates_refresh_tokens(self, store, two_guests_and_staff):
        target, bystander, _ = two_guests_and_staff
        store.revoke_all_for("target@example.org", ADMIN)
        for g in target:
            with pytest.raises(ga.AccessError):
                store.refresh(g.refresh_token)
        assert store.refresh(bystander.refresh_token)

    def test_3_revoked_sessions_cannot_be_renewed(self, store, two_guests_and_staff, clock):
        target, _, _ = two_guests_and_staff
        rotated = store.refresh(target[0].refresh_token)
        store.revoke_all_for("target@example.org", ADMIN)
        for token in (rotated.refresh_token, target[1].refresh_token):
            with pytest.raises(ga.AccessError):
                store.refresh(token)
        clock.advance(3600)
        with pytest.raises(ga.AccessError):
            store.refresh(rotated.refresh_token)

    def test_4_invalidates_pending_magic_links(self, store, two_guests_and_staff):
        token = store.issue_magic_link("target@example.org")
        other = store.issue_magic_link("bystander@example.org")
        store.revoke_all_for("target@example.org", ADMIN)
        with pytest.raises(ga.AccessError):
            store.redeem_magic_link(token)
        assert store.redeem_magic_link(other).email == "bystander@example.org"

    def test_5_takes_effect_immediately_not_at_expiry(self, store, two_guests_and_staff, clock):
        target, _, _ = two_guests_and_staff
        store.validate(target[0].sid)          # valid a moment ago
        store.revoke_all_for("target@example.org", ADMIN)
        # No clock movement: the very next request is refused even though the
        # 15-minute access token and the session lifetime have not run out.
        with pytest.raises(ga.AccessError) as exc:
            store.validate(target[0].sid)
        assert exc.value.reason == "session_revoked"

    def test_revocation_survives_a_restart(self, store, persistence, clock, two_guests_and_staff):
        target, bystander, _ = two_guests_and_staff
        store.revoke("target@example.org", ADMIN)
        reborn = ga.AccessStore(persistence, clock=clock)
        reborn.load()
        with pytest.raises(ga.AccessError):
            reborn.validate(target[0].sid)
        assert reborn.validate(bystander.sid)
        assert reborn.issue_magic_link("target@example.org") is None

    def test_removal_applies_even_if_the_log_write_fails(self, store, persistence, two_guests_and_staff):
        target, _, _ = two_guests_and_staff
        persistence.fail_next = True
        with pytest.raises(ga.PersistenceError):
            store.revoke_all_for("target@example.org", ADMIN)
        with pytest.raises(ga.AccessError):
            store.validate(target[0].sid)

    def test_staff_sign_in_survives_a_log_outage_but_guests_do_not(self, store, persistence):
        approved_guest(store, "g@example.org")
        token = store.issue_magic_link("g@example.org")
        persistence.fail_next = True
        staff = store.create_staff_session("staff@experienceeducate.org", "google")
        assert store.validate(staff.sid)
        persistence.fail_next = True
        with pytest.raises(ga.PersistenceError):
            store.redeem_magic_link(token)

    def test_grants_are_not_applied_if_the_log_write_fails(self, store, persistence):
        store.request_access("g@example.org", None, None)
        persistence.fail_next = True
        with pytest.raises(ga.PersistenceError):
            store.approve("g@example.org", ADMIN, GRANT)
        assert store.guests["g@example.org"].status == ga.PENDING


# ── Fail closed, restart, audit ──────────────────────────────────────────────
class TestDurabilityAndAudit:
    def test_state_rebuilds_from_the_log(self, store, persistence, clock):
        approved_guest(store, "g@example.org")
        grant = signed_in(store, "g@example.org")
        reborn = ga.AccessStore(persistence, clock=clock)
        reborn.load()
        assert reborn.validate(grant.sid).email == "g@example.org"
        assert reborn.refresh(grant.refresh_token)

    def test_unloadable_log_fails_closed(self, clock):
        class Broken:
            def load(self):
                raise RuntimeError("table missing")

            def append(self, events):
                raise ga.PersistenceError("x")

        s = ga.AccessStore(Broken(), clock=clock)
        s.load()
        assert not s.loaded and s.load_error
        assert s.issue_magic_link("g@example.org") is None

    def test_audit_records_lifecycle_without_tokens(self, store, persistence):
        approved_guest(store, "g@example.org")
        grant = signed_in(store, "g@example.org")
        store.renew("g@example.org", ADMIN)
        store.revoke("g@example.org", ADMIN)
        types = [e["event_type"] for e in persistence.events]
        for expected in ("guest_access_requested", "guest_approved", "whitelist_added",
                         "magic_link_issued", "magic_link_redeemed", "session_created",
                         "login_succeeded", "guest_renewed", "guest_revoked", "session_revoked"):
            assert expected in types
        assert grant.refresh_token not in json.dumps(store.audit_rows(1000))

    def test_failed_redemption_is_audited(self, store, persistence):
        with pytest.raises(ga.AccessError):
            store.redeem_magic_link("garbage")
        assert any(e["event_type"] == "auth_failed" for e in persistence.events)


# ── Rate limiting and background jobs ────────────────────────────────────────
class TestRateLimiterAndQueue:
    def test_sliding_window(self, clock):
        rl = ga.RateLimiter([(3, 60)], clock=clock)
        assert all(rl.allow("ip:1") for _ in range(3))
        assert not rl.allow("ip:1")
        assert rl.allow("ip:2")
        clock.advance(61)
        assert rl.allow("ip:1")

    def test_multiple_windows(self, clock):
        rl = ga.RateLimiter([(2, 60), (3, 3600)], clock=clock)
        assert rl.allow("k") and rl.allow("k") and not rl.allow("k")
        clock.advance(61)
        assert rl.allow("k") and not rl.allow("k")

    def test_job_queue_runs_jobs_off_the_request_thread(self):
        q = ga.JobQueue("test-q")
        done = []
        q.submit(lambda: done.append(1))
        q.drain()
        assert done == [1]

    def test_build_mail_sender(self, tmp_path):
        assert isinstance(ga.build_mail_sender(None), ga.DisabledMailSender)
        assert isinstance(ga.build_mail_sender("smtp"), ga.DisabledMailSender)  # incomplete config
        sender = ga.build_mail_sender("file", outbox_dir=str(tmp_path))
        sender.send("a@b.org", "s", "body")
        assert len(list(tmp_path.iterdir())) == 1
