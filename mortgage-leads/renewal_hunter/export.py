"""Mailing lists, door-knocking route sheets and the HTML lead report."""

from __future__ import annotations

import csv
import html
from collections import defaultdict
from datetime import date
from pathlib import Path

from .scoring import Lead, split_street


def format_owner_names(owners: str) -> str:
    """'SMITH, JOHN; SMITH, JANE MARY' -> 'John & Jane Mary Smith'."""
    people = [p.strip() for p in (owners or "").replace(" AND ", ";").split(";") if p.strip()]
    parsed: list[tuple[str, str]] = []
    for p in people:
        if "," in p:
            last, first = (s.strip() for s in p.split(",", 1))
        else:
            parts = p.split()
            first, last = " ".join(parts[:-1]), parts[-1] if parts else ""
        parsed.append((first.title(), last.title()))
    if not parsed:
        return "Current Resident"
    lasts = {l for _, l in parsed}
    if len(lasts) == 1:
        firsts = [f for f, _ in parsed if f]
        return f"{' & '.join(firsts)} {parsed[0][1]}".strip()
    return " & ".join(f"{f} {l}".strip() for f, l in parsed)


def month_label(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%b %Y")


def talking_point(lead: Lead) -> str:
    reg_year = lead.reg_date[:4]
    when = month_label(lead.renewal_date)
    if lead.lender_type == "private":
        return (f"Private mortgage from {reg_year}; likely up for renewal around {when}. "
                "Offer a plan to move back to a bank lender at a lower rate.")
    base = f"Mortgage from {reg_year} is likely up for renewal around {when}."
    if "2020-22 low-rate cohort" in " ".join(lead.flags):
        return base + (" Rates are higher than when they signed, so offer a free "
                       "payment-shock check and to shop every lender for them.")
    if lead.other_charges:
        return base + " There's a second charge on title, so ask about rolling it in."
    return base + " Offer a free renewal rate comparison before they sign the bank's offer."


def write_mailing_csv(leads: list[Lead], path: str | Path) -> int:
    """Canada Post-friendly address list (addressed admail / letter mail)."""
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "address_line", "city", "province", "postal_code",
                    "renewal_month", "lender", "reg_num", "score"])
        for l in leads:
            if l.mailing_address:
                line, city, postal = l.mailing_address, "", ""
            else:
                line, city, postal = l.address.split(",")[0].strip(), (l.city or "").title(), l.postal
            w.writerow([format_owner_names(l.owners), line, city, "ON", postal,
                        month_label(l.renewal_date), l.chargee, l.reg_num, l.score])
    return len(leads)


def route_groups(leads: list[Lead]) -> list[tuple[str, str, list[tuple[int | None, str, Lead]]]]:
    """Group leads by (area/city, street), sorted by house number: odd side then even."""
    groups: dict[tuple[str, str], list[tuple[int | None, str, Lead]]] = defaultdict(list)
    for l in leads:
        num, street, unit = split_street(l.address)
        groups[(l.area or (l.city or "").title(), street)].append((num, unit, l))
    out = []
    for (area, street), items in sorted(groups.items()):
        items.sort(key=lambda t: ((t[0] or 0) % 2 == 0, t[0] or 0))
        out.append((area, street, items))
    return out


def write_doorknock_csv(leads: list[Lead], path: str | Path) -> int:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["area", "street", "number", "side", "unit", "owner", "renewal_month",
                    "talking_point", "reg_num", "outcome"])
        for area, street, items in route_groups(leads):
            for num, unit, l in items:
                side = "" if num is None else ("odd" if num % 2 else "even")
                w.writerow([area, street, num or "", side, unit, format_owner_names(l.owners),
                            month_label(l.renewal_date), talking_point(l), l.reg_num, ""])
    return len(leads)


_CSS = """
:root { --bg:#fbfaf7; --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e1dc; --accent:#0f6b5c;
        --chip:#eef4f2; --warn:#8a4b00; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#141416; --fg:#ececec; --muted:#9a9aa0; --line:#2c2c30; --accent:#4fc1a8;
          --chip:#1f2a28; --warn:#f0b35a; }
}
* { box-sizing: border-box; }
body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--fg);
       font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1200px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:28px 0 8px; }
.sub { color:var(--muted); margin:0 0 20px; }
.stats { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; }
.stat { border:1px solid var(--line); border-radius:8px; padding:10px 14px; min-width:140px; }
.stat b { display:block; font-size:22px; }
.stat span { color:var(--muted); font-size:12px; }
.wrap { overflow-x:auto; }
table { border-collapse:collapse; width:100%; }
th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; color:var(--muted); font-weight:600; white-space:nowrap; }
td.num { font-variant-numeric: tabular-nums; white-space:nowrap; }
.score { font-weight:700; color:var(--accent); }
.flag { display:inline-block; background:var(--chip); border-radius:4px; padding:1px 6px;
        margin:2px 4px 0 0; font-size:12px; }
.flag.warn { color:var(--warn); }
.box { width:14px; height:14px; border:1.5px solid var(--muted); display:inline-block; }
.note { color:var(--muted); font-size:12px; margin-top:28px; max-width:800px; }
@media print { body { padding:0; font-size:11px; } .stats, .note { display:none; }
  h2 { page-break-before:auto; } tr { page-break-inside:avoid; } }
"""


def _page(title: str, subtitle: str, body: str) -> str:
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>{_CSS}</style></head><body><main>"
            f"<h1>{html.escape(title)}</h1><p class='sub'>{html.escape(subtitle)}</p>{body}"
            f"</main></body></html>")


def _flags_html(flags: list[str]) -> str:
    return "".join(
        f"<span class='flag{' warn' if 'soon' in f or 'already' in f else ''}'>{html.escape(f)}</span>"
        for f in flags
    )


def _money(v: float | None) -> str:
    return f"${v:,.0f}" if v else "—"


def write_report_html(leads: list[Lead], path: str | Path, *, today: date, areas: list[str]) -> None:
    by_area: dict[str, int] = defaultdict(int)
    for l in leads:
        by_area[l.area or l.city.title() or "?"] += 1
    total_amt = sum(l.amount or 0 for l in leads)
    next_90 = sum(1 for l in leads if l.days_to_renewal <= 90)
    stats = [
        (len(leads), "leads"),
        (next_90, "renewing within 90 days"),
        (sum(1 for l in leads if l.lender_type == "big_bank"), "with a big bank"),
        (_money(total_amt), "registered principal"),
    ] + [(n, f"in {a}") for a, n in sorted(by_area.items())]
    stat_html = "".join(f"<div class='stat'><b>{html.escape(str(v))}</b><span>{html.escape(k)}</span></div>"
                        for v, k in stats)
    rows = []
    for l in leads:
        rows.append(
            "<tr>"
            f"<td class='num score'>{l.score}</td>"
            f"<td>{html.escape(l.address)}<br><span class='sub'>{html.escape(l.area or l.city)} {html.escape(l.postal)}</span></td>"
            f"<td>{html.escape(format_owner_names(l.owners))}</td>"
            f"<td class='num'>{month_label(l.renewal_date)}<br><span class='sub'>{l.days_to_renewal} days · 3-yr alt {month_label(l.alt_renewal_3yr)}</span></td>"
            f"<td>{html.escape(l.chargee)}<br><span class='sub'>{l.lender_type.replace('_', ' ')}</span></td>"
            f"<td class='num'>{_money(l.amount)}<br><span class='sub'>reg {l.reg_date}</span></td>"
            f"<td>{_flags_html(l.flags)}</td>"
            f"<td>{html.escape(l.status)}</td>"
            "</tr>"
        )
    table = ("<div class='wrap'><table><thead><tr><th>Score</th><th>Property</th><th>Owner(s)</th>"
             "<th>Est. renewal</th><th>Lender</th><th>Amount</th><th>Why</th><th>Status</th>"
             f"</tr></thead><tbody>{''.join(rows)}</tbody></table></div>")
    note = ("<p class='note'>Renewal dates are estimates: term length is not on title, so a 5-year term "
            "is assumed (1 year for private lenders) and the 3-year alternative is shown. Registered "
            "amounts are original principal, and collateral charges may be registered above the actual "
            "loan. Check your GeoWarehouse licence terms before using its data for marketing, and "
            "honour every do-not-contact request.</p>")
    area_txt = ", ".join(areas) if areas else "all areas"
    Path(path).write_text(_page("Renewal leads", f"{area_txt} · generated {today.isoformat()}",
                                f"<div class='stats'>{stat_html}</div>{table}{note}"), encoding="utf-8")


def write_doorknock_html(leads: list[Lead], path: str | Path, *, today: date) -> None:
    sections = []
    for area, street, items in route_groups(leads):
        rows = "".join(
            "<tr>"
            f"<td class='num'>{num or '?'}{(' ' + html.escape(unit)) if unit else ''}</td>"
            f"<td>{html.escape(format_owner_names(l.owners))}</td>"
            f"<td class='num'>{month_label(l.renewal_date)}</td>"
            f"<td>{html.escape(talking_point(l))}</td>"
            "<td><span class='box'></span> home &nbsp; <span class='box'></span> talked &nbsp; "
            "<span class='box'></span> left card</td>"
            "</tr>"
            for num, unit, l in items
        )
        sections.append(
            f"<h2>{html.escape(street.title())} · {html.escape(area)} ({len(items)})</h2>"
            "<div class='wrap'><table><thead><tr><th>#</th><th>Owner</th><th>Renews</th>"
            f"<th>Talking point</th><th>Outcome</th></tr></thead><tbody>{rows}</tbody></table></div>"
        )
    Path(path).write_text(
        _page("Door-knocking route", f"{len(leads)} doors · printed {today.isoformat()} · odd side first, then even",
              "".join(sections)),
        encoding="utf-8",
    )
