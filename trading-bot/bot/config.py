"""Settings loaded from environment variables."""
import os
from dataclasses import dataclass, field

ALPACA_PAPER_URL = "https://paper-api.alpaca.markets"
ALPACA_LIVE_URL = "https://api.alpaca.markets"
BINANCE_TESTNET_URL = "https://testnet.binance.vision"
BINANCE_LIVE_URL = "https://api.binance.com"


@dataclass
class Config:
    webhook_secret: str
    broker: str = "paper"  # "paper" (built-in simulator), "alpaca" or "binance"
    alpaca_key: str = ""
    alpaca_secret: str = ""
    alpaca_base_url: str = ALPACA_PAPER_URL
    binance_key: str = ""
    binance_secret: str = ""
    binance_base_url: str = BINANCE_TESTNET_URL
    live_trading: bool = False
    max_position_usd: float = 1000.0
    max_daily_loss_usd: float = 200.0
    max_trades_per_day: int = 10
    allowed_symbols: set = field(default_factory=set)  # empty = any symbol
    paper_starting_cash: float = 10000.0
    journal_path: str = "trades.jsonl"
    state_path: str = "positions.json"
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
            binance_key=env.get("BINANCE_KEY", ""),
            binance_secret=env.get("BINANCE_SECRET", ""),
            live_trading=env.get("LIVE_TRADING", "").lower() == "true",
            max_position_usd=float(env.get("MAX_POSITION_USD", 1000)),
            max_daily_loss_usd=float(env.get("MAX_DAILY_LOSS_USD", 200)),
            max_trades_per_day=int(env.get("MAX_TRADES_PER_DAY", 10)),
            allowed_symbols={s.strip().upper() for s in env.get("ALLOWED_SYMBOLS", "").split(",") if s.strip()},
            paper_starting_cash=float(env.get("PAPER_STARTING_CASH", 10000)),
            journal_path=env.get("JOURNAL_PATH", "trades.jsonl"),
            state_path=env.get("STATE_PATH", "positions.json"),
            port=int(env.get("PORT", 8080)),
        )
        # Real money only when explicitly requested.
        cfg.alpaca_base_url = ALPACA_LIVE_URL if cfg.live_trading else ALPACA_PAPER_URL
        cfg.binance_base_url = BINANCE_LIVE_URL if cfg.live_trading else BINANCE_TESTNET_URL
        if cfg.broker not in ("paper", "alpaca", "binance"):
            raise ValueError("BROKER must be 'paper', 'alpaca' or 'binance'")
        if cfg.broker == "alpaca" and not (cfg.alpaca_key and cfg.alpaca_secret):
            raise ValueError("ALPACA_KEY and ALPACA_SECRET are required when BROKER=alpaca")
        if cfg.broker == "binance" and not (cfg.binance_key and cfg.binance_secret):
            raise ValueError("BINANCE_KEY and BINANCE_SECRET are required when BROKER=binance")
        return cfg
