import datetime as dt
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from bot.brokers import PaperBroker
from bot.config import Config
from bot.engine import Rejected, TradingEngine
from bot.server import make_handler

SECRET = "test-secret-123456"


def make_engine(**overrides):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl")
    tmp.close()
    cfg = Config(webhook_secret=SECRET, journal_path=tmp.name, **overrides)
    day = {"d": dt.date(2026, 1, 5)}
    engine = TradingEngine(cfg, PaperBroker(cfg.paper_starting_cash), today=lambda: day["d"])
    return engine, day


def alert(action, price, symbol="AAPL", secret=SECRET):
    return {"secret": secret, "symbol": symbol, "action": action, "price": price}


class EngineTests(unittest.TestCase):
    def test_buy_then_sell_round_trip(self):
        engine, _ = make_engine(max_position_usd=1000)
        buy = engine.handle_alert(alert("buy", 100))
        self.assertEqual(buy["qty"], 10)
        sell = engine.handle_alert(alert("sell", 110))
        self.assertEqual(sell["qty"], 10)
        self.assertAlmostEqual(engine.broker.equity(), 10100)

    def test_rejects_bad_secret(self):
        engine, _ = make_engine()
        with self.assertRaises(Rejected) as ctx:
            engine.handle_alert(alert("buy", 100, secret="wrong"))
        self.assertEqual(ctx.exception.status, 401)

    def test_rejects_bad_price_and_action(self):
        engine, _ = make_engine()
        for bad in (alert("buy", "abc"), alert("buy", -1), alert("buy", float("nan")), alert("hold", 10)):
            with self.assertRaises(Rejected):
                engine.handle_alert(bad)

    def test_allowed_symbols(self):
        engine, _ = make_engine(allowed_symbols={"SPY"})
        with self.assertRaises(Rejected):
            engine.handle_alert(alert("buy", 100, symbol="TSLA"))
        self.assertEqual(engine.handle_alert(alert("buy", 100, symbol="spy"))["symbol"], "SPY")

    def test_no_double_buy(self):
        engine, _ = make_engine()
        engine.handle_alert(alert("buy", 100))
        again = engine.handle_alert(alert("buy", 100))
        self.assertEqual(again["qty"], 0)

    def test_daily_loss_halts_buys_but_allows_sells(self):
        engine, day = make_engine(max_position_usd=5000, max_daily_loss_usd=200)
        engine.handle_alert(alert("buy", 100))  # 50 shares
        engine.handle_alert(alert("buy", 50, symbol="MSFT"))
        engine.handle_alert(alert("sell", 95))  # -250 on AAPL
        self.assertIsNotNone(engine.halted_reason)
        with self.assertRaises(Rejected):
            engine.handle_alert(alert("buy", 95))
        self.assertGreater(engine.handle_alert(alert("sell", 50, symbol="MSFT"))["qty"], 0)
        day["d"] = dt.date(2026, 1, 6)  # new day resets the halt
        self.assertEqual(engine.handle_alert(alert("buy", 95))["qty"], 52)

    def test_max_trades_per_day(self):
        engine, _ = make_engine(max_trades_per_day=1)
        engine.handle_alert(alert("buy", 100))
        engine.handle_alert(alert("sell", 100))
        with self.assertRaises(Rejected):
            engine.handle_alert(alert("buy", 100))

    def test_journal_written(self):
        engine, _ = make_engine()
        engine.handle_alert(alert("buy", 100))
        with open(engine.cfg.journal_path) as f:
            self.assertEqual(json.loads(f.readline())["side"], "buy")


class ConfigTests(unittest.TestCase):
    def test_requires_secret(self):
        with self.assertRaises(ValueError):
            Config.from_env({})

    def test_paper_url_unless_live(self):
        env = {"WEBHOOK_SECRET": SECRET, "BROKER": "alpaca", "ALPACA_KEY": "k", "ALPACA_SECRET": "s"}
        self.assertIn("paper-api", Config.from_env(env).alpaca_base_url)
        self.assertNotIn("paper", Config.from_env(dict(env, LIVE_TRADING="true")).alpaca_base_url)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.engine, _ = make_engine()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.engine))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, body):
        req = urllib.request.Request(self.base + "/webhook", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_webhook_and_status(self):
        status, body = self.post(json.dumps(alert("buy", 100)).encode())
        self.assertEqual((status, body["qty"]), (200, 10))
        self.assertEqual(self.post(b"not json")[0], 400)
        self.assertEqual(self.post(json.dumps(alert("buy", 1, secret="nope")).encode())[0], 401)
        with urllib.request.urlopen(self.base + "/status") as r:
            self.assertEqual(json.loads(r.read())["trades_today"], 1)


if __name__ == "__main__":
    unittest.main()
