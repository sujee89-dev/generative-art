"""HTTP server that receives TradingView webhook alerts.

Run:  WEBHOOK_SECRET=... python -m bot.server
"""
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .autotrader import AutoTrader
from .brokers import AlpacaBroker, BinanceBroker, BrokerError, KrakenBroker, PaperBroker
from .config import Config
from .engine import Rejected, TradingEngine

log = logging.getLogger("trading-bot")
MAX_BODY = 4096


def make_handler(engine):
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
                self._send(200, engine.status())
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


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()
    engine = build_engine(cfg)
    mode = "LIVE MONEY" if (cfg.broker != "paper" and cfg.live_trading) else "paper/simulated"
    log.info("broker=%s mode=%s listening on :%d", cfg.broker, mode, cfg.port)
    if cfg.auto_trade_symbol:
        AutoTrader(engine, cfg.auto_trade_symbol, cfg.trend_sma, cfg.trend_exit_buffer_pct / 100,
                   cfg.auto_check_minutes * 60).start()
    ThreadingHTTPServer(("0.0.0.0", cfg.port), make_handler(engine)).serve_forever()


if __name__ == "__main__":
    main()
