"""SQLite storage for seen posts, matches, drafts and your follow-up status."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .sources import Post

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    uid          TEXT PRIMARY KEY,
    source       TEXT, community TEXT, title TEXT, body TEXT, url TEXT, author TEXT,
    created_utc  REAL,
    score        INTEGER,
    intents      TEXT,   -- JSON list
    reasons      TEXT,   -- JSON list
    local        INTEGER,
    status       TEXT DEFAULT 'new',  -- new | drafted | replied | ignored | converted
    draft        TEXT,   -- JSON Draft
    alerted      INTEGER DEFAULT 0,
    first_seen   TEXT DEFAULT CURRENT_TIMESTAMP,
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, score);
"""

STATUSES = ("new", "drafted", "replied", "ignored", "converted")


def connect(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def known_uids(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT uid FROM posts")}


def insert_match(conn: sqlite3.Connection, post: Post, score: int, intents: list[str],
                 reasons: list[str], local: bool) -> None:
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO posts (uid, source, community, title, body, url, author, created_utc,"
            " score, intents, reasons, local) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (post.uid, post.source, post.community, post.title, post.body, post.url, post.author,
             post.created_utc, score, json.dumps(intents), json.dumps(reasons), int(local)),
        )


def get(conn: sqlite3.Connection, uid: str) -> dict | None:
    r = conn.execute("SELECT * FROM posts WHERE uid = ? OR uid LIKE ?", (uid, f"%:{uid}")).fetchone()
    return _row(r) if r else None


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["intents"] = json.loads(d["intents"] or "[]")
    d["reasons"] = json.loads(d["reasons"] or "[]")
    d["draft"] = json.loads(d["draft"]) if d["draft"] else None
    return d


def listing(conn: sqlite3.Connection, *, statuses: list[str] | None = None, min_score: int = 0,
            limit: int = 50) -> list[dict]:
    statuses = statuses or ["new", "drafted"]
    q = (f"SELECT * FROM posts WHERE status IN ({','.join('?' * len(statuses))}) AND score >= ? "
         "ORDER BY created_utc DESC LIMIT ?")
    return [_row(r) for r in conn.execute(q, (*statuses, min_score, limit))]


def save_draft(conn: sqlite3.Connection, uid: str, draft: dict) -> None:
    with conn:
        conn.execute("UPDATE posts SET draft = ?, status = CASE WHEN status='new' THEN 'drafted' "
                     "ELSE status END WHERE uid = ?", (json.dumps(draft), uid))


def set_status(conn: sqlite3.Connection, uid: str, status: str, note: str = "") -> bool:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    with conn:
        cur = conn.execute("UPDATE posts SET status = ?, note = ? WHERE uid = ? OR uid LIKE ?",
                           (status, note, uid, f"%:{uid}"))
    return cur.rowcount > 0


def mark_alerted(conn: sqlite3.Connection, uids: list[str]) -> None:
    with conn:
        conn.executemany("UPDATE posts SET alerted = 1 WHERE uid = ?", [(u,) for u in uids])
