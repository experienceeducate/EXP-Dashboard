from app.core.access import resolve_access
from app.core.sql import access_clause


def test_resolve_national():
    # Explicitly listed national user → full access, NOT national_only.
    a = resolve_access("admin@experienceeducate.org")
    assert a.has_national is True
    assert a.national_only is False
    assert a.has_any_access is True


def test_resolve_domain_user_is_national_only():
    # Any other @experienceeducate.org email → National view only.
    a = resolve_access("nobody.special@experienceeducate.org")
    assert a.has_national is True
    assert a.national_only is True


def test_resolve_regional():
    a = resolve_access("central@experienceeducate.org")
    assert a.has_national is False
    assert a.regions == ["Central"]
    assert a.national_only is False


def test_resolve_cu():
    a = resolve_access("cu@experienceeducate.org")
    assert a.cus == ["mpigi"]


def test_resolve_unknown_has_no_access():
    a = resolve_access("stranger@example.com")
    assert a.has_any_access is False


def test_access_clause_national_is_empty():
    a = resolve_access("admin@experienceeducate.org")
    clause, params = access_clause(a)
    assert clause == ""
    assert params == []


def test_access_clause_regional_and_cu():
    a = resolve_access("central@experienceeducate.org")
    clause, params = access_clause(a)
    assert "region IN UNNEST" in clause
    assert len(params) == 1


def test_login_wrong_password(client, client_headers):
    r = client.post(
        "/api/auth/login",
        json={"email": "admin@experienceeducate.org", "password": "nope"},
        headers=client_headers,
    )
    assert r.status_code == 401


def test_login_ok_returns_token(client, client_headers):
    r = client.post(
        "/api/auth/login",
        json={"email": "admin@experienceeducate.org", "password": "test-password"},
        headers=client_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["user"]["hasNational"] is True


def test_login_no_access_email_403(client, client_headers):
    r = client.post(
        "/api/auth/login",
        json={"email": "stranger@example.com", "password": "test-password"},
        headers=client_headers,
    )
    assert r.status_code == 403
