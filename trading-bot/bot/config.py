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
    broker: str = "paper"  # "paper" (built-in simulator), "alpaca", "binance" or "kraken"
    alpaca_key: str = ""
    alpaca_secret: str = ""
    alpaca_base_url: str = ALPACA_PAPER_URL
    binance_key: str = ""
    binance_secret: str = ""
    binance_base_url: str = BINANCE_TESTNET_URL
    kraken_key: str = ""
    kraken_secret: str = ""
    live_trading: bool = False
    max_position_usd: float = 1000.0
    max_daily_loss_usd: float = 200.0
    max_trades_per_day: int = 10
    allowed_symbols: set = field(default_factory=set)  # empty = any symbol
    paper_starting_cash: float = 10000.0
    journal_path: str = "trades.jsonl"
    state_path: str = "positions.json"
    port: int = 8080
    # AutoTrader: read the daily Kraken chart and trade Trend (200 SMA) without TradingView.
    auto_trade_symbol: str = ""  # e.g. "BTCCAD"; empty = off (webhooks only)
    trend_sma: int = 200
    trend_exit_buffer_pct: float = 3.0
    auto_check_minutes: int = 60
    # Telegram: trade alerts and /status, /pause, /resume from your phone. Empty token = off.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

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
            kraken_key=env.get("KRAKEN_KEY", ""),
            kraken_secret=env.get("KRAKEN_SECRET", ""),
            live_trading=env.get("LIVE_TRADING", "").lower() == "true",
            max_position_usd=float(env.get("MAX_POSITION_USD", 1000)),
            max_daily_loss_usd=float(env.get("MAX_DAILY_LOSS_USD", 200)),
            max_trades_per_day=int(env.get("MAX_TRADES_PER_DAY", 10)),
            allowed_symbols={s.strip().upper() for s in env.get("ALLOWED_SYMBOLS", "").split(",") if s.strip()},
            paper_starting_cash=float(env.get("PAPER_STARTING_CASH", 10000)),
            journal_path=env.get("JOURNAL_PATH", "trades.jsonl"),
            state_path=env.get("STATE_PATH", "positions.json"),
            port=int(env.get("PORT", 8080)),
            auto_trade_symbol=env.get("AUTO_TRADE_SYMBOL", "").strip().upper(),
            trend_sma=int(env.get("TREND_SMA", 200)),
            trend_exit_buffer_pct=float(env.get("TREND_EXIT_BUFFER_PCT", 3)),
            auto_check_minutes=int(env.get("AUTO_CHECK_MINUTES", 60)),
            telegram_bot_token=env.get("TELEGRAM_BOT_TOKEN", "").strip(),
            telegram_chat_id=env.get("TELEGRAM_CHAT_ID", "").strip(),
        )
        # Real money only when explicitly requested.
        cfg.alpaca_base_url = ALPACA_LIVE_URL if cfg.live_trading else ALPACA_PAPER_URL
        cfg.binance_base_url = BINANCE_LIVE_URL if cfg.live_trading else BINANCE_TESTNET_URL
        if cfg.broker not in ("paper", "alpaca", "binance", "kraken"):
            raise ValueError("BROKER must be 'paper', 'alpaca', 'binance' or 'kraken'")
        if cfg.broker == "alpaca" and not (cfg.alpaca_key and cfg.alpaca_secret):
            raise ValueError("ALPACA_KEY and ALPACA_SECRET are required when BROKER=alpaca")
        if cfg.broker == "binance" and not (cfg.binance_key and cfg.binance_secret):
            raise ValueError("BINANCE_KEY and BINANCE_SECRET are required when BROKER=binance")
        if cfg.auto_trade_symbol and cfg.broker not in ("paper", "kraken"):
            raise ValueError("AUTO_TRADE_SYMBOL reads Kraken's chart; use it with BROKER=paper or kraken")
        if cfg.broker == "kraken":
            if not (cfg.kraken_key and cfg.kraken_secret):
                raise ValueError("KRAKEN_KEY and KRAKEN_SECRET are required when BROKER=kraken")
            if not cfg.live_trading:
                raise ValueError("Kraken has no practice mode: use BROKER=paper to practise, "
                                 "or set LIVE_TRADING=true to trade real money on Kraken")
        return cfg
