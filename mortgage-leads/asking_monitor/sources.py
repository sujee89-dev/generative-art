"""Post sources: Reddit, RSS/Atom feeds and manually captured posts.

Facebook: Meta retired the Groups API in 2024, and scraping groups breaks
Facebook's terms, so group posts are captured by hand (``add`` command or a
JSON file) from groups you are a member of and whose rules allow it.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


@dataclass
class Post:
    source: str        # reddit | rss | facebook | manual
    post_id: str       # unique within source
    community: str     # subreddit, forum or group name
    title: str
    body: str
    url: str
    author: str
    created_utc: float

    @property
    def uid(self) -> str:
        return f"{self.source}:{self.post_id}"

    def to_dict(self) -> dict:
        return asdict(self)


class SourceError(Exception):
    pass


def _http_get(url: str, headers: dict[str, str], data: bytes | None = None, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:  # urllib raises several unrelated types
        raise SourceError(f"{url}: {e}") from e


class RedditSource:
    """Reads /new from each subreddit.

    With REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (a free "script" app from
    https://www.reddit.com/prefs/apps) it uses the official OAuth API, which is
    what Reddit's API terms expect. Without them it falls back to the public
    JSON listing, which Reddit rate-limits heavily.
    """

    def __init__(self, subreddits: list[str], user_agent: str, client_id: str = "",
                 client_secret: str = "", limit: int = 100):
        self.subreddits = subreddits
        self.user_agent = user_agent
        self.client_id = client_id
        self.client_secret = client_secret
        self.limit = limit
        self._token: str | None = None
        self._token_expiry = 0.0

    def _auth_headers(self) -> tuple[str, dict[str, str]]:
        headers = {"User-Agent": self.user_agent}
        if not (self.client_id and self.client_secret):
            return "https://www.reddit.com", headers
        if not self._token or time.time() > self._token_expiry - 60:
            basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
            raw = _http_get(
                "https://www.reddit.com/api/v1/access_token",
                {**headers, "Authorization": f"Basic {basic}"},
                data=b"grant_type=client_credentials",
            )
            tok = json.loads(raw)
            if "access_token" not in tok:
                raise SourceError(f"Reddit auth failed: {tok}")
            self._token = tok["access_token"]
            self._token_expiry = time.time() + tok.get("expires_in", 3600)
        return "https://oauth.reddit.com", {**headers, "Authorization": f"Bearer {self._token}"}

    def fetch(self) -> tuple[list[Post], list[str]]:
        posts, errors = [], []
        for sub in self.subreddits:
            try:
                base, headers = self._auth_headers()
                suffix = "" if "oauth" in base else ".json"
                url = f"{base}/r/{urllib.parse.quote(sub)}/new{suffix}?limit={self.limit}&raw_json=1"
                data = json.loads(_http_get(url, headers))
                posts.extend(parse_reddit_listing(data))
            except (SourceError, ValueError) as e:
                errors.append(f"r/{sub}: {e}")
        return posts, errors


def parse_reddit_listing(data: dict) -> list[Post]:
    out = []
    for child in data.get("data", {}).get("children", []):
        d = child.get("data", {})
        if d.get("stickied") or d.get("removed_by_category"):
            continue
        out.append(Post(
            source="reddit", post_id=d.get("id", ""), community=f"r/{d.get('subreddit', '')}",
            title=d.get("title", ""), body=d.get("selftext", ""),
            url="https://www.reddit.com" + d.get("permalink", ""),
            author=d.get("author", ""), created_utc=float(d.get("created_utc", 0)),
        ))
    return out


_TAG = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return html.unescape(_TAG.sub(" ", s or "")).strip()


def _ts(s: str) -> float:
    if not s:
        return time.time()
    try:
        return parsedate_to_datetime(s).timestamp()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def parse_feed(xml_bytes: bytes, community: str) -> list[Post]:
    """Parse RSS 2.0 or Atom into posts."""
    root = ET.fromstring(xml_bytes)
    atom = "{http://www.w3.org/2005/Atom}"
    posts = []
    if root.tag == f"{atom}feed":
        for e in root.findall(f"{atom}entry"):
            link = e.find(f"{atom}link")
            url = link.get("href", "") if link is not None else ""
            body = e.findtext(f"{atom}content") or e.findtext(f"{atom}summary") or ""
            posts.append(Post(
                source="rss", post_id=e.findtext(f"{atom}id") or url, community=community,
                title=_strip_html(e.findtext(f"{atom}title") or ""), body=_strip_html(body), url=url,
                author=e.findtext(f"{atom}author/{atom}name") or "",
                created_utc=_ts(e.findtext(f"{atom}updated") or e.findtext(f"{atom}published") or ""),
            ))
    else:
        for it in root.iter("item"):
            url = it.findtext("link") or ""
            posts.append(Post(
                source="rss", post_id=it.findtext("guid") or url, community=community,
                title=_strip_html(it.findtext("title") or ""),
                body=_strip_html(it.findtext("description") or ""), url=url,
                author=it.findtext("author") or it.findtext("{http://purl.org/dc/elements/1.1/}creator") or "",
                created_utc=_ts(it.findtext("pubDate") or ""),
            ))
    return posts


class FeedSource:
    def __init__(self, feeds: list[dict], user_agent: str):
        self.feeds = feeds  # [{"name": ..., "url": ...}]
        self.user_agent = user_agent

    def fetch(self) -> tuple[list[Post], list[str]]:
        posts, errors = [], []
        for f in self.feeds:
            try:
                posts.extend(parse_feed(_http_get(f["url"], {"User-Agent": self.user_agent}), f["name"]))
            except (SourceError, ET.ParseError) as e:
                errors.append(f"{f['name']}: {e}")
        return posts, errors


def manual_post(text: str, *, source: str = "facebook", community: str = "", url: str = "",
                author: str = "", title: str = "") -> Post:
    """Build a post from text you copied out of a Facebook group or elsewhere."""
    text = text.strip()
    if not title:
        first = text.splitlines()[0] if text else ""
        title = first[:120]
    pid = hashlib.sha1((url or f"{community}\n{text}").encode()).hexdigest()[:12]
    return Post(source=source, post_id=pid, community=community, title=title, body=text,
                url=url, author=author, created_utc=datetime.now(timezone.utc).timestamp())


def load_manual_file(path: str) -> list[Post]:
    """JSON list of {"text", "community", "url", "author", "source"} objects."""
    with open(path, encoding="utf-8") as fh:
        items = json.load(fh)
    return [manual_post(i["text"], source=i.get("source", "facebook"), community=i.get("community", ""),
                        url=i.get("url", ""), author=i.get("author", ""), title=i.get("title", ""))
            for i in items]
