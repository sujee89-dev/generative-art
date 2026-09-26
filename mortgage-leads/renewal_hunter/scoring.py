"""Work out which mortgages are still outstanding, when they likely renew, and
how attractive each one is as a lead.

Key facts the logic relies on:

* Land registry records a *charge* when a mortgage is taken out. A renewal with
  the same lender is NOT registered, so a 2016 charge on a 5-year term probably
  renewed quietly in 2021 and comes up again in 2026. We therefore project the
  next renewal on the term cycle, not just "registration + 5 years".
* A discharge, a newer transfer (sale) or a refinance ends the old charge.
* Term length is not on title. We assume 5 years (the most common Canadian
  term) and 1 year for private lenders, and show the 3-year alternative too.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from .areas import Area, area_for

BIG_BANKS = ("ROYAL BANK", "TORONTO-DOMINION", "TORONTO DOMINION", "TD BANK", "NOVA SCOTIA",
             "SCOTIABANK", "BANK OF MONTREAL", "CANADIAN IMPERIAL", "CIBC", "NATIONAL BANK",
             "HSBC", "BMO")
MONOLINES = ("MCAP", "FIRST NATIONAL", "RFA", "CMLS", "MERIX", "LENDWISE", "STRATUS", "IG WEALTH",
             "INVESTORS GROUP", "MANULIFE", "TANGERINE", "SIMPLII", "EQ BANK", "EQUITABLE BANK")
ALT_LENDERS = ("HOME TRUST", "EQUITABLE TRUST", "B2B", "CMLS", "HAVENTREE", "COMMUNITY TRUST",
               "BRIDGEWATER", "CONCENTRA", "PEOPLES TRUST")
CREDIT_UNIONS = ("CREDIT UNION", "MERIDIAN", "DUCA", "ALTERNA", "FIRSTONTARIO", "LIBRO", "KAWARTHA",
                 "PACE", "WESTOBA")
PRIVATE_HINTS = ("INVESTMENTS", "HOLDINGS", "CAPITAL", "MORTGAGE INVESTMENT", " MIC", "MIC ",
                 "PRIVATE", "FUND", "TRUSTEE", "LENDING CORP")
CORPORATE_WORDS = ("BANK", "TRUST", "CREDIT UNION", "CORPORATION", "CORP", "INC", "LTD", "LIMITED",
                   "COMPANY", "CAISSE", "FINANCIAL", "MORTGAGE") + MONOLINES

# 5-year terms signed roughly Mar 2020 - Mar 2022 were at historic-low rates;
# those borrowers face the biggest payment jump at renewal.
LOW_RATE_COHORT = (date(2020, 3, 1), date(2022, 3, 31))

_ABBREV = {
    "STREET": "ST", "AVENUE": "AVE", "DRIVE": "DR", "ROAD": "RD", "CRESCENT": "CRES",
    "COURT": "CRT", "BOULEVARD": "BLVD", "PLACE": "PL", "TRAIL": "TRL", "CIRCLE": "CIR",
    "LANE": "LN", "SQUARE": "SQ", "TERRACE": "TERR", "PARKWAY": "PKWY", "GATE": "GT",
    "EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S",
}


def address_key(address: str) -> str:
    words = re.sub(r"[^A-Z0-9 ]+", " ", (address or "").upper()).split()
    return " ".join(_ABBREV.get(w, w) for w in words)


def split_street(address: str) -> tuple[int | None, str, str]:
    """'12 Main St, Unit 4, Whitby' -> (12, 'MAIN ST', 'UNIT 4')."""
    parts = [p.strip() for p in (address or "").split(",")]
    first = parts[0]
    rest = next((p.upper() for p in parts[1:] if re.match(r"(?i)(unit|apt|suite|ste|#)\b", p)), "")
    m = re.match(r"^(?:(\w+)\s*-\s*)?(\d+)[A-Za-z]?\s+(.*)$", first)
    if not m:
        return None, address_key(first), rest
    unit, number, street = m.groups()
    if unit and not rest:
        rest = f"UNIT {unit}"
    return int(number), address_key(street), rest


def lender_type(chargee: str) -> str:
    c = f" {(chargee or '').upper()} "
    if not chargee.strip():
        return "unknown"
    if any(b in c for b in ALT_LENDERS):
        return "alt"
    if any(b in c for b in BIG_BANKS):
        return "big_bank"
    if any(b in c for b in CREDIT_UNIONS):
        return "credit_union"
    if any(b in c for b in MONOLINES):
        return "monoline"
    if any(h in c for h in PRIVATE_HINTS):
        return "private"
    if not any(w in c for w in CORPORATE_WORDS):
        return "private"  # an individual's name as lender
    return "other"


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year + years, day=28)


def next_renewal(reg_date: date, term_years: int, today: date, grace_days: int = 30) -> date:
    """Next term anniversary on or after (today - grace)."""
    cutoff = today - timedelta(days=grace_days)
    k = 1
    while add_years(reg_date, term_years * k) < cutoff:
        k += 1
    return add_years(reg_date, term_years * k)


@dataclass
class Lead:
    reg_num: str
    pin: str
    address: str
    city: str
    postal: str
    owners: str
    mailing_address: str
    chargee: str
    lender_type: str
    reg_date: str
    amount: float | None
    term_assumed: int
    renewal_date: str
    alt_renewal_3yr: str
    days_to_renewal: int
    area: str | None
    score: int
    flags: list[str] = field(default_factory=list)
    other_charges: int = 0
    status: str = "new"
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _property_key(row: dict) -> str:
    return row.get("pin") or address_key(row.get("address", ""))


def outstanding_charges(registrations: list[dict]) -> dict[str, list[dict]]:
    """Group by property and drop charges that were discharged or pre-date a sale."""
    by_prop: dict[str, list[dict]] = {}
    for r in registrations:
        by_prop.setdefault(_property_key(r), []).append(r)

    result: dict[str, list[dict]] = {}
    for key, events in by_prop.items():
        events.sort(key=lambda r: (r["reg_date"], r["reg_num"]))
        open_charges: list[dict] = []
        for ev in events:
            kind = ev["instrument"]
            if kind == "CHARGE":
                open_charges.append(ev)
            elif kind == "TRANSFER_OF_CHARGE":
                continue  # same mortgage, new holder; keep original date for the term cycle
            elif kind == "DISCHARGE":
                text = f"{ev.get('remarks', '')} {ev.get('instrument_raw', '')}".upper()
                ref = next((c for c in open_charges if c["reg_num"] and c["reg_num"].upper() in text), None)
                target = ref or (open_charges[0] if open_charges else None)
                if target:
                    open_charges.remove(target)
            elif kind == "TRANSFER":
                # Property sold: seller's mortgages are paid out on closing. The
                # buyer's new charge is registered the same day, after the transfer.
                open_charges = [c for c in open_charges if c["reg_date"] > ev["reg_date"]]
        if open_charges:
            result[key] = open_charges
    return result


def score_charge(charge: dict, today: date, *, other_charges: int, max_age_years: int = 25) -> tuple[Lead | None, str]:
    reg_date = date.fromisoformat(charge["reg_date"])
    ltype = lender_type(charge.get("chargee", ""))
    age_years = (today - reg_date).days / 365.25
    if age_years > max_age_years:
        return None, "older than amortisation window"
    if age_years < 0.5:
        return None, "registered in last 6 months"

    term = 1 if ltype == "private" else 5
    renewal = next_renewal(reg_date, term, today)
    alt = next_renewal(reg_date, 3, today)
    days = (renewal - today).days

    flags: list[str] = []
    # Timing: lenders mail renewal offers ~120 days out; reach people before that.
    if 90 <= days <= 240:
        timing = 50
    elif 240 < days <= 365:
        timing = 35
    elif 30 <= days < 90:
        timing = 30
        flags.append("renewal soon - call first")
    elif 365 < days <= 540:
        timing = 15
    elif days < 30:
        timing = 10
        flags.append("may already have signed renewal")
    else:
        timing = 0

    lender_pts = {"big_bank": 15, "credit_union": 12, "other": 10, "unknown": 8,
                  "monoline": 6, "alt": 12, "private": 10}[ltype]
    if ltype == "private":
        flags.append("private lender - refinance-out opportunity")
    elif ltype == "alt":
        flags.append("alt lender - may qualify for A-lender now")
    elif ltype == "monoline":
        flags.append("likely already has a broker")

    amount = charge.get("amount")
    if amount is None:
        amount_pts = 7
    elif amount >= 800_000:
        amount_pts = 20
    elif amount >= 500_000:
        amount_pts = 15
    elif amount >= 300_000:
        amount_pts = 10
    else:
        amount_pts = 5

    cohort_pts = 0
    if term == 5 and LOW_RATE_COHORT[0] <= reg_date <= LOW_RATE_COHORT[1]:
        cohort_pts = 10
        flags.append("2020-22 low-rate cohort - payment shock at renewal")

    extra_pts = 0
    if other_charges:
        extra_pts = 5
        flags.append(f"{other_charges} other charge(s) on title - consolidation angle")

    if age_years > 20:
        flags.append("old mortgage - balance may be small")
        amount_pts = min(amount_pts, 5)

    score = min(100, timing + lender_pts + amount_pts + cohort_pts + extra_pts)
    lead = Lead(
        reg_num=charge["reg_num"], pin=charge.get("pin", ""), address=charge.get("address", ""),
        city=charge.get("city", ""), postal=charge.get("postal", ""), owners=charge.get("owners", ""),
        mailing_address=charge.get("mailing_address", ""), chargee=charge.get("chargee", ""),
        lender_type=ltype, reg_date=charge["reg_date"], amount=amount, term_assumed=term,
        renewal_date=renewal.isoformat(), alt_renewal_3yr=alt.isoformat(), days_to_renewal=days,
        area=None, score=score, flags=flags, other_charges=other_charges,
    )
    return lead, ""


def build_leads(
    registrations: list[dict],
    *,
    today: date | None = None,
    areas: list[Area] | None = None,
    within_days: int = 365,
    min_score: int = 0,
    suppressed: set[str] | None = None,
    statuses: dict[str, dict] | None = None,
) -> list[Lead]:
    today = today or date.today()
    suppressed = suppressed or set()
    statuses = statuses or {}
    leads: list[Lead] = []
    for charges in outstanding_charges(registrations).values():
        # First-position mortgage is normally the earliest outstanding charge.
        primary, others = charges[0], charges[1:]
        if address_key(primary.get("address", "")) in suppressed:
            continue
        lead, _ = score_charge(primary, today, other_charges=len(others))
        if lead is None:
            continue
        if areas:
            lead.area = area_for(areas, lead.city, lead.postal, lead.address)
            if lead.area is None:
                continue
        if lead.days_to_renewal > within_days or lead.score < min_score:
            continue
        st = statuses.get(lead.reg_num)
        if st:
            lead.status, lead.note = st["status"], st.get("note") or ""
        leads.append(lead)
    leads.sort(key=lambda l: (-l.score, l.days_to_renewal))
    return leads
