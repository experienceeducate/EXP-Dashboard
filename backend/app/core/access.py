"""Per-user access scoping.

Faithful to the legacy dashboard's ACCESS_CONFIG model: a user's email maps to
a set of things they may see — national (everything), specific regions, and/or
specific CUs. Row-level filtering is applied SERVER-SIDE (unlike the legacy app
which resolved scope client-side after loading all data).

ACCESS_CONFIG shape::

    {
      "national": ["alice@experienceeducate.org", ...],
      "regional": {"Central": ["bob@...", ...], "Eastern": [...]},
      "cu":       {"mpigi": ["carol@...", ...], "entebbe": [...]}
    }

Loaded from ``ACCESS_CONFIG_PATH`` (JSON) if set, else the fallback below (ported
verbatim from the legacy ``buildFallbackAccessConfig()``).

Resolution order (mirrors legacy ``checkUserAccess``):
  1. Email in ``national``            → full access (has_national, not national_only)
  2. Email in ``regional[region]``    → regional officer (Regional + CU)
  3. Email in ``cu[cu]``              → FOA (CU only)
  4. Any other ``@<allowed-domain>``  → National view only (national_only)
  5. Unknown email                    → no access
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings


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
            "rubaga": ["ketty.layoo@experienceeducate.org"],
            "busia-namayingo": ["andrew.mudibo@experienceeducate.org"],
            "iganga-bugiri": ["veronica.nabawanuka@experienceeducate.org"],
            "jinja 1": ["joseph.mwesigwa@experienceeducate.org"],
            "jinja 2": ["emmanuel.wamala@experienceeducate.org"],
            "kamuli": ["sandra.wagabaza@experienceeducate.org"],
            "kapchorwa-sironko": ["edith.naulere@experienceeducate.org"],
            "mbale": ["otim.nespol@experienceeducate.org"],
            "soroti-serere": ["pachotojoel@gmail.com"],
            "adjumani-moyo": ["revon.okeny@experienceeducate.org"],
            "arua": ["enid.letasi@experienceeducate.org"],
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
            "lugazi": ["kasulejoshua52@gmail.com"],
            "hoima": ["rose.kimuli@experienceeducate.org"],
        },
    }


def _normalise(raw: dict) -> dict:
    """Lower-case + strip every email; keep region/cu keys as-is (cu compared lc)."""

    def clean(emails) -> list[str]:
        return [str(e).strip().lower() for e in (emails or [])]

    return {
        "national": clean(raw.get("national")),
        "regional": {r: clean(v) for r, v in (raw.get("regional") or {}).items()},
        "cu": {c: clean(v) for c, v in (raw.get("cu") or {}).items()},
    }


def _load_access_config() -> dict:
    if settings.ACCESS_CONFIG_PATH:
        path = Path(settings.ACCESS_CONFIG_PATH)
        if path.exists():
            return _normalise(json.loads(path.read_text(encoding="utf-8")))
    return _normalise(_build_fallback_access_config())


ACCESS_CONFIG: dict = _load_access_config()


@dataclass
class UserAccess:
    """Resolved scope for one user."""

    email: str
    has_national: bool = False
    national_only: bool = False
    regions: list[str] = field(default_factory=list)
    cus: list[str] = field(default_factory=list)

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
        }


def resolve_access(email: str, config: dict | None = None) -> UserAccess:
    """Map an email to its access scope using ACCESS_CONFIG."""
    config = config or ACCESS_CONFIG
    email = (email or "").strip().lower()

    # 1. Explicitly listed national users → full access.
    if email in config.get("national", []):
        return UserAccess(
            email=email,
            has_national=True,
            national_only=False,
            regions=list(config.get("regional", {}).keys()),
            cus=[],
        )

    # 2. Regional officers.
    regions = [r for r, emails in config.get("regional", {}).items() if email in emails]
    if regions:
        return UserAccess(email=email, regions=regions)

    # 3. CU / FOA.
    cus = [c for c, emails in config.get("cu", {}).items() if email in emails]
    if cus:
        return UserAccess(email=email, cus=cus)

    # 4. Any other email on the allowed domain → National view only.
    if email.endswith("@" + settings.OAUTH_ALLOWED_DOMAIN):
        return UserAccess(email=email, has_national=True, national_only=True)

    # 5. Unknown → no access.
    return UserAccess(email=email)
