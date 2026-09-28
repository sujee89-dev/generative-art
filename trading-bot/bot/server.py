"""HTTP server that receives TradingView webhook alerts.

Run:  WEBHOOK_SECRET=... python -m bot.server
"""
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .autotrader import AutoTrader
from .brokers import AlpacaBroker, BinanceBroker, BrokerError, KrakenBroker, PaperBroker
from .config import Config
from .covered_calls import CoveredCallManager
from .engine import Rejected, TradingEngine
from .ibkr import IBGateway, IBKRBroker
from .stockdata import fetch_stock_daily_candles, us_market_open

log = logging.getLogger("trading-bot")
MAX_BODY = 4096


def safe_status(engine):
    try:
        return engine.status()
    except BrokerError as e:  # e.g. IB Gateway restarting: report it instead of failing the page
        return {"broker": engine.cfg.broker, "error": str(e), "auto_trader": engine.auto_status or None}


def make_handler(engine, stock_engine=None):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"ok": True})
            elif self.path == "/status":
                body = safe_status(engine)
                if stock_engine:
                    body["stocks"] = safe_status(stock_engine)
                self._send(200, body)
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/webhook":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(400, {"error": "missing or oversized body"})
            try:
                payload = json.loads(self.rfile.read(length))
                result = engine.handle_alert(payload)
            except json.JSONDecodeError:
                return self._send(400, {"error": "body must be JSON"})
            except Rejected as e:
                log.warning("rejected alert: %s", e)
                return self._send(e.status, {"error": str(e)})
            except BrokerError as e:
                log.error("broker error: %s", e)
                return self._send(502, {"error": str(e)})
            log.info("executed: %s", result)
            self._send(200, result)

        def log_message(self, fmt, *args):
            log.debug(fmt, *args)

    return Handler


def build_engine(cfg):
    if cfg.broker == "alpaca":
        broker = AlpacaBroker(cfg.alpaca_key, cfg.alpaca_secret, cfg.alpaca_base_url)
    elif cfg.broker == "binance":
        broker = BinanceBroker(cfg.binance_key, cfg.binance_secret, cfg.binance_base_url, cfg.state_path)
    elif cfg.broker == "kraken":
        broker = KrakenBroker(cfg.kraken_key, cfg.kraken_secret, cfg.state_path)
    else:
        broker = PaperBroker(cfg.paper_starting_cash)
    return TradingEngine(cfg, broker)


def build_stock_engine(cfg):
    if not cfg.stock_symbols:
        return None
    scfg = cfg.stock_engine_config()
    gateway = IBGateway(cfg.ibkr_host, cfg.ibkr_port, cfg.ibkr_client_id)
    return TradingEngine(scfg, IBKRBroker(gateway, scfg.state_path, live=cfg.ibkr_live))


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()
    engine = build_engine(cfg)
    mode = "LIVE MONEY" if (cfg.broker != "paper" and cfg.live_trading) else "paper/simulated"
    log.info("broker=%s mode=%s listening on :%d", cfg.broker, mode, cfg.port)
    if cfg.auto_trade_symbol:
        AutoTrader(engine, cfg.auto_trade_symbol, cfg.trend_sma, cfg.trend_exit_buffer_pct / 100,
                   cfg.auto_check_minutes * 60).start()
    stock_engine = build_stock_engine(cfg)
    if stock_engine:
        log.info("stock bot: %s via IBKR %s:%d (%s)", ",".join(cfg.stock_symbols), cfg.ibkr_host,
                 cfg.ibkr_port, "LIVE MONEY" if cfg.ibkr_live else "paper")
        for symbol in cfg.stock_symbols:
            AutoTrader(stock_engine, symbol, cfg.trend_sma, cfg.trend_exit_buffer_pct / 100,
                       cfg.auto_check_minutes * 60, fetch=fetch_stock_daily_candles, crypto=False,
                       market_open=us_market_open).start()
    if stock_engine and cfg.covered_call_symbols:
        calls = CoveredCallManager(stock_engine, cfg.covered_call_symbols, cfg.cc_state_path,
                                   cfg.cc_otm_pct / 100, cfg.cc_min_dte, cfg.cc_max_dte, cfg.cc_target_dte,
                                   cfg.cc_max_shares_usd, cfg.auto_check_minutes * 60)
        stock_engine.broker.before_close = calls.cover
        calls.start()
    ThreadingHTTPServer(("0.0.0.0", cfg.port), make_handler(engine, stock_engine)).serve_forever()


if __name__ == "__main__":
    main()
