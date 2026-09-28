"""Free daily price history for US stocks/ETFs, used by AutoTrader for the stock bot.

Tries Stooq's CSV download first, then Yahoo's chart API. Only *completed* trading days are
returned: today's bar is dropped until the US market has closed (16:30 New York time).
"""
import csv
import datetime as dt
import io
import json
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from .brokers import BrokerError

NEW_YORK = ZoneInfo("America/New_York")
MARKET_OPEN, MARKET_CLOSE, MARKET_DONE = dt.time(9, 30), dt.time(16, 0), dt.time(16, 30)
HEADERS = {"User-Agent": "Mozilla/5.0 (trading-bot)"}


def _get(url, opener):
    req = urllib.request.Request(url, headers=HEADERS)
    with opener(req, timeout=15) as resp:
        return resp.read().decode()


def _completed(rows, now):
    """Keep (date, close) rows for finished sessions, as [(epoch_of_date, close)], oldest first."""
    now_ny = now.astimezone(NEW_YORK)
    today_done = now_ny.time() >= MARKET_DONE
    out = []
    for day, close in sorted(rows):
        if day > now_ny.date() or (day == now_ny.date() and not today_done):
            continue
        epoch = int(dt.datetime.combine(day, dt.time(), dt.timezone.utc).timestamp())
        out.append((epoch, close))
    return out


def _stooq(symbol, opener):
    text = _get(f"https://stooq.com/q/d/l/?s={urllib.parse.quote(symbol.lower())}.us&i=d", opener)
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            rows.append((dt.date.fromisoformat(r["Date"]), float(r["Close"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        raise ValueError(f"Stooq returned no data: {text[:80]!r}")
    return rows


def _yahoo(symbol, opener):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
           "?range=2y&interval=1d")
    result = json.loads(_get(url, opener))["chart"]["result"][0]
    closes = result["indicators"]["quote"][0]["close"]
    rows = []
    for ts, close in zip(result["timestamp"], closes):
        if close is not None:
            rows.append((dt.datetime.fromtimestamp(ts, NEW_YORK).date(), float(close)))
    if not rows:
        raise ValueError("Yahoo returned no data")
    return rows


def fetch_stock_daily_candles(symbol, opener=urllib.request.urlopen, now=None):
    """Completed daily closes for a US ticker like 'SPY', as [(epoch, close)], oldest first."""
    now = now or dt.datetime.now(dt.timezone.utc)
    errors = []
    for source in (_stooq, _yahoo):
        try:
            return _completed(source(symbol, opener), now)
        except (urllib.error.URLError, ValueError, KeyError, IndexError, TypeError) as e:
            errors.append(f"{source.__name__[1:]}: {e}")
    raise BrokerError(f"no price data for {symbol} ({'; '.join(errors)})")


def us_market_open(now=None):
    """True during regular US trading hours (Mon-Fri 9:30-16:00 New York; holidays not included)."""
    now_ny = (now or dt.datetime.now(dt.timezone.utc)).astimezone(NEW_YORK)
    return now_ny.weekday() < 5 and MARKET_OPEN <= now_ny.time() < MARKET_CLOSE
