"""Import GeoWarehouse (or any land-registry) CSV exports.

GeoWarehouse export layouts differ between report types and change over time,
so columns are matched by a list of known header aliases. Anything that is not
recognised can be mapped explicitly with a JSON column map, e.g.
``{"reg_date": "Registration Dt", "chargee": "Party To"}``.
"""

from __future__ import annotations

import csv
import json
import re
from datetime import date, datetime
from pathlib import Path

# Canonical field -> header aliases (compared case/punctuation-insensitively).
ALIASES: dict[str, list[str]] = {
    "pin": ["pin", "property pin", "parcel pin", "property identifier"],
    "reg_num": ["reg num", "registration number", "reg no", "instrument number",
                "instrument no", "reg number", "registration no"],
    "reg_date": ["reg date", "registration date", "date registered", "instrument date",
                 "reg dt"],
    "instrument": ["instrument type", "type", "instrument", "document type", "inst type"],
    "amount": ["amount", "charge amount", "consideration", "principal", "mortgage amount"],
    "chargee": ["chargee", "lender", "parties to", "party to", "mortgagee", "to party"],
    "owners": ["registered owners", "registered owner s", "registered owner", "owner", "owners", "owner names",
               "chargor", "chargors", "parties from", "party from", "mortgagor"],
    "address": ["address", "property address", "municipal address", "street address"],
    "city": ["municipality", "city", "town", "municipality name"],
    "postal": ["postal code", "postal", "postcode", "zip"],
    "mailing_address": ["mailing address", "owner mailing address", "address for service"],
    "remarks": ["remarks", "notes", "comments"],
}

REQUIRED = ("reg_date", "instrument")

_DATE_FORMATS = ("%Y/%m/%d", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y", "%b %d, %Y",
                 "%d/%m/%Y", "%Y%m%d", "%B %d, %Y")


def _key(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", header.lower().replace("(s)", "s")).strip()


def resolve_columns(headers: list[str], overrides: dict[str, str] | None = None) -> dict[str, str]:
    """Return {canonical_field: actual_header}."""
    by_key = {_key(h): h for h in headers}
    mapping: dict[str, str] = {}
    for canon, aliases in ALIASES.items():
        for alias in aliases:
            if alias in by_key:
                mapping[canon] = by_key[alias]
                break
    for canon, header in (overrides or {}).items():
        if canon not in ALIASES:
            raise ValueError(f"Unknown field '{canon}' in column map")
        if header not in headers:
            raise ValueError(f"Column '{header}' not found in CSV headers: {headers}")
        mapping[canon] = header
    missing = [f for f in REQUIRED if f not in mapping]
    if missing:
        raise ValueError(
            f"Could not find column(s) for {missing}. Headers were: {headers}. "
            "Pass --column-map to map them."
        )
    return mapping


def parse_date(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_amount(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9.]", "", value or "")
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def classify_instrument(value: str) -> str:
    """Normalise instrument type to CHARGE, DISCHARGE, TRANSFER or OTHER."""
    v = (value or "").upper()
    if "DISCH" in v or "CESSATION" in v:
        return "DISCHARGE"
    if "CHARGE" in v or "MORTGAGE" in v:
        # "Transfer of Charge" moves an existing mortgage between lenders.
        return "TRANSFER_OF_CHARGE" if "TRANSFER" in v else "CHARGE"
    if "TRANSFER" in v or "DEED" in v:
        return "TRANSFER"
    return "OTHER"


def read_rows(path: str | Path, column_map: dict[str, str] | None = None) -> tuple[list[dict], list[str]]:
    """Read a CSV and return (normalised_rows, warnings)."""
    warnings: list[str] = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        headers = reader.fieldnames or []
        mapping = resolve_columns(headers, column_map)
        rows = []
        for i, raw in enumerate(reader, start=2):
            rec = {canon: (raw.get(col) or "").strip() for canon, col in mapping.items()}
            reg_date = parse_date(rec.get("reg_date", ""))
            if reg_date is None:
                warnings.append(f"line {i}: unparseable date {rec.get('reg_date')!r}, skipped")
                continue
            rows.append({
                "pin": rec.get("pin", ""),
                "reg_num": rec.get("reg_num", "") or f"{Path(path).name}:{i}",
                "reg_date": reg_date.isoformat(),
                "instrument": classify_instrument(rec.get("instrument", "")),
                "instrument_raw": rec.get("instrument", ""),
                "amount": parse_amount(rec.get("amount", "")),
                "chargee": rec.get("chargee", ""),
                "owners": rec.get("owners", ""),
                "address": rec.get("address", ""),
                "city": rec.get("city", ""),
                "postal": rec.get("postal", ""),
                "mailing_address": rec.get("mailing_address", ""),
                "remarks": rec.get("remarks", ""),
                "raw": json.dumps(raw, ensure_ascii=False),
            })
    return rows, warnings
