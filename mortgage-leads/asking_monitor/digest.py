"""HTML digest of matched posts with their draft replies, ready to review."""

from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

_CSS = """
:root { --bg:#fbfaf7; --fg:#1d1d1f; --muted:#6b6b70; --line:#e3e1dc; --card:#ffffff;
        --accent:#0f6b5c; --chip:#eef4f2; --local:#8a4b00; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#141416; --fg:#ececec; --muted:#9a9aa0; --line:#2c2c30; --card:#1b1b1e;
          --accent:#4fc1a8; --chip:#1f2a28; --local:#f0b35a; }
}
* { box-sizing:border-box; }
body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--fg);
       font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:860px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; } .sub { color:var(--muted); margin:0 0 20px; font-size:13px; }
article { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px;
          margin-bottom:16px; }
article h2 { font-size:16px; margin:0 0 4px; } article h2 a { color:inherit; }
.meta { color:var(--muted); font-size:13px; }
.score { font-weight:700; color:var(--accent); margin-right:6px; }
.local { color:var(--local); font-weight:600; }
.chip { display:inline-block; background:var(--chip); border-radius:4px; padding:1px 6px;
        margin:6px 4px 0 0; font-size:12px; }
details { margin-top:10px; } summary { cursor:pointer; color:var(--muted); font-size:13px; }
.body { white-space:pre-wrap; font-size:14px; margin-top:6px; }
.draft { border-left:3px solid var(--accent); padding:8px 12px; margin-top:12px; white-space:pre-wrap; }
.why { font-size:13px; color:var(--muted); margin-top:6px; }
button { font:inherit; font-size:13px; margin-top:8px; padding:4px 10px; border-radius:6px;
         border:1px solid var(--line); background:var(--chip); color:var(--fg); cursor:pointer; }
.note { color:var(--muted); font-size:12px; margin-top:24px; }
"""

_JS = """
document.querySelectorAll('button[data-copy]').forEach(b => b.addEventListener('click', () => {
  const t = document.getElementById(b.dataset.copy).innerText;
  navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy draft', 1500); });
}));
"""


def _ago(ts: float) -> str:
    mins = int((datetime.now(timezone.utc).timestamp() - ts) / 60)
    if mins < 60:
        return f"{mins}m ago"
    if mins < 60 * 48:
        return f"{mins // 60}h ago"
    return f"{mins // 1440}d ago"


def write_digest(posts: list[dict], path: str | Path) -> None:
    cards = []
    for i, p in enumerate(posts):
        esc = html.escape
        chips = "".join(f"<span class='chip'>{esc(r)}</span>" for r in p["reasons"])
        draft_html = ""
        d = p.get("draft")
        if d:
            if d.get("should_reply"):
                draft_html = (f"<div class='draft' id='d{i}'>{esc(d['reply'])}</div>"
                              f"<button data-copy='d{i}'>Copy draft</button>")
            else:
                draft_html = "<div class='why'><b>Suggest skipping.</b></div>"
            draft_html += f"<div class='why'>{esc(d.get('reason', ''))}</div>"
            if d.get("follow_up_hint"):
                draft_html += f"<div class='why'>If they reply: {esc(d['follow_up_hint'])}</div>"
        local_html = " · <span class='local'>local</span>" if p["local"] else ""
        title = esc(p["title"] or "(untitled)")
        link = f"<a href='{esc(p['url'])}' target='_blank' rel='noopener'>{title}</a>" if p["url"] else title
        cards.append(
            "<article>"
            f"<h2><span class='score'>{p['score']}</span>{link}</h2>"
            f"<div class='meta'>{esc(p['community'])} · {esc(p['source'])} · {_ago(p['created_utc'])}"
            f" · {esc(p['status'])} · id {esc(p['uid'])}"
            f"{local_html}</div>"
            f"<div>{chips}</div>"
            f"<details><summary>Original post</summary><div class='body'>{esc(p['body'][:3000])}</div></details>"
            f"{draft_html}</article>"
        )
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    doc = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>Who's asking</title><style>{_CSS}</style></head><body><main>"
        f"<h1>Who's asking</h1><p class='sub'>{len(posts)} posts · generated {now}</p>"
        + ("".join(cards) or "<p>No matching posts yet.</p>")
        + "<p class='note'>Drafts are starting points. Read the thread and the community's rules, "
          "edit in your own voice, and post it yourself. Never DM people who haven't asked you to.</p>"
        f"</main><script>{_JS}</script></body></html>"
    )
    Path(path).write_text(doc, encoding="utf-8")
