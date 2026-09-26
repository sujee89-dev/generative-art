import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from renewal_hunter import db
from renewal_hunter.areas import load_areas
from renewal_hunter.export import format_owner_names, write_doorknock_csv, write_mailing_csv
from renewal_hunter.importer import classify_instrument, parse_date, read_rows, resolve_columns
from renewal_hunter.scoring import (build_leads, lender_type, next_renewal, outstanding_charges,
                                    split_street)

TODAY = date(2026, 9, 26)


def reg(reg_num, reg_date, instrument="CHARGE", pin="P1", chargee="ROYAL BANK OF CANADA",
        amount=500000.0, address="10 MAIN ST, WHITBY", city="WHITBY", postal="L1N 1A1", remarks=""):
    return dict(reg_num=reg_num, pin=pin, reg_date=reg_date, instrument=instrument, instrument_raw=instrument,
                amount=amount, chargee=chargee, owners="SMITH, JOHN; SMITH, JANE", address=address, city=city,
                postal=postal, mailing_address="", remarks=remarks)


class RenewalMathTest(unittest.TestCase):
    def test_renewal_follows_term_cycle_not_just_first_term(self):
        # A 2016 charge on a 5-year term renewed quietly in 2021 and is due again in 2026.
        self.assertEqual(next_renewal(date(2016, 12, 1), 5, TODAY), date(2026, 12, 1))
        self.assertEqual(next_renewal(date(2022, 3, 15), 5, TODAY), date(2027, 3, 15))

    def test_recently_passed_anniversary_within_grace(self):
        self.assertEqual(next_renewal(date(2021, 9, 10), 5, TODAY), date(2026, 9, 10))
        self.assertEqual(next_renewal(date(2021, 8, 1), 5, TODAY), date(2031, 8, 1))

    def test_leap_day(self):
        self.assertEqual(next_renewal(date(2024, 2, 29), 5, TODAY), date(2029, 2, 28))


class LenderTypeTest(unittest.TestCase):
    def test_types(self):
        self.assertEqual(lender_type("THE TORONTO-DOMINION BANK"), "big_bank")
        self.assertEqual(lender_type("MCAP FINANCIAL CORPORATION"), "monoline")
        self.assertEqual(lender_type("HOME TRUST COMPANY"), "alt")
        self.assertEqual(lender_type("MERIDIAN CREDIT UNION LIMITED"), "credit_union")
        self.assertEqual(lender_type("PATEL, RAJESH"), "private")
        self.assertEqual(lender_type("LAKESHORE CAPITAL INVESTMENTS INC"), "private")


class OutstandingTest(unittest.TestCase):
    def test_discharge_by_reference(self):
        rows = [reg("DR1", "2015-01-01"), reg("DR2", "2019-06-01", chargee="TD BANK"),
                reg("DR3", "2020-01-01", "DISCHARGE", remarks="RE: DR2")]
        out = outstanding_charges(rows)
        self.assertEqual([c["reg_num"] for c in out["P1"]], ["DR1"])

    def test_sale_clears_sellers_charges(self):
        rows = [reg("DR1", "2012-01-01"), reg("DR2", "2020-05-01", "TRANSFER"),
                reg("DR3", "2020-05-01", chargee="BANK OF MONTREAL")]
        out = outstanding_charges(rows)
        self.assertEqual([c["reg_num"] for c in out["P1"]], ["DR3"])

    def test_fully_discharged_property_dropped(self):
        rows = [reg("DR1", "2012-01-01"), reg("DR2", "2018-01-01", "DISCHARGE")]
        self.assertEqual(outstanding_charges(rows), {})


class BuildLeadsTest(unittest.TestCase):
    def test_area_filter_window_and_flags(self):
        rows = [
            reg("DR1", "2021-12-15", pin="A"),  # low-rate cohort, renews Dec 2026
            reg("DR2", "2021-12-20", pin="B", address="5 ELLESMERE RD, SCARBOROUGH", city="TORONTO",
                postal="M1P 2B2"),
            reg("DR3", "2021-12-20", pin="C", address="1 KING ST, KINGSTON", city="KINGSTON",
                postal="K7L 1A1"),
            reg("DR4", "2019-01-01", pin="D"),  # renews Jan 2029, outside window
        ]
        areas = load_areas(["Whitby", "Scarborough"])
        leads = build_leads(rows, today=TODAY, areas=areas, within_days=365)
        self.assertEqual({l.reg_num for l in leads}, {"DR1", "DR2"})
        by = {l.reg_num: l for l in leads}
        self.assertEqual(by["DR2"].area, "Scarborough")
        self.assertTrue(any("low-rate cohort" in f for f in by["DR1"].flags))
        self.assertEqual(by["DR1"].renewal_date, "2026-12-15")

    def test_suppression_and_status(self):
        rows = [reg("DR1", "2021-12-15")]
        self.assertEqual(build_leads(rows, today=TODAY, suppressed={"10 MAIN ST WHITBY"}), [])
        leads = build_leads(rows, today=TODAY, statuses={"DR1": {"status": "mailed", "note": "x"}})
        self.assertEqual(leads[0].status, "mailed")

    def test_second_charge_flag(self):
        rows = [reg("DR1", "2021-12-15"), reg("DR2", "2023-02-01", chargee="TD BANK", amount=100000)]
        lead = build_leads(rows, today=TODAY)[0]
        self.assertEqual(lead.reg_num, "DR1")
        self.assertEqual(lead.other_charges, 1)


class ImportTest(unittest.TestCase):
    def test_header_aliases_and_parsing(self):
        m = resolve_columns(["PIN", "Reg. Date", "Instrument Type", "Registered Owner(s)", "Parties To"])
        self.assertEqual(m["owners"], "Registered Owner(s)")
        self.assertEqual(m["chargee"], "Parties To")
        self.assertEqual(parse_date("2021/06/15"), date(2021, 6, 15))
        self.assertEqual(parse_date("15-Jun-2021"), date(2021, 6, 15))
        self.assertEqual(classify_instrument("DISCHARGE OF CHARGE"), "DISCHARGE")
        self.assertEqual(classify_instrument("TRANSFER OF CHARGE"), "TRANSFER_OF_CHARGE")
        self.assertEqual(classify_instrument("CHARGE"), "CHARGE")

    def test_missing_required_column(self):
        with self.assertRaises(ValueError):
            resolve_columns(["Address", "Owner"])

    def test_sample_file_end_to_end(self):
        sample = Path(__file__).parent.parent / "sample_data" / "geowarehouse_sample.csv"
        rows, warnings = read_rows(sample)
        self.assertFalse(warnings)
        with tempfile.TemporaryDirectory() as d:
            conn = db.connect(Path(d) / "t.db")
            db.upsert_registrations(conn, rows)
            db.upsert_registrations(conn, rows)  # idempotent
            self.assertEqual(len(db.all_registrations(conn)), len(rows))
            leads = build_leads(db.all_registrations(conn), today=TODAY,
                                areas=load_areas(["Whitby", "Ajax", "Scarborough"]))
            self.assertTrue(leads)
            self.assertEqual(leads, sorted(leads, key=lambda l: (-l.score, l.days_to_renewal)))
            write_mailing_csv(leads, Path(d) / "m.csv")
            write_doorknock_csv(leads, Path(d) / "k.csv")
            with open(Path(d) / "m.csv") as fh:
                first = next(csv.DictReader(fh))
            self.assertNotEqual(first["name"], "Current Resident")


class FormatTest(unittest.TestCase):
    def test_owner_names(self):
        self.assertEqual(format_owner_names("SMITH, JOHN; SMITH, JANE"), "John & Jane Smith")
        self.assertEqual(format_owner_names("SMITH, JOHN; KHAN, AISHA"), "John Smith & Aisha Khan")
        self.assertEqual(format_owner_names(""), "Current Resident")

    def test_split_street(self):
        self.assertEqual(split_street("12 Main Street, Whitby"), (12, "MAIN ST", ""))
        self.assertEqual(split_street("4-120 Dundas St W, Whitby"), (120, "DUNDAS ST W", "UNIT 4"))


if __name__ == "__main__":
    unittest.main()
