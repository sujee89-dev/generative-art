import base64
import datetime as dt
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

from bot.brokers import BrokerError, AlpacaBroker, BinanceBroker, KrakenBroker, PaperBroker, split_pair
from bot.autotrader import AutoTrader, fetch_kraken_daily_candles, trend_signal
from bot.config import Config
from bot.engine import Rejected, TradingEngine
from bot.server import make_handler
from bot.telegram import TelegramBot

SECRET = "test-secret-123456"


def make_engine(**overrides):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl")
    tmp.close()
    cfg = Config(webhook_secret=SECRET, journal_path=tmp.name, **overrides)
    day = {"d": dt.date(2026, 1, 5)}
    engine = TradingEngine(cfg, PaperBroker(cfg.paper_starting_cash), today=lambda: day["d"])
    return engine, day


def alert(action, price, symbol="AAPL", secret=SECRET, **extra):
    return dict({"secret": secret, "symbol": symbol, "action": action, "price": price}, **extra)


class FakeHTTP:
    """Stands in for urllib.request.urlopen; replies from a {(method, path): body} table."""

    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def __call__(self, req, timeout=None):
        url = urllib.parse.urlsplit(req.full_url)
        self.requests.append((req.get_method(), url.path, urllib.parse.parse_qs(url.query), req.data))
        body = self.routes[(req.get_method(), url.path)]
        body = body() if callable(body) else body
        return io.BytesIO(json.dumps(body).encode())


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

    def test_crypto_buys_fractional_quantity(self):
        engine, _ = make_engine(max_position_usd=1000)
        buy = engine.handle_alert(alert("buy", 60000, symbol="BTCUSD", type="crypto"))
        self.assertAlmostEqual(buy["qty"], 0.016666)
        with self.assertRaises(Rejected):  # stocks still need whole shares
            engine.handle_alert(alert("buy", 60000, symbol="BRK.A"))


class BrokerTests(unittest.TestCase):
    def test_split_pair(self):
        self.assertEqual(split_pair("BTCUSDT"), ("BTC", "USDT"))
        self.assertEqual(split_pair("ETHUSD"), ("ETH", "USD"))

    def test_alpaca_crypto_order(self):
        http = FakeHTTP({("POST", "/v2/orders"): {"id": "o1"}})
        AlpacaBroker("k", "s", "https://x", opener=http).buy("BTCUSD", 0.0125, 60000, crypto=True)
        order = json.loads(http.requests[0][3])
        self.assertEqual((order["symbol"], order["qty"], order["time_in_force"]), ("BTC/USD", "0.012500", "gtc"))

    def binance(self, state_path, balance="0.5"):
        http = FakeHTTP({
            ("GET", "/api/v3/exchangeInfo"): {"symbols": [{"baseAsset": "BTC", "filters": [
                {"filterType": "LOT_SIZE", "stepSize": "0.00001000"}]}]},
            ("GET", "/api/v3/account"): {"balances": [
                {"asset": "USDT", "free": "900", "locked": "0"}, {"asset": "BTC", "free": balance, "locked": "0"}]},
            ("POST", "/api/v3/order"): lambda: {"orderId": 7, "executedQty": "0.0166",
                                                 "cummulativeQuoteQty": "996", "fills": [
                                                     {"commission": "0.0000166", "commissionAsset": "BTC"}]},
        })
        return BinanceBroker("k", "s", "https://x", state_path, opener=http, clock=lambda: 1), http

    def test_binance_only_sells_what_it_bought(self):
        state = os.path.join(tempfile.mkdtemp(), "positions.json")
        broker, http = self.binance(state)
        broker.buy("BTCUSDT", 0.016666, 60000)
        self.assertEqual(http.requests[-1][2]["quoteOrderQty"], ["999.96"])
        self.assertIn("signature", http.requests[-1][2])
        # Survives a restart, and sells the bought amount (net of fees) rounded to the lot size,
        # not the account's full 0.5 BTC.
        broker, http = self.binance(state)
        self.assertAlmostEqual(broker.position_qty("BTCUSDT"), 0.0165834)
        sell = broker.close("BTCUSDT", 61000)
        self.assertEqual(http.requests[-1][2]["quantity"], ["0.01658000"])
        self.assertEqual(sell["qty"], 0.01658)
        self.assertEqual(broker.position_qty("BTCUSDT"), 0)
        self.assertIsNone(broker.close("BTCUSDT", 61000))

    def test_binance_engine_rejects_stocks(self):
        engine, _ = make_engine(broker="binance")
        with self.assertRaises(Rejected):
            engine.handle_alert(alert("buy", 100, type="stock"))


class KrakenTests(unittest.TestCase):
    def test_signature_matches_kraken_docs_example(self):
        broker = KrakenBroker("k", "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==",
                              os.path.join(tempfile.mkdtemp(), "p.json"))
        postdata = "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25"
        self.assertEqual(broker.sign("/0/private/AddOrder", postdata, 1616492376594),
                         "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==")

    def kraken(self, state_path):
        http = FakeHTTP({
            ("GET", "/0/public/AssetPairs"): {"error": [], "result": {"XXBTZCAD": {
                "altname": "XBTCAD", "base": "XXBT", "lot_decimals": 8}}},
            ("POST", "/0/private/Balance"): {"error": [], "result": {"ZCAD": "500.0", "XXBT": "0.5"}},
            ("POST", "/0/private/AddOrder"): {"error": [], "result": {"txid": ["OABC"]}},
        })
        return KrakenBroker("k", base64.b64encode(b"secret").decode(), state_path, opener=http, clock=lambda: 1), http

    def test_buy_and_sell_only_own_coins(self):
        state = os.path.join(tempfile.mkdtemp(), "positions.json")
        broker, http = self.kraken(state)
        broker.buy("BTCCAD", 0.011764, 85000)
        self.assertEqual(http.requests[0][2]["pair"], ["XBTCAD"])  # BTC -> XBT
        order = urllib.parse.parse_qs(http.requests[-1][3].decode())
        self.assertEqual((order["pair"], order["type"], order["volume"]), (["XBTCAD"], ["buy"], ["0.01176400"]))
        broker, http = self.kraken(state)  # restart
        self.assertEqual(broker.close("BTCCAD", 86000)["qty"], 0.011764)  # not the account's 0.5 BTC
        self.assertEqual(broker.position_qty("BTCCAD"), 0)
        self.assertAlmostEqual(broker.equity(), 500.0)

    def test_errors_become_broker_errors(self):
        broker, http = self.kraken(os.path.join(tempfile.mkdtemp(), "p.json"))
        http.routes[("POST", "/0/private/AddOrder")] = {"error": ["EOrder:Insufficient funds"]}
        with self.assertRaisesRegex(BrokerError, "Insufficient funds"):
            broker.buy("BTCCAD", 0.01, 85000)

    def test_nonces_increase(self):
        broker, http = self.kraken(os.path.join(tempfile.mkdtemp(), "p.json"))
        broker._balances()
        broker._balances()
        nonces = [urllib.parse.parse_qs(r[3].decode())["nonce"][0] for r in http.requests]
        self.assertLess(int(nonces[0]), int(nonces[1]))


class AutoTraderTests(unittest.TestCase):
    def test_trend_signal(self):
        flat = [100.0] * 200
        self.assertEqual(trend_signal(flat[:-1] + [101], holding=False), ("buy", 100.005))
        self.assertEqual(trend_signal(flat[:-1] + [101], holding=True)[0], None)
        self.assertEqual(trend_signal(flat[:-1] + [98], holding=True)[0], None)  # inside 3% buffer
        self.assertEqual(trend_signal(flat[:-1] + [90], holding=True)[0], "sell")
        self.assertEqual(trend_signal(flat[:-1] + [90], holding=False)[0], None)
        self.assertEqual(trend_signal([100.0] * 50, holding=False), (None, None))  # not enough history

    def test_fetch_drops_unfinished_candle(self):
        http = FakeHTTP({("GET", "/0/public/OHLC"): {"error": [], "result": {
            "XXBTZCAD": [[86400, "1", "1", "1", "100.5", "1", "1", 1],
                         [172800, "1", "1", "1", "101.5", "1", "1", 1],
                         [259200, "1", "1", "1", "999", "1", "1", 1]],
            "last": 172800}}})
        self.assertEqual(fetch_kraken_daily_candles("BTCCAD", opener=http), [(86400, 100.5), (172800, 101.5)])
        self.assertEqual(http.requests[0][2], {"pair": ["XBTCAD"], "interval": ["1440"]})

    def test_buys_then_sells_once_per_candle(self):
        engine, _ = make_engine(max_position_usd=1000)
        candles = [(i * 86400, 100.0) for i in range(199)] + [(199 * 86400, 110.0)]
        trader = AutoTrader(engine, "BTCCAD", fetch=lambda s: candles)
        self.assertEqual(trader.check()["side"], "buy")
        self.assertIsNone(trader.check())  # same candle: nothing more to do
        self.assertEqual(engine.auto_status["signal"], "buy")
        candles.append((200 * 86400, 80.0))  # next day closes well below the SMA
        self.assertEqual(trader.check()["side"], "sell")
        self.assertEqual(engine.broker.position_qty("BTCCAD"), 0)

    def test_broker_failure_retries_same_candle(self):
        engine, _ = make_engine()
        candles = [(i * 86400, 100.0) for i in range(199)] + [(199 * 86400, 110.0)]
        trader = AutoTrader(engine, "BTCCAD", fetch=lambda s: candles)
        real_buy = engine.broker.buy
        engine.broker.buy = lambda *a, **k: (_ for _ in ()).throw(BrokerError("timeout"))
        self.assertIsNone(trader.check())
        self.assertIn("timeout", engine.auto_status["error"])
        engine.broker.buy = real_buy
        self.assertEqual(trader.check()["side"], "buy")

    def test_fetch_error_is_reported(self):
        engine, _ = make_engine()
        def boom(symbol):
            raise BrokerError("Kraken down")
        AutoTrader(engine, "BTCCAD", fetch=boom).check()
        self.assertEqual(engine.status()["auto_trader"]["error"], "Kraken down")


class TelegramTests(unittest.TestCase):
    def setUp(self):
        self.engine, _ = make_engine(max_position_usd=1000)
        self.sent = []
        self.http = FakeHTTP({("POST", "/botTOKEN/sendMessage"): lambda: self._record()})
        self.bot = TelegramBot("TOKEN", "42", self.engine, opener=self.http)

    def _record(self):
        self.sent.append(json.loads(self.http.requests[-1][3]))
        return {"ok": True, "result": {}}

    def msg(self, text, chat=42):
        return {"update_id": 1, "message": {"chat": {"id": chat}, "text": text}}

    def test_pause_blocks_buys_but_not_sells(self):
        self.engine.handle_alert(alert("buy", 100))
        self.assertIn("Paused", self.bot.handle(self.msg("/pause")))
        with self.assertRaises(Rejected):
            self.engine.handle_alert(alert("buy", 100, symbol="MSFT"))
        self.assertEqual(self.engine.handle_alert(alert("sell", 100))["qty"], 10)
        self.assertTrue(self.engine.status()["paused"])
        self.bot.handle(self.msg("/resume@my_trading_bot"))
        self.assertEqual(self.engine.handle_alert(alert("buy", 100, symbol="MSFT"))["qty"], 10)

    def test_status_and_help(self):
        self.engine.handle_alert(alert("buy", 100))
        self.assertIn("Trades today: 1", self.bot.handle(self.msg("/status")))
        self.assertIn("/pause", self.bot.handle(self.msg("hello")))

    def test_ignores_other_chats(self):
        self.assertIsNone(self.bot.handle(self.msg("/pause", chat=666)))
        self.assertFalse(self.engine.paused)

    def test_without_chat_id_only_reveals_chat_id(self):
        bot = TelegramBot("TOKEN", "", self.engine, opener=self.http)
        self.assertIn("TELEGRAM_CHAT_ID=7", bot.handle(self.msg("/pause", chat=7)))
        self.assertFalse(self.engine.paused)

    def test_poll_replies_and_advances_offset(self):
        self.http.routes[("POST", "/botTOKEN/getUpdates")] = {"ok": True, "result": [dict(self.msg("/status"), update_id=5)]}
        self.bot.poll_once()
        self.assertEqual(self.sent[0]["chat_id"], 42)
        self.assertIn("Equity", self.sent[0]["text"])
        self.bot.poll_once()
        self.assertEqual(json.loads(self.http.requests[-2][3])["offset"], 6)

    def test_trades_are_notified(self):
        notes = []
        self.engine.notify = notes.append
        self.engine.handle_alert(alert("buy", 100))
        self.engine.handle_alert(alert("buy", 100))  # already in position: no trade, no alert
        self.assertEqual(notes, ["BUY 10 AAPL @ 100.00"])

    def test_send_failure_does_not_raise(self):
        def down(req, timeout=None):
            raise urllib.error.URLError("offline")
        TelegramBot("TOKEN", "42", self.engine, opener=down).send("hi")


class ConfigTests(unittest.TestCase):
    def test_requires_secret(self):
        with self.assertRaises(ValueError):
            Config.from_env({})

    def test_paper_url_unless_live(self):
        env = {"WEBHOOK_SECRET": SECRET, "BROKER": "alpaca", "ALPACA_KEY": "k", "ALPACA_SECRET": "s"}
        self.assertIn("paper-api", Config.from_env(env).alpaca_base_url)
        self.assertNotIn("paper", Config.from_env(dict(env, LIVE_TRADING="true")).alpaca_base_url)

    def test_kraken_requires_explicit_live_trading(self):
        env = {"WEBHOOK_SECRET": SECRET, "BROKER": "kraken", "KRAKEN_KEY": "k", "KRAKEN_SECRET": "s"}
        with self.assertRaisesRegex(ValueError, "no practice mode"):
            Config.from_env(env)
        self.assertEqual(Config.from_env(dict(env, LIVE_TRADING="true")).broker, "kraken")

    def test_auto_trade_settings(self):
        env = {"WEBHOOK_SECRET": SECRET, "AUTO_TRADE_SYMBOL": " btccad "}
        cfg = Config.from_env(env)
        self.assertEqual((cfg.auto_trade_symbol, cfg.trend_sma, cfg.trend_exit_buffer_pct), ("BTCCAD", 200, 3.0))
        with self.assertRaisesRegex(ValueError, "AUTO_TRADE_SYMBOL"):
            Config.from_env(dict(env, BROKER="alpaca", ALPACA_KEY="k", ALPACA_SECRET="s"))

    def test_binance_testnet_unless_live(self):
        env = {"WEBHOOK_SECRET": SECRET, "BROKER": "binance", "BINANCE_KEY": "k", "BINANCE_SECRET": "s"}
        self.assertIn("testnet", Config.from_env(env).binance_base_url)
        self.assertEqual(Config.from_env(dict(env, LIVE_TRADING="true")).binance_base_url, "https://api.binance.com")


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
        with urllib.request.urlopen(self.base + "/health") as r:
            self.assertEqual(json.loads(r.read()), {"ok": True})
        with urllib.request.urlopen(self.base + "/status") as r:
            self.assertEqual(json.loads(r.read())["trades_today"], 1)


if __name__ == "__main__":
    unittest.main()
