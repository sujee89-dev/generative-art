"""Settings loaded from environment variables."""
import os
from dataclasses import dataclass, field

ALPACA_PAPER_URL = "https://paper-api.alpaca.markets"
ALPACA_LIVE_URL = "https://api.alpaca.markets"


@dataclass
class Config:
    webhook_secret: str
    broker: str = "paper"  # "paper" (built-in simulator) or "alpaca"
    alpaca_key: str = ""
    alpaca_secret: str = ""
    alpaca_base_url: str = ALPACA_PAPER_URL
    live_trading: bool = False
    max_position_usd: float = 1000.0
    max_daily_loss_usd: float = 200.0
    max_trades_per_day: int = 10
    allowed_symbols: set = field(default_factory=set)  # empty = any symbol
    paper_starting_cash: float = 10000.0
    journal_path: str = "trades.jsonl"
    port: int = 8080

    @classmethod
    def from_env(cls, env=os.environ):
        secret = env.get("WEBHOOK_SECRET", "")
        if len(secret) < 12:
            raise ValueError("WEBHOOK_SECRET must be set and at least 12 characters long")
        cfg = cls(
            webhook_secret=secret,
            broker=env.get("BROKER", "paper").lower(),
            alpaca_key=env.get("ALPACA_KEY", ""),
            alpaca_secret=env.get("ALPACA_SECRET", ""),
            live_trading=env.get("LIVE_TRADING", "").lower() == "true",
            max_position_usd=float(env.get("MAX_POSITION_USD", 1000)),
            max_daily_loss_usd=float(env.get("MAX_DAILY_LOSS_USD", 200)),
            max_trades_per_day=int(env.get("MAX_TRADES_PER_DAY", 10)),
            allowed_symbols={s.strip().upper() for s in env.get("ALLOWED_SYMBOLS", "").split(",") if s.strip()},
            paper_starting_cash=float(env.get("PAPER_STARTING_CASH", 10000)),
            journal_path=env.get("JOURNAL_PATH", "trades.jsonl"),
            port=int(env.get("PORT", 8080)),
        )
        # Real money only when explicitly requested.
        cfg.alpaca_base_url = ALPACA_LIVE_URL if cfg.live_trading else ALPACA_PAPER_URL
        if cfg.broker not in ("paper", "alpaca"):
            raise ValueError("BROKER must be 'paper' or 'alpaca'")
        if cfg.broker == "alpaca" and not (cfg.alpaca_key and cfg.alpaca_secret):
            raise ValueError("ALPACA_KEY and ALPACA_SECRET are required when BROKER=alpaca")
        return cfg
