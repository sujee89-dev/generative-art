"""Command-line interface: python -m renewal_hunter <command> ..."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

from . import db
from .areas import PRESETS, load_areas
from .export import (format_owner_names, month_label, write_doorknock_csv, write_doorknock_html,
                     write_mailing_csv, write_report_html)
from .importer import read_rows
from .scoring import address_key, build_leads


def _conn(args):
    return db.connect(args.db)


def _leads(args, conn):
    areas = load_areas(args.area, args.areas_config)
    today = date.fromisoformat(args.today) if args.today else date.today()
    leads = build_leads(
        db.all_registrations(conn), today=today, areas=areas, within_days=args.within_days,
        min_score=args.min_score, suppressed=db.dnc_keys(conn), statuses=db.statuses(conn),
    )
    if args.status:
        leads = [l for l in leads if l.status in args.status]
    if args.limit:
        leads = leads[: args.limit]
    return leads, today, [a.name for a in areas]


def cmd_import(args):
    column_map = json.loads(Path(args.column_map).read_text()) if args.column_map else None
    conn = _conn(args)
    total = 0
    for f in args.files:
        rows, warnings = read_rows(f, column_map)
        for w in warnings:
            print(f"  warning: {f} {w}", file=sys.stderr)
        total += db.upsert_registrations(conn, rows)
        print(f"Imported {len(rows)} registrations from {f}")
    print(f"Done. {total} rows upserted into {args.db}")


def cmd_leads(args):
    conn = _conn(args)
    leads, _, _ = _leads(args, conn)
    if args.json:
        print(json.dumps([l.to_dict() for l in leads], indent=2))
        return
    if not leads:
        print("No leads match. Try a wider --within-days or check --area.")
        return
    print(f"{'score':>5}  {'renews':<8} {'days':>4}  {'lender':<10} {'address':<34} owner")
    for l in leads:
        print(f"{l.score:>5}  {month_label(l.renewal_date):<8} {l.days_to_renewal:>4}  "
              f"{l.lender_type:<10} {l.address[:34]:<34} {format_owner_names(l.owners)}"
              f"{'  [' + l.status + ']' if l.status != 'new' else ''}")
    print(f"\n{len(leads)} leads")


def cmd_export(args):
    conn = _conn(args)
    leads, today, area_names = _leads(args, conn)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stamp = today.isoformat()
    paths = {
        "mail": out / f"mailing-list-{stamp}.csv",
        "doors_csv": out / f"door-knock-{stamp}.csv",
        "doors_html": out / f"door-knock-{stamp}.html",
        "report": out / f"renewal-report-{stamp}.html",
    }
    mail_leads = [l for l in leads if l.status not in ("won", "lost", "not_interested")]
    write_mailing_csv(mail_leads, paths["mail"])
    write_doorknock_csv(mail_leads, paths["doors_csv"])
    write_doorknock_html(mail_leads, paths["doors_html"], today=today)
    write_report_html(leads, paths["report"], today=today, areas=area_names)
    for k, p in paths.items():
        print(f"{k:<11} {p}")
    print(f"{len(leads)} leads ({len(mail_leads)} still open)")


def cmd_mark(args):
    conn = _conn(args)
    db.set_status(conn, args.reg_num, args.status, args.note or "")
    print(f"{args.reg_num} -> {args.status}")


def cmd_dnc(args):
    conn = _conn(args)
    key = address_key(args.address)
    db.add_dnc(conn, key, args.reason or "")
    print(f"Suppressed: {key}")


def cmd_areas(args):
    for a in PRESETS.values():
        print(f"{a.name:<12} FSAs: {', '.join(sorted(a.fsas))}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="renewal_hunter", description=__doc__)
    p.add_argument("--db", default=os.environ.get("RENEWAL_DB", "renewals.db"),
                   help="SQLite database path (default: renewals.db or $RENEWAL_DB)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("import", help="import GeoWarehouse CSV exports")
    s.add_argument("files", nargs="+")
    s.add_argument("--column-map", help="JSON file mapping fields to your CSV's headers")
    s.set_defaults(func=cmd_import)

    def lead_filters(sp):
        sp.add_argument("--area", action="append", help="area preset, repeatable (e.g. Whitby)")
        sp.add_argument("--areas-config", help="JSON file with custom areas")
        sp.add_argument("--within-days", type=int, default=365)
        sp.add_argument("--min-score", type=int, default=0)
        sp.add_argument("--status", action="append", choices=db.STATUSES)
        sp.add_argument("--limit", type=int)
        sp.add_argument("--today", help="override today's date (YYYY-MM-DD)")

    s = sub.add_parser("leads", help="list scored renewal leads")
    lead_filters(s)
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_leads)

    s = sub.add_parser("export", help="write mailing list, door-knock sheets and HTML report")
    lead_filters(s)
    s.add_argument("--out-dir", default="out")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("mark", help="record outreach status for a lead")
    s.add_argument("reg_num")
    s.add_argument("status", choices=db.STATUSES)
    s.add_argument("--note")
    s.set_defaults(func=cmd_mark)

    s = sub.add_parser("dnc", help="add an address to the do-not-contact list")
    s.add_argument("address")
    s.add_argument("--reason")
    s.set_defaults(func=cmd_dnc)

    s = sub.add_parser("areas", help="list built-in area presets")
    s.set_defaults(func=cmd_areas)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0
