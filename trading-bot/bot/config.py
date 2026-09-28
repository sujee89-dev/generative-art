"""Settings loaded from environment variables."""
import os
from dataclasses import dataclass, field, replace

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
    # Stock bot: the same Trend (200 SMA) rule on US stocks/ETFs through Interactive Brokers.
    stock_symbols: list = field(default_factory=list)  # e.g. ["SPY", "QQQ"]; empty = off
    stock_position_usd: float = 1000.0  # USD spent per stock buy (whole shares)
    stock_max_daily_loss_usd: float = 500.0
    ibkr_host: str = "127.0.0.1"
    ibkr_port: int = 4004  # IB Gateway paper port in the ib-gateway Docker image
    ibkr_client_id: int = 1
    ibkr_live: bool = False
    stock_journal_path: str = "stock_trades.jsonl"
    stock_state_path: str = "stock_positions.json"
    # Covered calls (see bot/covered_calls.py) on some of the stock symbols.
    covered_call_symbols: list = field(default_factory=list)  # e.g. ["NVDA"]; empty = off
    cc_otm_pct: float = 10.0
    cc_min_dte: int = 21
    cc_max_dte: int = 49
    cc_target_dte: int = 35
    cc_max_shares_usd: float = 30000.0  # never spend more than this topping up to 100 shares
    cc_state_path: str = "covered_calls.json"
    # News pause (see bot/news.py): Claude reads headlines and blocks NEW buys after severe news.
    news_pause_enabled: bool = False
    news_symbols: list = field(default_factory=list)  # empty = every symbol the bot trades
    news_pause_hours: float = 24.0
    news_check_minutes: int = 60
    news_model: str = "claude-opus-5-5"
    news_state_path: str = "news_pauses.json"

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
            stock_symbols=[x.strip().upper() for x in env.get("STOCK_SYMBOLS", "").split(",") if x.strip()],
            stock_position_usd=float(env.get("STOCK_POSITION_USD", 1000)),
            stock_max_daily_loss_usd=float(env.get("STOCK_MAX_DAILY_LOSS_USD", 500)),
            ibkr_host=env.get("IBKR_HOST", "127.0.0.1"),
            ibkr_port=int(env.get("IBKR_PORT", 4004)),
            ibkr_client_id=int(env.get("IBKR_CLIENT_ID", 1)),
            ibkr_live=env.get("IBKR_LIVE", "").lower() == "true",
            stock_journal_path=env.get("STOCK_JOURNAL_PATH", "stock_trades.jsonl"),
            stock_state_path=env.get("STOCK_STATE_PATH", "stock_positions.json"),
            covered_call_symbols=[x.strip().upper() for x in env.get("COVERED_CALL_SYMBOLS", "").split(",") if x.strip()],
            cc_otm_pct=float(env.get("CC_OTM_PCT", 10)),
            cc_min_dte=int(env.get("CC_MIN_DTE", 21)),
            cc_max_dte=int(env.get("CC_MAX_DTE", 49)),
            cc_target_dte=int(env.get("CC_TARGET_DTE", 35)),
            cc_max_shares_usd=float(env.get("CC_MAX_SHARES_USD", 30000)),
            cc_state_path=env.get("CC_STATE_PATH", "covered_calls.json"),
            news_pause_enabled=env.get("NEWS_PAUSE_ENABLED", "").lower() == "true",
            news_symbols=[x.strip().upper() for x in env.get("NEWS_SYMBOLS", "").split(",") if x.strip()],
            news_pause_hours=float(env.get("NEWS_PAUSE_HOURS", 24)),
            news_check_minutes=int(env.get("NEWS_CHECK_MINUTES", 60)),
            news_model=env.get("NEWS_MODEL", "").strip() or "claude-opus-5-5",
            news_state_path=env.get("NEWS_STATE_PATH", "news_pauses.json"),
        )
        if cfg.news_pause_enabled and not env.get("ANTHROPIC_API_KEY"):
            raise ValueError("ANTHROPIC_API_KEY is required when NEWS_PAUSE_ENABLED=true")
        if not cfg.news_symbols:
            cfg.news_symbols = ([cfg.auto_trade_symbol] if cfg.auto_trade_symbol else []) + cfg.stock_symbols
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
        extra = set(cfg.covered_call_symbols) - set(cfg.stock_symbols)
        if extra:
            raise ValueError(f"COVERED_CALL_SYMBOLS must also be in STOCK_SYMBOLS: {','.join(sorted(extra))}")
        if not cfg.cc_min_dte <= cfg.cc_target_dte <= cfg.cc_max_dte:
            raise ValueError("need CC_MIN_DTE <= CC_TARGET_DTE <= CC_MAX_DTE")
        if cfg.broker == "kraken":
            if not (cfg.kraken_key and cfg.kraken_secret):
                raise ValueError("KRAKEN_KEY and KRAKEN_SECRET are required when BROKER=kraken")
            if not cfg.live_trading:
                raise ValueError("Kraken has no practice mode: use BROKER=paper to practise, "
                                 "or set LIVE_TRADING=true to trade real money on Kraken")
        return cfg

    def stock_engine_config(self):
        """Settings for the separate stock engine (its own limits, journal and positions file)."""
        return replace(self, broker="ibkr", live_trading=self.ibkr_live,
                       max_position_usd=self.stock_position_usd,
                       max_daily_loss_usd=self.stock_max_daily_loss_usd,
                       journal_path=self.stock_journal_path, state_path=self.stock_state_path,
                       allowed_symbols=set(self.stock_symbols))
