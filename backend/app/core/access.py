"""Per-user access scoping.

Faithful to the legacy dashboard's ACCESS_CONFIG model: a user's email maps to
a set of things they may see — national (everything), specific regions, and/or
specific CUs. Row-level filtering is applied SERVER-SIDE (unlike the legacy app
which resolved scope client-side after loading all data).

ACCESS_CONFIG shape::

    {
      "national": ["alice@experienceeducate.org", ...],
      "regional": {"Central": ["bob@...", ...], "Eastern": [...]},
      "cu":       {"mpigi": ["carol@...", ...], "entebbe": [...]},
      "admin":    ["alice@experienceeducate.org", ...],
      "access_managers": ["alice@experienceeducate.org", ...]
    }

``admin`` is a separate, independent list — it grants the Admin usage-
analytics tab and is orthogonal to national/regional/cu row-scoping (an
admin with no other access still can't see programme rows). ``access_managers``
is narrower still: a subset of admins who may *edit* the CU/region mapping
(routers/access_admin.py) — every admin can view it, only these can change it.

Loaded from ``ACCESS_CONFIG_PATH`` (JSON) if set, else the fallback below (ported
verbatim from the legacy ``buildFallbackAccessConfig()``). This static base is
then layered with any admin-edited CU/region overrides — see
``get_live_config()``.

Resolution order (mirrors legacy ``checkUserAccess``):
  1. Email in ``national``            → full access (has_national, not national_only)
  2. Email in ``regional[region]``    → regional officer (Regional + CU)
  3. Email in ``cu[cu]``              → FOA (CU only)
  4. Any other ``@<allowed-domain>``  → National view only (national_only)
  5. Unknown email                    → no access
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from cachetools import TTLCache

from app.core import database
from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_fallback_access_config() -> dict:
    """Hardcoded default when no ACCESS_CONFIG_PATH is provided.

    Ported from the legacy ``buildFallbackAccessConfig()``.
    """
    return {
        "national": [
            "afra.nuwasiima@experienceeducate.org",
            "hellen.namisi@experienceeducate.org",
            "evelyne.naisanga@experienceeducate.org",
            "franz.biije@experienceeducate.org",
            "francis.kusiimwa@experienceeducate.org",
            "janet.namugaya@experienceeducate.org",
            "caroline.chandia@experienceeducate.org",
            "charlotte.aijuka@experienceeducate.org",
            "john.osikuku@experienceeducate.org",
            "millicent.mwendwa@experienceeducate.org",
            "maggie@experienceeducate.org",
            "veronica@experienceeducate.org",
            "michael.thiriku@experienceeducate.org",
            "ovon.m@experienceeducate.org",
            "aloysie.tumwesigire@experienceeducate.org",
        ],
        "regional": {
            "Central": ["juliet.muchake@experienceeducate.org", "ben.nnume@experienceeducate.org"],
            "West": ["brian.ntegeka@experienceeducate.org"],
            "South": [
                "christine.asasiira@experienceeducate.org",
                "margaret.dhafa@experienceeducate.org",
                "hanifa.nalunkuma@experienceeducate.org",
            ],
            "East": [
                "isaac.ngolobe@experienceeducate.org",
                "fredrick.ngolobe@experienceeducate.org",
                "josham.babalanda@experienceeducate.org",
            ],
            "North": [
                "grace.agenorwot@experienceeducate.org",
                "ritah.nakiseka@experienceeducate.org",
                "feni.godman@experienceeducate.org",
            ],
        },
        "cu": {
            "makindye": ["sarah.mutiibwa@experienceeducate.org"],
            "mbarara": ["emmanuel.nuwagaba@experienceeducate.org"],
            "mukono": ["emma.kisaakye@experienceeducate.org"],
            "tororo": ["vivian.abacha@experienceeducate.org"],
            "entebbe": ["sharifah.nandiika@experienceeducate.org"],
            "kawempe": ["joel.ndiho@experienceeducate.org"],
            "mpigi": ["prisca.turyasiima@experienceeducate.org"],
            "nakawa": ["ivan.kakura@experienceeducate.org"],
            "rubaga": ["ketty.layoo@experienceeducate.org", "patience.margret@experienceeducate.org"],
            "busia - namayingo": ["andrew.mudibo@experienceeducate.org"],
            "iganga-bugiri": ["veronica.nabawanuka@experienceeducate.org"],
            "jinja 1": ["joseph.mwesigwa@experienceeducate.org"],
            "jinja 2": ["emmanuel.wamala@experienceeducate.org", "passy.atim@experienceeducate.org"],
            "kamuli": ["sandra.wagabaza@experienceeducate.org"],
            "kapchorwa-sironko": ["edith.naulere@experienceeducate.org"],
            "mbale": ["otim.nespol@experienceeducate.org"],
            "soroti -serere": ["pachotojoel@gmail.com", "joel.pachoto@experienceeducate.org"],
            "adjumani-moyo": ["revon.okeny@experienceeducate.org"],
            "arua": ["enid.letasi@experienceeducate.org"],
            "koboko-yumbe": ["blessing.asianzu@experienceeducate.org"],
            "kitgum-pader": ["florence.achola@experienceeducate.org"],
            "gulu": ["alfred.nyeko@experienceeducate.org"],
            "kole-oyam": ["cavin.ayuro@experienceeducate.org"],
            "lira": ["racheal.aduku@experienceeducate.org"],
            "bushenyi-mitooma": ["rinnet.arinda@experienceeducate.org"],
            "ibanda": ["zainabu.namirembe@experienceeducate.org"],
            "isingiro": ["mauricia.turyahabwe@experienceeducate.org"],
            "kabale": ["ritah.amanya@experienceeducate.org"],
            "kabarole 1": ["fortunate.wako@experienceeducate.org"],
            "masaka": ["david.ongodia@experienceeducate.org"],
            "masindi-kiryandongo": ["harriet.kusiima@experienceeducate.org"],
            "ntungamo": ["sight.ahabwe@experienceeducate.org"],
            "sheema": ["gilbert.natwijuka@experienceeducate.org"],
            "bundibugyo-ntoroko": ["oliver.katusiime@experienceeducate.org"],
            "kabarole 2": ["benjamin.akampulira@experienceeducate.org"],
            "kamwenge": ["eugine.godsman@experienceeducate.org"],
            "kasese 1": ["augustine.asaba@experienceeducate.org"],
            "kasese 2": ["phinious.mumbere@experienceeducate.org"],
            "kyenjojo": ["phiona.aganyira@experienceeducate.org"],
            "rukungiri": ["martin.asiimwe@experienceeducate.org"],
            "kanungu": ["delex.nasasira@experienceeducate.org"],
            "pallisa": ["babra.mpindi@experienceeducate.org"],
            "luweero - nakasongola": ["geoffrey.odong@experienceeducate.org"],
            "mayuge": ["kalulusaleh1@gmail.com"],
            "lugazi": ["kasulejoshua52@gmail.com", "charity.chebet@experienceeducate.org"],
            "hoima": ["rose.kimuli@experienceeducate.org"],
        },
        # Narrowed from the earlier default (a copy of "national") to just the
        # 4 people who should see the Admin usage-analytics tab.
        "admin": [
            "afra.nuwasiima@experienceeducate.org",
            "charlotte.aijuka@experienceeducate.org",
            "john.osikuku@experienceeducate.org",
            "evelyne.naisanga@experienceeducate.org",
        ],
        # Subset of "admin" who may edit the CU/region mapping below (the
        # other admins can still view it — see routers/access_admin.py).
        "access_managers": [
            "afra.nuwasiima@experienceeducate.org",
            "charlotte.aijuka@experienceeducate.org",
            "john.osikuku@experienceeducate.org",
        ],
    }


def _normalise(raw: dict) -> dict:
    """Lower-case + strip every email; keep region/cu keys as-is (cu compared lc)."""

    def clean(emails) -> list[str]:
        return [str(e).strip().lower() for e in (emails or [])]

    return {
        "national": clean(raw.get("national")),
        "regional": {r: clean(v) for r, v in (raw.get("regional") or {}).items()},
        "cu": {c: clean(v) for c, v in (raw.get("cu") or {}).items()},
        "admin": clean(raw.get("admin")),
        "access_managers": clean(raw.get("access_managers")),
    }


def _load_access_config() -> dict:
    if settings.ACCESS_CONFIG_PATH:
        path = Path(settings.ACCESS_CONFIG_PATH)
        if path.exists():
            return _normalise(json.loads(path.read_text(encoding="utf-8")))
    return _normalise(_build_fallback_access_config())


ACCESS_CONFIG: dict = _load_access_config()

# ── Live CU/region mapping overrides (Admin tab's Access Mapping editor) ────
# Layered on top of the static ACCESS_CONFIG above: a scope_key (a region or
# CU) with any row in the event log is fully controlled by that log for that
# key; an untouched scope_key keeps using its static default. See
# routers/access_admin.py for the write side.
#
# Cached briefly (not per-request) since this now runs on every authenticated
# request via current_user() -> resolve_access() -> get_live_config(). The
# write endpoint calls invalidate_dynamic_mapping_cache() so its own change is
# visible on the very next request; the TTL is just the safety-net upper
# bound for everyone else.
_DYNAMIC_MAPPING_CACHE: TTLCache = TTLCache(maxsize=1, ttl=30)
_DYNAMIC_MAPPING_CACHE_KEY = "mapping"
# Bounds every live lookup below — this runs on EVERY request via
# current_user(), so an unbounded call here is an availability risk, not
# just a slow request. A missed deadline degrades to "no overrides" (see
# _load_dynamic_mapping's docstring), same as any other failure.
_LIVE_LOOKUP_TIMEOUT_SECONDS = 5.0


def invalidate_dynamic_mapping_cache() -> None:
    _DYNAMIC_MAPPING_CACHE.pop(_DYNAMIC_MAPPING_CACHE_KEY, None)


def _load_dynamic_mapping(use_cache: bool = True) -> dict:
    """Reconstructs {"regional": {...}, "cu": {...}} from the append-only
    event log — only scope_keys with event history appear here.

    This runs on EVERY request (via current_user()), including ones that
    have nothing to do with access mapping and whose tests mock BigQuery
    calls with differently-shaped rows — so this must never raise and must
    never assume a row has the fields it expects. A live-lookup hiccup here
    degrades to "no overrides" (the static ACCESS_CONFIG still applies),
    never to a broken login.
    """
    if use_cache and _DYNAMIC_MAPPING_CACHE_KEY in _DYNAMIC_MAPPING_CACHE:
        return _DYNAMIC_MAPPING_CACHE[_DYNAMIC_MAPPING_CACHE_KEY]

    result: dict = {"regional": {}, "cu": {}}
    try:
        sql = f"""
            SELECT scope_type, scope_key, user_email, action
            FROM `{settings.access_mapping_table}`
            ORDER BY event_timestamp ASC
        """
        rows = database.query_rows_ignore_missing_table(sql, timeout=_LIVE_LOOKUP_TIMEOUT_SECONDS)
        latest: dict[tuple, str] = {}
        for r in rows:
            scope_type = r.get("scope_type")
            scope_key = r.get("scope_key")
            email = r.get("user_email")
            action = r.get("action")
            if not (scope_type and scope_key and email and action):
                continue
            latest[(scope_type, scope_key, email)] = action
        for (scope_type, scope_key, email), action in latest.items():
            if action == "add" and scope_type in result:
                result[scope_type].setdefault(scope_key, []).append(email)
    except Exception:  # noqa: BLE001 — see docstring: must never break auth.
        logger.warning("Access-mapping live lookup failed; using static config only", exc_info=True)

    if use_cache:
        _DYNAMIC_MAPPING_CACHE[_DYNAMIC_MAPPING_CACHE_KEY] = result
    return result


def get_live_config(use_cache: bool = True) -> dict:
    """ACCESS_CONFIG with any admin-edited CU/region mapping layered on top.

    Reads the module global ACCESS_CONFIG (not a captured parameter) so
    tests that monkeypatch ``access.ACCESS_CONFIG`` still work unchanged.
    """
    dynamic = _load_dynamic_mapping(use_cache=use_cache)
    return {
        **ACCESS_CONFIG,
        "regional": {**ACCESS_CONFIG.get("regional", {}), **dynamic["regional"]},
        "cu": {**ACCESS_CONFIG.get("cu", {}), **dynamic["cu"]},
    }


@dataclass
class UserAccess:
    """Resolved scope for one user."""

    email: str
    has_national: bool = False
    national_only: bool = False
    regions: list[str] = field(default_factory=list)
    cus: list[str] = field(default_factory=list)
    is_admin: bool = False
    can_manage_access: bool = False

    @property
    def has_any_access(self) -> bool:
        return self.has_national or bool(self.regions) or bool(self.cus)

    @property
    def scope_key(self) -> str:
        """Stable cache-key fragment: identical scopes share cache entries.

        National users all share one key (they see every row). Scoped users key
        on their exact regions + CUs.
        """
        if self.has_national:
            return "national"
        return (
            "r:" + ",".join(sorted(self.regions))
            + "|c:" + ",".join(sorted(c.lower() for c in self.cus))
        )

    def to_dict(self) -> dict:
        return {
            "email": self.email,
            "hasNational": self.has_national,
            "nationalOnly": self.national_only,
            "regions": self.regions,
            "cus": self.cus,
            "isAdmin": self.is_admin,
            "canManageAccess": self.can_manage_access,
        }


def resolve_access(email: str, config: dict | None = None) -> UserAccess:
    """Map an email to its access scope.

    Defaults to ``get_live_config()`` (static ACCESS_CONFIG + any admin-edited
    CU/region overrides) rather than the frozen ``ACCESS_CONFIG`` — called
    fresh on every request via ``current_user()``, so a remap or an
    admin/access-manager list change takes effect immediately, no re-login
    needed. Callers that pass an explicit ``config`` (e.g. tests) are
    unaffected.
    """
    config = config if config is not None else get_live_config()
    email = (email or "").strip().lower()

    # Orthogonal to national/regional/cu row-scoping below — an admin with no
    # other access still can't see programme rows, and vice versa.
    is_admin = email in config.get("admin", [])
    can_manage_access = email in config.get("access_managers", [])

    # 1. Explicitly listed national users → full access.
    if email in config.get("national", []):
        return UserAccess(
            email=email,
            has_national=True,
            national_only=False,
            regions=list(config.get("regional", {}).keys()),
            cus=[],
            is_admin=is_admin,
            can_manage_access=can_manage_access,
        )

    # 2. Regional officers.
    regions = [r for r, emails in config.get("regional", {}).items() if email in emails]
    if regions:
        return UserAccess(email=email, regions=regions, is_admin=is_admin, can_manage_access=can_manage_access)

    # 3. CU / FOA.
    cus = [c for c, emails in config.get("cu", {}).items() if email in emails]
    if cus:
        return UserAccess(email=email, cus=cus, is_admin=is_admin, can_manage_access=can_manage_access)

    # 4. Any other email on the allowed domain → National view only.
    if email.endswith("@" + settings.OAUTH_ALLOWED_DOMAIN):
        return UserAccess(
            email=email, has_national=True, national_only=True, is_admin=is_admin, can_manage_access=can_manage_access
        )

    # 5. Unknown → no access.
    return UserAccess(email=email, is_admin=is_admin, can_manage_access=can_manage_access)
