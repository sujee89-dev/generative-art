"""Command-line interface: python -m asking_monitor <command> ..."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

from . import store
from .alerts import format_alert, send_webhook
from .classifier import DEFAULT_LOCAL_TERMS, classify
from .digest import write_digest
from .drafter import draft
from .sources import FeedSource, Post, RedditSource, load_manual_file, manual_post

DEFAULT_CONFIG = {
    "subreddits": ["PersonalFinanceCanada", "TorontoRealEstate", "durham", "ontario", "askTO",
                   "whitby", "ajax", "oshawa", "scarborough", "FirstTimeHomeBuyer"],
    "feeds": [],
    "local_terms": DEFAULT_LOCAL_TERMS,
    "extra_keywords": [],
    "alert_threshold": 45,
    "draft_threshold": 55,
    "max_age_hours": 72,
    "webhook_url": "",
    "user_agent": "script:whos-asking-monitor:0.1 (personal use)",
    "profile": {
        "area": "Durham Region (Whitby, Ajax, Pickering, Oshawa) and Scarborough, Ontario",
        "disclosure": "",
        "style_notes": "",
        "community_rules": {},
    },
}


def load_config(path: str | None) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if path and Path(path).exists():
        user = json.loads(Path(path).read_text())
        prof = {**cfg["profile"], **user.pop("profile", {})}
        cfg.update({k: v for k, v in user.items() if not k.startswith("_")})
        cfg["profile"] = prof
    elif path and path != "monitor_config.json":
        raise ValueError(f"config file not found: {path}")
    return cfg


def process(conn, cfg: dict, posts: list[Post], *, force: bool = False) -> list[dict]:
    """Classify unseen posts and store matches. Returns newly stored matches."""
    seen = store.known_uids(conn)
    cutoff = time.time() - cfg["max_age_hours"] * 3600
    new = []
    for p in posts:
        if p.uid in seen or (p.created_utc < cutoff and not force):
            continue
        m = classify(p.title, p.body, community=p.community, local_terms=cfg["local_terms"],
                     extra_keywords=cfg["extra_keywords"])
        if m.score < cfg["alert_threshold"] and not force:
            continue
        store.insert_match(conn, p, m.score, m.intents, m.reasons, m.local)
        seen.add(p.uid)
        new.append(store.get(conn, p.uid))
    return new


def _draft_and_save(conn, cfg, post: dict, offline: bool) -> dict:
    d = asdict(draft(post, post["intents"], cfg["profile"], offline=offline))
    store.save_draft(conn, post["uid"], d)
    return d


def _alert(conn, cfg, posts: list[dict], quiet: bool) -> None:
    for p in posts:
        text = format_alert(p)
        if not quiet:
            print(text)
        if cfg["webhook_url"]:
            try:
                send_webhook(cfg["webhook_url"], text)
            except Exception as e:  # never let a webhook failure stop the scan
                print(f"  webhook failed: {e}", file=sys.stderr)
    store.mark_alerted(conn, [p["uid"] for p in posts])


def run_scan(args, cfg, conn) -> list[dict]:
    rid, rsecret = os.environ.get("REDDIT_CLIENT_ID", ""), os.environ.get("REDDIT_CLIENT_SECRET", "")
    sources = []
    if cfg["subreddits"]:
        sources.append(RedditSource(cfg["subreddits"], cfg["user_agent"], rid, rsecret))
    if cfg["feeds"]:
        sources.append(FeedSource(cfg["feeds"], cfg["user_agent"]))
    posts: list[Post] = []
    for s in sources:
        got, errors = s.fetch()
        posts.extend(got)
        for e in errors:
            print(f"  source error: {e}", file=sys.stderr)
    new = process(conn, cfg, posts)
    print(f"Scanned {len(posts)} posts, {len(new)} new matches.")
    _alert(conn, cfg, new, args.quiet)
    if args.draft:
        for p in new:
            if p["score"] >= cfg["draft_threshold"]:
                _draft_and_save(conn, cfg, p, args.offline)
                print(f"  drafted reply for {p['uid']}")
    return new


def cmd_scan(args, cfg, conn):
    run_scan(args, cfg, conn)


def cmd_watch(args, cfg, conn):
    print(f"Watching every {args.interval}s. Ctrl-C to stop.")
    while True:
        try:
            run_scan(args, cfg, conn)
            if args.digest:
                write_digest(store.listing(conn), args.digest)
        except Exception as e:  # keep the watcher alive across transient failures
            print(f"scan failed: {e}", file=sys.stderr)
        time.sleep(args.interval)


def cmd_add(args, cfg, conn):
    text = sys.stdin.read() if args.text == "-" else args.text
    post = manual_post(text, source=args.source, community=args.community or "", url=args.url or "",
                       author=args.author or "")
    new = process(conn, cfg, [post], force=True)
    if not new:
        print("Already stored.")
        return
    p = new[0]
    print(format_alert(p))
    if args.draft:
        d = _draft_and_save(conn, cfg, p, args.offline)
        _print_draft(d)


def cmd_import(args, cfg, conn):
    posts = load_manual_file(args.file)
    new = process(conn, cfg, posts, force=args.all)
    print(f"{len(posts)} posts read, {len(new)} stored.")
    _alert(conn, cfg, new, args.quiet)


def cmd_list(args, cfg, conn):
    rows = store.listing(conn, statuses=args.status, min_score=args.min_score, limit=args.limit)
    for p in rows:
        flag = "D" if p["draft"] else " "
        print(f"{p['score']:>3} {flag} {p['status']:<9} {p['uid']:<28} {p['community']:<22} {p['title'][:70]}")
    print(f"{len(rows)} posts")


def _print_draft(d: dict) -> None:
    print("\n--- draft " + ("(suggest replying)" if d["should_reply"] else "(suggest SKIPPING)") + " ---")
    if d["reply"]:
        print(d["reply"])
    print(f"\nwhy: {d['reason']}")
    if d.get("follow_up_hint"):
        print(f"if they reply: {d['follow_up_hint']}")
    print(f"[{d['model']}]")


def cmd_show(args, cfg, conn):
    p = store.get(conn, args.uid)
    if not p:
        raise ValueError(f"no post {args.uid}")
    print(format_alert(p))
    print("\n" + "\n".join(f"  - {r}" for r in p["reasons"]))
    print(f"\n{p['body']}")
    if p["draft"]:
        _print_draft(p["draft"])


def cmd_draft(args, cfg, conn):
    p = store.get(conn, args.uid)
    if not p:
        raise ValueError(f"no post {args.uid}")
    _print_draft(_draft_and_save(conn, cfg, p, args.offline))


def cmd_mark(args, cfg, conn):
    if not store.set_status(conn, args.uid, args.status, args.note or ""):
        raise ValueError(f"no post {args.uid}")
    print(f"{args.uid} -> {args.status}")


def cmd_digest(args, cfg, conn):
    rows = store.listing(conn, statuses=args.status, min_score=args.min_score, limit=args.limit)
    write_digest(rows, args.out)
    print(f"Wrote {args.out} ({len(rows)} posts)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="asking_monitor", description=__doc__)
    p.add_argument("--db", default=os.environ.get("ASKING_DB", "asking.db"))
    p.add_argument("--config", default="monitor_config.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    def draft_opts(sp):
        sp.add_argument("--offline", action="store_true", help="use templates instead of Claude")

    s = sub.add_parser("scan", help="fetch sources once, alert on new matches")
    s.add_argument("--draft", action="store_true", help="draft replies for strong matches")
    s.add_argument("--quiet", action="store_true")
    draft_opts(s)
    s.set_defaults(func=cmd_scan)

    s = sub.add_parser("watch", help="scan repeatedly")
    s.add_argument("--interval", type=int, default=900, help="seconds between scans (default 900)")
    s.add_argument("--draft", action="store_true")
    s.add_argument("--quiet", action="store_true")
    s.add_argument("--digest", help="rewrite this HTML digest after each scan")
    draft_opts(s)
    s.set_defaults(func=cmd_watch)

    s = sub.add_parser("add", help="add a post you copied (e.g. from a Facebook group)")
    s.add_argument("text", help="post text, or - to read stdin")
    s.add_argument("--source", default="facebook")
    s.add_argument("--community", help="group or forum name")
    s.add_argument("--url")
    s.add_argument("--author")
    s.add_argument("--draft", action="store_true")
    draft_opts(s)
    s.set_defaults(func=cmd_add)

    s = sub.add_parser("import", help="import a JSON file of copied posts")
    s.add_argument("file")
    s.add_argument("--all", action="store_true", help="store even below the alert threshold")
    s.add_argument("--quiet", action="store_true")
    s.set_defaults(func=cmd_import)

    def list_opts(sp):
        sp.add_argument("--status", action="append", choices=store.STATUSES)
        sp.add_argument("--min-score", type=int, default=0)
        sp.add_argument("--limit", type=int, default=50)

    s = sub.add_parser("list", help="list stored matches")
    list_opts(s)
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="show a post, its match reasons and draft")
    s.add_argument("uid")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("draft", help="(re)draft a reply for a post")
    s.add_argument("uid")
    draft_opts(s)
    s.set_defaults(func=cmd_draft)

    s = sub.add_parser("mark", help="set status: replied, ignored, converted ...")
    s.add_argument("uid")
    s.add_argument("status", choices=store.STATUSES)
    s.add_argument("--note")
    s.set_defaults(func=cmd_mark)

    s = sub.add_parser("digest", help="write an HTML digest with drafts")
    s.add_argument("--out", default="digest.html")
    list_opts(s)
    s.set_defaults(func=cmd_digest)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg = load_config(args.config)
        conn = store.connect(args.db)
        args.func(args, cfg, conn)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return 0
