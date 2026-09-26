"""Generate a FAKE GeoWarehouse-style export for demos and tests.

Every name, address and registration number here is invented.
"""
import csv
import random
from datetime import date, timedelta

random.seed(42)
STREETS = {
    ("WHITBY", ("L1N", "L1M", "L1R")): ["DUNDAS ST W", "ROSSLAND RD E", "COCHRANE ST", "ANDERSON ST", "TAUNTON RD W"],
    ("AJAX", ("L1S", "L1T", "L1Z")): ["HARWOOD AVE S", "WESTNEY RD N", "SALEM RD S", "KINGSTON RD E"],
    ("TORONTO", ("M1B", "M1E", "M1P", "M1W")): ["ELLESMERE RD", "LAWRENCE AVE E", "BIRCHMOUNT RD", "MIDLAND AVE"],
    ("OSHAWA", ("L1G", "L1H")): ["SIMCOE ST N", "KING ST E"],
}
LENDERS = ["ROYAL BANK OF CANADA", "THE TORONTO-DOMINION BANK", "THE BANK OF NOVA SCOTIA",
           "BANK OF MONTREAL", "CANADIAN IMPERIAL BANK OF COMMERCE", "MCAP FINANCIAL CORPORATION",
           "FIRST NATIONAL FINANCIAL GP CORPORATION", "HOME TRUST COMPANY", "MERIDIAN CREDIT UNION LIMITED",
           "LAKESHORE CAPITAL INVESTMENTS INC", "PATEL, RAJESH"]
FIRST = ["JOHN", "PRIYA", "MICHAEL", "AISHA", "WEI", "SARAH", "DAVID", "FATIMA", "KEVIN", "MARIA", "ARJUN", "LISA"]
LAST = ["SMITH", "NGUYEN", "PATEL", "SINGH", "CHEN", "BROWN", "WILLIAMS", "KHAN", "MARTIN", "SILVA", "OKAFOR", "TREMBLAY"]


def rdate(start, end):
    return start + timedelta(days=random.randrange(max(1, (end - start).days)))


rows, n = [], 100000
for i in range(80):
    (city, fsas), streets = random.choice(list(STREETS.items()))
    street = random.choice(streets)
    num = random.randint(1, 400)
    addr = f"{num} {street}, {'SCARBOROUGH' if city == 'TORONTO' else city}"
    postal = f"{random.choice(fsas)} {random.randint(1,9)}{random.choice('ABCEGHJK')}{random.randint(1,9)}"
    pin = f"26{random.randint(100,999)}-{random.randint(1000,9999):04d}"
    last = random.choice(LAST)
    owners = f"{last}, {random.choice(FIRST)}" + (f"; {last}, {random.choice(FIRST)}" if random.random() < 0.6 else "")
    reg = rdate(date(2004, 1, 1), date(2026, 3, 1))
    n += random.randint(1, 900)
    base = dict(PIN=pin, Address=addr, Municipality=city, **{"Postal Code": postal, "Registered Owner(s)": owners})
    rows.append({**base, "Reg. Num.": f"DR{n}", "Reg. Date": reg.strftime("%Y/%m/%d"), "Instrument Type": "CHARGE",
                 "Amount": f"${random.randrange(180, 1100) * 1000:,}", "Parties To": random.choice(LENDERS), "Remarks": ""})
    # Some get discharged, some sold, some get a second charge (HELOC).
    roll = random.random()
    if roll < 0.12:
        n += 7
        rows.append({**base, "Reg. Num.": f"DR{n}", "Reg. Date": rdate(reg + timedelta(days=200), date(2026, 6, 1)).strftime("%Y/%m/%d"),
                     "Instrument Type": "DISCHARGE OF CHARGE", "Amount": "", "Parties To": "", "Remarks": f"RE: DR{n-7}"})
    elif roll < 0.2:
        n += 3
        rows.append({**base, "Reg. Num.": f"DR{n}", "Reg. Date": rdate(reg + timedelta(days=400), date(2026, 6, 1)).strftime("%Y/%m/%d"),
                     "Instrument Type": "TRANSFER", "Amount": "$850,000", "Parties To": "", "Remarks": ""})
    elif roll < 0.3:
        n += 5
        rows.append({**base, "Reg. Num.": f"DR{n}", "Reg. Date": rdate(reg + timedelta(days=300), date(2026, 3, 1)).strftime("%Y/%m/%d"),
                     "Instrument Type": "CHARGE", "Amount": "$150,000", "Parties To": "THE TORONTO-DOMINION BANK", "Remarks": "HELOC"})

with open("sample_data/geowarehouse_sample.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(len(rows), "rows")
