"""Alerts: terminal output plus an optional Slack / Discord / generic webhook."""

from __future__ import annotations

import json
import urllib.request


def format_alert(post: dict) -> str:
    where = f"{post['community']} ({post['source']})"
    local = " · LOCAL" if post.get("local") else ""
    return (f"[{post['score']}{local}] {post['title'][:140]}\n"
            f"    {where} · {', '.join(post['intents'])}\n    {post['url'] or '(no link)'}")


def send_webhook(url: str, text: str, timeout: int = 15) -> None:
    # Slack reads "text", Discord reads "content"; generic receivers get both.
    payload = {"text": text, "content": text[:1900]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout):
        pass
