"""Access-mapping editor: merge precedence, view/edit gating, write shape.

Every test that expects fresh dynamic-mapping data clears
``access._DYNAMIC_MAPPING_CACHE`` first — it's a small module-level TTL
cache shared across the whole test run (any earlier test's `current_user()`
call may have already populated it with an empty result).
"""
from app.core import access, database


def test_load_dynamic_mapping_passes_a_timeout():
    """Regression: this call runs on EVERY request via current_user(). An
    earlier incident (see docs/CONTEXT.md) came from a lifespan startup hook
    awaiting this with no bound — the query itself must always carry an
    explicit timeout, independent of any caller-side fix, so it can never
    hang unbounded again."""
    access._DYNAMIC_MAPPING_CACHE.clear()
    seen_kwargs = {}

    def fake_query(sql, params=None, timeout=None):
        seen_kwargs["timeout"] = timeout
        return []

    import app.core.database as database_mod
    orig = database_mod.query_rows_ignore_missing_table
    database_mod.query_rows_ignore_missing_table = fake_query
    try:
        access._load_dynamic_mapping(use_cache=False)
    finally:
        database_mod.query_rows_ignore_missing_table = orig

    assert seen_kwargs["timeout"] == access._LIVE_LOOKUP_TIMEOUT_SECONDS
    assert seen_kwargs["timeout"] is not None


def test_load_dynamic_mapping_ignores_malformed_rows():
    """Regression: current_user() calls this on EVERY request, including
    ones whose tests mock database.run_query with a totally different row
    shape (e.g. mentor-quality rows with no scope_type/scope_key/action at
    all). It must skip those rows rather than KeyError."""
    access._DYNAMIC_MAPPING_CACHE.clear()

    def fake_query(sql, params=None, timeout=None):
        return [{"region": "Central", "cu": "Mpigi", "overall_quality_index": 2.5}]

    import app.core.database as database_mod
    orig = database_mod.query_rows_ignore_missing_table
    database_mod.query_rows_ignore_missing_table = fake_query
    try:
        result = access._load_dynamic_mapping(use_cache=False)
    finally:
        database_mod.query_rows_ignore_missing_table = orig
    assert result == {"regional": {}, "cu": {}}


def test_get_live_config_merges_dynamic_over_static_for_touched_keys_only():
    access._DYNAMIC_MAPPING_CACHE.clear()

    def fake_query(sql, params=None, timeout=None):
        return [{"scope_type": "cu", "scope_key": "mpigi", "user_email": "new.foa@experienceeducate.org", "action": "add"}]

    import app.core.database as database_mod
    orig = database_mod.query_rows_ignore_missing_table
    database_mod.query_rows_ignore_missing_table = fake_query
    try:
        merged = access.get_live_config(use_cache=False)
    finally:
        database_mod.query_rows_ignore_missing_table = orig

    # Touched key: static default fully replaced.
    assert merged["cu"]["mpigi"] == ["new.foa@experienceeducate.org"]
    # Untouched region key: static default preserved.
    assert merged["regional"]["Central"] == ["central@experienceeducate.org"]


def test_get_live_config_reconstructs_latest_action_wins():
    access._DYNAMIC_MAPPING_CACHE.clear()

    def fake_query(sql, params=None, timeout=None):
        # Ascending by event_timestamp, as the real query orders — a switch:
        # remove the old FOA, add a new one.
        return [
            {"scope_type": "cu", "scope_key": "mpigi", "user_email": "cu@experienceeducate.org", "action": "add"},
            {"scope_type": "cu", "scope_key": "mpigi", "user_email": "cu@experienceeducate.org", "action": "remove"},
            {"scope_type": "cu", "scope_key": "mpigi", "user_email": "replacement@experienceeducate.org", "action": "add"},
        ]

    import app.core.database as database_mod
    orig = database_mod.query_rows_ignore_missing_table
    database_mod.query_rows_ignore_missing_table = fake_query
    try:
        merged = access.get_live_config(use_cache=False)
    finally:
        database_mod.query_rows_ignore_missing_table = orig

    assert merged["cu"]["mpigi"] == ["replacement@experienceeducate.org"]


def test_get_mapping_requires_admin(client, client_headers, make_token):
    token = make_token("cu@experienceeducate.org")
    r = client.get("/api/admin/access/mapping", headers={**client_headers, "Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_get_mapping_reports_can_edit_per_user(client, client_headers, make_token, monkeypatch):
    access._DYNAMIC_MAPPING_CACHE.clear()
    monkeypatch.setattr(database, "query_rows_ignore_missing_table", lambda sql, params=None: [])

    viewer_token = make_token("analytics-admin@experienceeducate.org")
    r = client.get("/api/admin/access/mapping", headers={**client_headers, "Authorization": f"Bearer {viewer_token}"})
    assert r.status_code == 200
    assert r.json()["canEdit"] is False

    manager_token = make_token("access-manager@experienceeducate.org")
    r = client.get("/api/admin/access/mapping", headers={**client_headers, "Authorization": f"Bearer {manager_token}"})
    assert r.status_code == 200
    assert r.json()["canEdit"] is True


def test_post_mapping_rejects_non_manager(client, client_headers, make_token):
    token = make_token("analytics-admin@experienceeducate.org")  # is_admin, not access-manager
    r = client.post(
        "/api/admin/access/mapping",
        json={"scope_type": "cu", "scope_key": "mpigi", "add_email": "someone@experienceeducate.org"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_post_mapping_requires_at_least_one_email(client, client_headers, make_token):
    token = make_token("access-manager@experienceeducate.org")
    r = client.post(
        "/api/admin/access/mapping",
        json={"scope_type": "cu", "scope_key": "mpigi"},
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_post_mapping_switch_writes_remove_and_add_then_invalidates_cache(client, client_headers, make_token, monkeypatch):
    written = []

    def fake_insert(table_ref, rows):
        written.extend(rows)
        return []

    monkeypatch.setattr(database, "insert_rows", fake_insert)
    # Properly-shaped sentinel (current_user()'s own resolve_access() call
    # reads this same cache before the endpoint body runs) — a malformed one
    # would KeyError inside get_live_config() before we even get there.
    access._DYNAMIC_MAPPING_CACHE[access._DYNAMIC_MAPPING_CACHE_KEY] = {"regional": {}, "cu": {}, "_sentinel": True}

    token = make_token("access-manager@experienceeducate.org")
    r = client.post(
        "/api/admin/access/mapping",
        json={
            "scope_type": "cu",
            "scope_key": "mpigi",
            "remove_email": "OldFOA@experienceeducate.org",
            "add_email": "NewFOA@experienceeducate.org",
        },
        headers={**client_headers, "Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert len(written) == 2
    removed = next(row for row in written if row["action"] == "remove")
    added = next(row for row in written if row["action"] == "add")
    assert removed["user_email"] == "oldfoa@experienceeducate.org"
    assert added["user_email"] == "newfoa@experienceeducate.org"
    assert removed["scope_type"] == "cu" and removed["scope_key"] == "mpigi"
    assert added["changed_by"] == "access-manager@experienceeducate.org"
    assert access._DYNAMIC_MAPPING_CACHE_KEY not in access._DYNAMIC_MAPPING_CACHE
