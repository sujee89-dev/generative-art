"""Service-area definitions.

Areas match on municipality name, community name in the address, or the
postal code's forward sortation area (FSA, the first three characters).
Scarborough is part of the City of Toronto, so land-registry rows usually say
"TORONTO"; the FSA list is what picks it out.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Area:
    name: str
    municipalities: frozenset[str] = field(default_factory=frozenset)
    fsas: frozenset[str] = field(default_factory=frozenset)

    def matches(self, city: str, postal: str, address: str) -> bool:
        city_u = (city or "").strip().upper()
        if city_u and city_u in self.municipalities:
            return True
        fsa = normalize_postal(postal)[:3]
        if fsa and fsa in self.fsas:
            return True
        addr_u = (address or "").upper()
        return any(m in addr_u for m in self.municipalities if len(m) > 4)


def _area(name: str, munis: list[str], fsas: list[str]) -> Area:
    return Area(name, frozenset(m.upper() for m in munis), frozenset(f.upper() for f in fsas))


PRESETS: dict[str, Area] = {
    a.name.lower(): a
    for a in [
        _area("Whitby", ["Whitby", "Brooklin"], ["L1M", "L1N", "L1P", "L1R"]),
        _area("Ajax", ["Ajax"], ["L1S", "L1T", "L1Z"]),
        _area("Pickering", ["Pickering"], ["L1V", "L1W", "L1X", "L1Y"]),
        _area("Oshawa", ["Oshawa"], ["L1G", "L1H", "L1J", "L1K", "L1L"]),
        _area(
            "Scarborough",
            ["Scarborough"],
            ["M1B", "M1C", "M1E", "M1G", "M1H", "M1J", "M1K", "M1L", "M1M",
             "M1N", "M1P", "M1R", "M1S", "M1T", "M1V", "M1W", "M1X"],
        ),
    ]
}


def normalize_postal(postal: str) -> str:
    return "".join(ch for ch in (postal or "").upper() if ch.isalnum())


def load_areas(names: list[str] | None, config_path: str | None = None) -> list[Area]:
    """Resolve area names against presets plus an optional JSON config.

    The config file is a list of {"name", "municipalities", "fsas"} objects.
    """
    available = dict(PRESETS)
    if config_path:
        for item in json.loads(Path(config_path).read_text()):
            a = _area(item["name"], item.get("municipalities", []), item.get("fsas", []))
            available[a.name.lower()] = a
    if not names:
        return []
    out = []
    for n in names:
        key = n.strip().lower()
        if key not in available:
            raise ValueError(f"Unknown area '{n}'. Known: {', '.join(sorted(available))}")
        out.append(available[key])
    return out


def area_for(areas: list[Area], city: str, postal: str, address: str) -> str | None:
    for a in areas:
        if a.matches(city, postal, address):
            return a.name
    return None
