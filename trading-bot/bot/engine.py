"""Turns validated trade signals (TradingView alerts or AutoTrader) into orders, enforcing risk limits."""
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
    def __init__(self, config, broker, today=None):
        self.cfg = config
        self.broker = broker
        # Days roll over at midnight UTC (crypto trades 24/7, so pick one fixed clock).
        self._today = today or (lambda: dt.datetime.now(dt.timezone.utc).date())
        self._lock = threading.Lock()
        self._day = None
        self._day_start_equity = None
        self._trades_today = 0
        self.halted_reason = None
        self.auto_status = {}  # symbol -> last AutoTrader check, shown on /status
        self.news_guard = None  # optional NewsGuard: blocks new buys after severe news

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
        crypto_only = self.cfg.broker in ("binance", "kraken")
        crypto = str(payload.get("type", "")).lower() == "crypto" or crypto_only
        if crypto_only and payload.get("type") not in (None, "crypto"):
            raise Rejected(f"{self.cfg.broker} only trades crypto")
        if not symbol or action not in ("buy", "sell"):
            raise Rejected("symbol and action ('buy' or 'sell') are required")
        if not math.isfinite(price) or price <= 0:
            raise Rejected("price must be positive")
        if self.cfg.allowed_symbols and symbol not in self.cfg.allowed_symbols:
            raise Rejected(f"{symbol} is not in ALLOWED_SYMBOLS", status=403)

        return self.execute(symbol, action, price, crypto)

    def execute(self, symbol, action, price, crypto):
        """Place a validated buy/sell, enforcing the risk limits. Used by webhooks and AutoTrader."""
        with self._lock:
            self.broker.mark(symbol, price)
            self._roll_day()
            if action == "buy":
                result = self._buy(symbol, price, crypto)
            else:
                # Selling to close is always allowed, even when halted — it reduces risk.
                result = self.broker.close(symbol, price)
                result = result or {"symbol": symbol, "side": "sell", "qty": 0, "note": "no open position"}
            self._journal(result)
            return result

    def _buy(self, symbol, price, crypto):
        if self.halted_reason:
            raise Rejected(f"trading halted: {self.halted_reason}", status=409)
        if self._trades_today >= self.cfg.max_trades_per_day:
            raise Rejected("MAX_TRADES_PER_DAY reached", status=409)
        if self.broker.position_qty(symbol) > 0:
            return {"symbol": symbol, "side": "buy", "qty": 0, "note": "already in position"}
        self.check_news(symbol)
        if crypto:
            # Crypto can be bought in fractions; round down to 6 decimals.
            qty = math.floor(self.cfg.max_position_usd / price * 1e6) / 1e6
        else:
            qty = math.floor(self.cfg.max_position_usd / price)
        if qty <= 0:
            raise Rejected(f"MAX_POSITION_USD too small to buy {symbol} at {price}", status=409)
        result = self.broker.buy(symbol, qty, price, crypto=crypto)
        self._trades_today += 1
        return result

    def check_news(self, symbol):
        """Raise Rejected if a news pause blocks buying `symbol`. Sells are never blocked."""
        reason = self.news_guard.blocked(symbol) if self.news_guard else None
        if reason:
            raise Rejected(reason, status=409)

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
                "auto_trader": self.auto_status or None,
            }
