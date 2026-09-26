"""SQLite storage for imported registrations, lead status and suppression."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS registrations (
    reg_num        TEXT PRIMARY KEY,
    pin            TEXT,
    reg_date       TEXT NOT NULL,
    instrument     TEXT NOT NULL,
    instrument_raw TEXT,
    amount         REAL,
    chargee        TEXT,
    owners         TEXT,
    address        TEXT,
    city           TEXT,
    postal         TEXT,
    mailing_address TEXT,
    remarks        TEXT,
    raw            TEXT,
    imported_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reg_pin ON registrations(pin);
CREATE INDEX IF NOT EXISTS idx_reg_addr ON registrations(address);

-- Your outreach log, keyed by the charge's registration number.
CREATE TABLE IF NOT EXISTS lead_status (
    reg_num    TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    note       TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Addresses that asked not to be contacted (normalised address key).
CREATE TABLE IF NOT EXISTS do_not_contact (
    address_key TEXT PRIMARY KEY,
    reason      TEXT,
    added_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

STATUSES = ("new", "mailed", "knocked", "talked", "appointment", "won", "lost", "not_interested")


def connect(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_registrations(conn: sqlite3.Connection, rows: list[dict]) -> int:
    cols = ["reg_num", "pin", "reg_date", "instrument", "instrument_raw", "amount", "chargee",
            "owners", "address", "city", "postal", "mailing_address", "remarks", "raw"]
    sql = (
        f"INSERT INTO registrations ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
        f"ON CONFLICT(reg_num) DO UPDATE SET "
        + ", ".join(f"{c}=excluded.{c}" for c in cols[1:])
    )
    with conn:
        conn.executemany(sql, [[r.get(c) for c in cols] for r in rows])
    return len(rows)


def all_registrations(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM registrations ORDER BY reg_date")]


def set_status(conn: sqlite3.Connection, reg_num: str, status: str, note: str = "") -> None:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    with conn:
        conn.execute(
            "INSERT INTO lead_status (reg_num, status, note) VALUES (?, ?, ?) "
            "ON CONFLICT(reg_num) DO UPDATE SET status=excluded.status, note=excluded.note, "
            "updated_at=CURRENT_TIMESTAMP",
            (reg_num, status, note),
        )


def statuses(conn: sqlite3.Connection) -> dict[str, dict]:
    return {r["reg_num"]: dict(r) for r in conn.execute("SELECT * FROM lead_status")}


def add_dnc(conn: sqlite3.Connection, address_key: str, reason: str = "") -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO do_not_contact (address_key, reason) VALUES (?, ?)",
            (address_key, reason),
        )


def dnc_keys(conn: sqlite3.Connection) -> set[str]:
    return {r["address_key"] for r in conn.execute("SELECT address_key FROM do_not_contact")}
