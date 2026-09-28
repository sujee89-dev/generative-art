"""Covered calls on stocks the stock bot holds (Interactive Brokers, paper unless IBKR_LIVE=true).

For each symbol in COVERED_CALL_SYMBOLS, checked hourly during US market hours:
  1. Reconcile: if IBKR shows fewer shares than the bot thinks (the call was assigned and the shares
     were called away), update the bot's records. Drop calls that have expired or been assigned.
  2. While the trend bot holds the stock, top the holding up to 100 shares (one contract), if
     100 shares cost no more than CC_MAX_SHARES_USD.
  3. Sell one call per 100 shares that isn't already covered: the expiry closest to CC_TARGET_DTE
     days (within CC_MIN_DTE..CC_MAX_DTE), at the lowest strike at least CC_OTM_PCT above the last
     close, as a limit order at the bid/ask midpoint. Unfilled orders are cancelled and retried
     at the next check, asking a little less each time (halfway to the bid, then the bid).
When the trend bot sells the shares, IBKRBroker calls `cover` first, which buys the calls back, so
a call is never left uncovered.
"""
import datetime as dt
import json
import logging
import os
import threading

from .brokers import BrokerError
from .stockdata import NEW_YORK, us_market_open

log = logging.getLogger("trading-bot")


def pick_expiry(expirations, today, min_dte=21, max_dte=49, target_dte=35):
    """The 'YYYYMMDD' expiry within [min_dte, max_dte] days closest to target_dte, or None."""
    best = None
    for exp in expirations:
        dte = (dt.datetime.strptime(exp, "%Y%m%d").date() - today).days
        if min_dte <= dte <= max_dte and (best is None or abs(dte - target_dte) < abs(best[1] - target_dte)):
            best = (exp, dte)
    return best[0] if best else None


def pick_strike(strikes, price, otm_pct=0.10):
    """The lowest strike at least otm_pct above price, or None."""
    return next((k for k in sorted(strikes) if k >= price * (1 + otm_pct)), None)


def limit_price(bid, ask, misses=0):
    """Asking price for selling a call, rounded down to a valid tick (0.05 from $3, else 0.01).

    First try the midpoint; after each unfilled attempt step down: halfway to the bid, then the
    bid. Never below the bid. (Free quotes are ~15 min delayed, so the midpoint can be stale.)
    """
    mid = (bid + ask) / 2 if ask else bid
    target = mid - min(misses, 2) / 2 * (mid - bid)
    tick = 0.05 if target >= 3 else 0.01
    return max(round(int(round(target / tick, 6)) * tick, 2), round(bid, 2))


class CoveredCallManager:
    def __init__(self, engine, symbols, state_path, otm_pct=0.10, min_dte=21, max_dte=49,
                 target_dte=35, max_shares_usd=30000.0, interval_s=3600, market_open=us_market_open,
                 today=None):
        self.engine = engine
        self.broker = engine.broker
        self.gw = engine.broker.gw
        self.symbols = symbols
        self.state_path = state_path
        self.otm_pct, self.min_dte, self.max_dte, self.target_dte = otm_pct, min_dte, max_dte, target_dte
        self.max_shares_usd = max_shares_usd
        self.interval_s = interval_s
        self._market_open = market_open
        self._today = today or (lambda: dt.datetime.now(NEW_YORK).date())
        self._stop = threading.Event()
        self._misses = {}  # symbol -> unfilled attempts in a row (lowers the asking price)
        self.calls = {}  # symbol -> [{"expiry", "strike", "qty", "premium"}] sold by the bot
        if os.path.exists(state_path):
            with open(state_path) as f:
                self.calls = json.load(f)

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.calls, f)
        os.replace(tmp, self.state_path)

    def _status(self, symbol, **fields):
        self.engine.auto_status[f"{symbol} calls"] = dict(
            fields, checked_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            open_calls=self.calls.get(symbol, []))

    def cover(self, symbol):
        """Buy back every call the bot sold on `symbol`. Called before the shares are sold."""
        remaining = []
        for c in self.calls.get(symbol, []):
            if self.gw.short_calls(symbol).get((c["expiry"], float(c["strike"])), 0) <= 0:
                continue  # already expired or assigned
            order_id, filled, avg = self.gw.call_order(symbol, c["expiry"], c["strike"], "BUY", c["qty"])
            self.engine._journal({"symbol": symbol, "side": "buy_to_close_call", "expiry": c["expiry"],
                                  "strike": c["strike"], "qty": filled, "price": avg, "order_id": order_id})
            if filled < c["qty"]:
                remaining.append(dict(c, qty=c["qty"] - int(filled)))
        self.calls[symbol] = remaining
        self._save()
        if remaining:
            raise BrokerError(f"couldn't buy back all {symbol} calls; not selling the shares yet")

    def check(self):
        if not self._market_open():
            return
        for symbol in self.symbols:
            try:
                with self.engine._lock:
                    self._check_symbol(symbol)
            except BrokerError as e:
                log.error("covered calls %s: %s", symbol, e)
                self._status(symbol, error=str(e))

    def _check_symbol(self, symbol):
        broker, gw = self.broker, self.gw
        broker._check_account()

        # 1. Reconcile with IBKR: shares called away, calls expired or assigned.
        held = broker.held.get(symbol, 0)
        if held > 0:
            actual = gw.position(symbol)
            if actual < held:
                self.engine._journal({"symbol": symbol, "side": "called_away", "qty": held - max(actual, 0)})
                if actual > 0:
                    broker.held[symbol] = actual
                else:
                    broker.held.pop(symbol, None)
                broker._save()
                held = broker.held.get(symbol, 0)
        open_now = gw.short_calls(symbol)
        tracked = [c for c in self.calls.get(symbol, []) if open_now.get((c["expiry"], float(c["strike"])), 0) > 0]
        if tracked != self.calls.get(symbol, []):
            self.calls[symbol] = tracked
            self._save()

        if held <= 0:
            return self._status(symbol, note="trend bot isn't holding shares; no calls to sell")
        price = broker.last_price.get(symbol)
        if not price:
            return self._status(symbol, note="waiting for a price from the trend check")

        # 2. Top up to a round lot of 100 shares.
        if held < 100:
            if price * 100 > self.max_shares_usd:
                return self._status(symbol, note=f"100 shares cost more than CC_MAX_SHARES_USD ({self.max_shares_usd:.0f})")
            if self.engine.halted_reason:
                return self._status(symbol, note=f"trading halted: {self.engine.halted_reason}")
            result = broker.buy(symbol, 100 - held, price)
            result["note"] = "top-up to 100 shares for covered calls"
            self.engine._journal(result)
            held = broker.held.get(symbol, 0)

        # 3. Sell one call per uncovered 100 shares.
        to_sell = int(held // 100) - sum(c["qty"] for c in self.calls.get(symbol, []))
        if to_sell <= 0:
            return self._status(symbol, note="all shares covered")
        expirations, strikes = gw.call_chain(symbol)
        expiry = pick_expiry(expirations, self._today(), self.min_dte, self.max_dte, self.target_dte)
        strike = pick_strike(strikes, price, self.otm_pct)
        if not expiry or not strike:
            return self._status(symbol, note="no suitable expiry/strike right now")
        bid, ask = gw.call_quote(symbol, expiry, strike)
        if not bid:
            return self._status(symbol, note=f"no bid for {expiry} {strike} call yet")
        limit = limit_price(bid, ask, self._misses.get(symbol, 0))
        order_id, filled, avg = gw.call_order(symbol, expiry, strike, "SELL", to_sell, limit=limit)
        self._misses[symbol] = 0 if filled > 0 else self._misses.get(symbol, 0) + 1
        if filled > 0:
            self.calls.setdefault(symbol, []).append(
                {"expiry": expiry, "strike": strike, "qty": int(filled), "premium": avg})
            self._save()
            self.engine._journal({"symbol": symbol, "side": "sell_call", "expiry": expiry, "strike": strike,
                                  "qty": filled, "price": avg, "order_id": order_id})
            log.info("covered calls: sold %d %s %s %s call(s) at %.2f", filled, symbol, expiry, strike, avg)
        self._status(symbol, last_order={"expiry": expiry, "strike": strike, "limit": limit,
                                         "filled": filled, "order_id": order_id})

    def run(self):
        log.info("covered calls on %s (%.0f%% OTM, ~%d days)", ",".join(self.symbols),
                 self.otm_pct * 100, self.target_dte)
        while not self._stop.is_set():
            try:
                self.check()
            except Exception:
                log.exception("covered-call check crashed")
            self._stop.wait(self.interval_s)

    def start(self):
        threading.Thread(target=self.run, daemon=True, name="covered-calls").start()

    def stop(self):
        self._stop.set()
