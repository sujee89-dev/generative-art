"""Reads the daily chart itself and trades the Trend (200 SMA) strategy, no TradingView needed.

Works for crypto (Kraken candles) and stocks (see stockdata.py) — pass the matching `fetch`.

Same rule as "Trend (200 SMA)" in pine/trend_breakout_strategy.pine, on completed daily candles:
  - flat and close > 200-day SMA                  -> buy
  - holding and close < 200-day SMA * (1 - buffer) -> sell
"""
import datetime as dt
import json
import logging
import threading
import urllib.error
import urllib.parse
import urllib.request

from .brokers import BrokerError, KrakenBroker, split_pair
from .engine import Rejected

log = logging.getLogger("trading-bot")
KRAKEN_OHLC_URL = "https://api.kraken.com/0/public/OHLC"


def fetch_kraken_daily_candles(symbol, opener=urllib.request.urlopen):
    """Completed daily candles for e.g. 'BTCCAD' from Kraken's public API, as [(open_time, close)], oldest first."""
    base, quote = split_pair(symbol)
    pair = KrakenBroker.ALIASES.get(base, base) + quote
    url = KRAKEN_OHLC_URL + "?" + urllib.parse.urlencode({"pair": pair, "interval": 1440})
    try:
        with opener(urllib.request.Request(url), timeout=15) as resp:
            body = json.loads(resp.read())
    except (urllib.error.URLError, ValueError) as e:
        raise BrokerError(f"Kraken OHLC for {symbol} failed: {e}")
    if body.get("error"):
        raise BrokerError(f"Kraken OHLC for {symbol} failed: {', '.join(body['error'])}")
    rows = next(v for k, v in body["result"].items() if k != "last")
    # The newest row is today's candle, still forming; drop it so we only act on closed days.
    return [(int(r[0]), float(r[4])) for r in rows[:-1]]


def trend_signal(closes, holding, sma_len=200, exit_buffer=0.03):
    """Return ('buy' | 'sell' | None, sma) for the latest close."""
    if len(closes) < sma_len:
        return None, None
    sma = sum(closes[-sma_len:]) / sma_len
    close = closes[-1]
    if not holding and close > sma:
        return "buy", sma
    if holding and close < sma * (1 - exit_buffer):
        return "sell", sma
    return None, sma


class AutoTrader:
    def __init__(self, engine, symbol, sma_len=200, exit_buffer=0.03, interval_s=3600,
                 fetch=fetch_kraken_daily_candles, crypto=True, market_open=None):
        self.engine = engine
        self.symbol = symbol
        self.sma_len = sma_len
        self.exit_buffer = exit_buffer
        self.interval_s = interval_s
        self._fetch = fetch
        self.crypto = crypto
        self._market_open = market_open  # e.g. stockdata.us_market_open; None = always open (crypto)
        self._last_candle = None
        self._stop = threading.Event()

    def check(self):
        """Evaluate the newest completed daily candle once; act on it if it gives a signal."""
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        try:
            candles = self._fetch(self.symbol)
        except BrokerError as e:
            log.error("auto-trader: %s", e)
            self.engine.auto_status[self.symbol] = {"checked_at": now, "error": str(e)}
            return None
        if not candles:
            self.engine.auto_status[self.symbol] = {"checked_at": now, "error": "no completed candles"}
            return None
        candle_time, close = candles[-1]
        if candle_time == self._last_candle:
            return None  # already handled this day's candle
        holding = self.engine.broker.position_qty(self.symbol) > 0
        action, sma = trend_signal([c for _, c in candles], holding, self.sma_len, self.exit_buffer)
        status = {
            "checked_at": now,
            "symbol": self.symbol,
            "candle": dt.datetime.fromtimestamp(candle_time, dt.timezone.utc).date().isoformat(),
            "close": close,
            "sma": round(sma, 2) if sma else None,
            "holding": holding,
            "signal": action,
        }
        result = None
        if action and self._market_open and not self._market_open():
            # Act on this candle at the first check after the market opens.
            status["waiting"] = "market closed"
            self.engine.auto_status[self.symbol] = status
            return None
        if action:
            try:
                result = self.engine.execute(self.symbol, action, close, crypto=self.crypto)
                log.info("auto-trader %s: %s", action, result)
            except Rejected as e:
                log.error("auto-trader %s refused: %s", action, e)
                status["error"] = str(e)
            except BrokerError as e:
                # Probably temporary (network, exchange): retry at the next check.
                log.error("auto-trader %s failed, will retry: %s", action, e)
                status["error"] = str(e)
                self.engine.auto_status[self.symbol] = status
                return None
        self._last_candle = candle_time
        status["result"] = result
        self.engine.auto_status[self.symbol] = status
        return result

    def run(self):
        log.info("auto-trader on for %s (SMA %d, exit buffer %.1f%%), checking every %ds",
                 self.symbol, self.sma_len, self.exit_buffer * 100, self.interval_s)
        while not self._stop.is_set():
            try:
                self.check()
            except Exception:  # keep the loop alive; the next check may succeed
                log.exception("auto-trader check crashed")
            self._stop.wait(self.interval_s)

    def start(self):
        threading.Thread(target=self.run, daemon=True, name="auto-trader").start()

    def stop(self):
        self._stop.set()
