"""Turns validated TradingView alerts into orders, enforcing risk limits."""
import datetime as dt
import hmac
import json
import math
import threading


class Rejected(Exception):
    """Alert was refused; the message says why."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class TradingEngine:
    def __init__(self, config, broker, today=dt.date.today):
        self.cfg = config
        self.broker = broker
        self._today = today
        self._lock = threading.Lock()
        self._day = None
        self._day_start_equity = None
        self._trades_today = 0
        self.halted_reason = None

    def handle_alert(self, payload):
        """Validate and act on one alert. Returns a dict describing what happened."""
        if not isinstance(payload, dict):
            raise Rejected("payload must be a JSON object")
        if not hmac.compare_digest(str(payload.get("secret", "")), self.cfg.webhook_secret):
            raise Rejected("bad secret", status=401)

        symbol = str(payload.get("symbol", "")).upper().strip()
        action = str(payload.get("action", "")).lower().strip()
        try:
            price = float(payload.get("price"))
        except (TypeError, ValueError):
            raise Rejected("price must be a number")
        if not symbol or action not in ("buy", "sell"):
            raise Rejected("symbol and action ('buy' or 'sell') are required")
        if not math.isfinite(price) or price <= 0:
            raise Rejected("price must be positive")
        if self.cfg.allowed_symbols and symbol not in self.cfg.allowed_symbols:
            raise Rejected(f"{symbol} is not in ALLOWED_SYMBOLS", status=403)

        with self._lock:
            self.broker.mark(symbol, price)
            self._roll_day()
            if action == "buy":
                result = self._buy(symbol, price)
            else:
                # Selling to close is always allowed, even when halted — it reduces risk.
                result = self.broker.close(symbol, price)
                result = result or {"symbol": symbol, "side": "sell", "qty": 0, "note": "no open position"}
            self._journal(result)
            return result

    def _buy(self, symbol, price):
        if self.halted_reason:
            raise Rejected(f"trading halted: {self.halted_reason}", status=409)
        if self._trades_today >= self.cfg.max_trades_per_day:
            raise Rejected("MAX_TRADES_PER_DAY reached", status=409)
        if self.broker.position_qty(symbol) > 0:
            return {"symbol": symbol, "side": "buy", "qty": 0, "note": "already in position"}
        qty = math.floor(self.cfg.max_position_usd / price)
        if qty < 1:
            raise Rejected(f"MAX_POSITION_USD too small to buy one share at {price}", status=409)
        result = self.broker.buy(symbol, qty, price)
        self._trades_today += 1
        return result

    def _roll_day(self):
        today = self._today()
        equity = self.broker.equity()
        if today != self._day:
            self._day, self._day_start_equity, self._trades_today = today, equity, 0
            self.halted_reason = None
        loss = self._day_start_equity - equity
        if loss >= self.cfg.max_daily_loss_usd and not self.halted_reason:
            self.halted_reason = f"daily loss {loss:.2f} >= MAX_DAILY_LOSS_USD {self.cfg.max_daily_loss_usd:.2f}"

    def _journal(self, result):
        entry = dict(result, time=dt.datetime.now(dt.timezone.utc).isoformat())
        with open(self.cfg.journal_path, "a") as f:
            f.write(json.dumps(entry) + "\n")

    def status(self):
        with self._lock:
            return {
                "broker": self.cfg.broker,
                "live_trading": self.cfg.live_trading,
                "equity": round(self.broker.equity(), 2),
                "day_start_equity": self._day_start_equity,
                "trades_today": self._trades_today,
                "halted": self.halted_reason,
            }
