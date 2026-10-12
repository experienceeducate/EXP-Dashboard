"""Credential resolution for the BigQuery client.

Two supported paths, and which one is taken must stay predictable: a deploy
sets GOOGLE_SERVICE_ACCOUNT_KEY and uses the mounted service-account key;
local development leaves it empty and authenticates the developer via
Application Default Credentials. See core/database.py's _load_credentials().
"""
import google.auth
import pytest
from google.auth.exceptions import DefaultCredentialsError

from app.core import database


class _FakeCreds:
    """Stands in for a google.auth credentials object."""


def test_key_path_configured_uses_the_service_account_file(monkeypatch):
    seen = {}

    def fake_from_file(path, scopes=None):
        seen["path"] = path
        seen["scopes"] = scopes
        return _FakeCreds()

    monkeypatch.setattr(database.settings, "GOOGLE_SERVICE_ACCOUNT_KEY", "/var/secrets/gcp/key.json")
    monkeypatch.setattr(database.service_account.Credentials, "from_service_account_file", fake_from_file)

    creds = database._load_credentials()

    assert isinstance(creds, _FakeCreds)
    assert seen["path"] == "/var/secrets/gcp/key.json"
    assert seen["scopes"] == database._SCOPES


def test_key_path_configured_never_consults_adc(monkeypatch):
    """A deploy must not silently fall through to a developer's own identity."""
    monkeypatch.setattr(database.settings, "GOOGLE_SERVICE_ACCOUNT_KEY", "/var/secrets/gcp/key.json")
    monkeypatch.setattr(
        database.service_account.Credentials,
        "from_service_account_file",
        lambda path, scopes=None: _FakeCreds(),
    )

    def _boom(*a, **k):
        raise AssertionError("ADC must not be consulted when a key path is set")

    monkeypatch.setattr(google.auth, "default", _boom)

    assert isinstance(database._load_credentials(), _FakeCreds)


def test_empty_key_path_falls_back_to_application_default_credentials(monkeypatch):
    """The local-dev path: no key file on disk, authenticate as the developer."""
    called = {}

    def fake_default(scopes=None):
        called["scopes"] = scopes
        return _FakeCreds(), "some-project"

    monkeypatch.setattr(database.settings, "GOOGLE_SERVICE_ACCOUNT_KEY", "")
    monkeypatch.setattr(google.auth, "default", fake_default)

    creds = database._load_credentials()

    assert isinstance(creds, _FakeCreds)
    assert called["scopes"] == database._SCOPES


def test_whitespace_only_key_path_is_treated_as_unset(monkeypatch):
    """A blank value in .env must not be read as a filename."""
    monkeypatch.setattr(database.settings, "GOOGLE_SERVICE_ACCOUNT_KEY", "   ")
    monkeypatch.setattr(google.auth, "default", lambda scopes=None: (_FakeCreds(), "p"))

    assert isinstance(database._load_credentials(), _FakeCreds)


def test_no_key_and_no_adc_raises_naming_both_options(monkeypatch):
    """Losing the key in a deploy used to crash-loop with a clear message
    (docs/CONTEXT.md). Making the setting optional must not turn that into a
    silent, confusing failure — the error still has to say what to do."""

    def fake_default(scopes=None):
        raise DefaultCredentialsError("could not automatically determine credentials")

    monkeypatch.setattr(database.settings, "GOOGLE_SERVICE_ACCOUNT_KEY", "")
    monkeypatch.setattr(google.auth, "default", fake_default)

    with pytest.raises(RuntimeError) as exc:
        database._load_credentials()

    message = str(exc.value)
    assert "GOOGLE_SERVICE_ACCOUNT_KEY" in message
    assert "application-default login" in message
