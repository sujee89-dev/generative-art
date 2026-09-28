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
from bot.covered_calls import CoveredCallManager, limit_price, pick_expiry, pick_strike
from bot.ibkr import IBKRBroker
from bot.server import safe_status
from bot.stockdata import fetch_stock_daily_candles, us_market_open
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
        self.assertEqual(engine.auto_status["BTCCAD"]["signal"], "buy")
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
        self.assertIn("timeout", engine.auto_status["BTCCAD"]["error"])
        engine.broker.buy = real_buy
        self.assertEqual(trader.check()["side"], "buy")

    def test_check_values_holdings_at_latest_close(self):
        engine, _ = make_engine(max_position_usd=1000)
        candles = [(i * 86400, 100.0) for i in range(199)] + [(199 * 86400, 110.0)]
        trader = AutoTrader(engine, "BTCCAD", fetch=lambda s: candles)
        trader.check()
        engine.broker.last_price.clear()  # like a restart: price unknown
        candles.append((200 * 86400, 120.0))
        trader.check()
        self.assertAlmostEqual(engine.broker.equity(), 9000 + 9.090909 * 120, places=3)

    def test_fetch_error_is_reported(self):
        engine, _ = make_engine()
        def boom(symbol):
            raise BrokerError("Kraken down")
        AutoTrader(engine, "BTCCAD", fetch=boom).check()
        self.assertEqual(engine.status()["auto_trader"]["BTCCAD"]["error"], "Kraken down")


class FakeGateway:
    def __init__(self, account="DU123", fill=None):
        self.account, self.orders, self.shares = account, [], 0
        self.fill = fill  # None = fill everything

    def account_id(self):
        return self.account

    def net_liquidation(self):
        return 1_000_000.0

    def position(self, symbol):
        return self.shares

    def market_order(self, symbol, side, qty):
        filled = qty if self.fill is None else self.fill
        self.orders.append((symbol, side, qty))
        self.shares += filled if side == "BUY" else -filled
        return len(self.orders), filled, 500.0


class FakeOptionsGateway(FakeGateway):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.calls = {}  # (expiry, strike) -> contracts short
        self.call_fill = None  # None = fill everything
        self.quote = (4.00, 4.40)

    def call_chain(self, symbol):
        return ["20261016", "20261030", "20261120", "20261218"], [220.0, 240.0, 250.0, 255.0, 260.0]

    def call_quote(self, symbol, expiry, strike):
        return self.quote

    def call_order(self, symbol, expiry, strike, side, qty, limit=None):
        filled = qty if self.call_fill is None else self.call_fill
        self.orders.append((symbol, f"{side} CALL {expiry} {strike}", qty))
        key = (expiry, float(strike))
        self.calls[key] = self.calls.get(key, 0) + (filled if side == "SELL" else -filled)
        if self.calls[key] <= 0:
            del self.calls[key]
        return len(self.orders), filled, limit or 4.5

    def short_calls(self, symbol):
        return dict(self.calls)


def ny(y, m, d, hh, mm):
    from zoneinfo import ZoneInfo
    return dt.datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("America/New_York"))


class StockTests(unittest.TestCase):
    CSV = "Date,Open,High,Low,Close,Volume\n2026-09-24,1,1,1,500.5,9\n2026-09-25,1,1,1,501.5,9\n2026-09-28,1,1,1,999,9\n"

    def test_stooq_drops_today_until_market_done(self):
        def opener(req, timeout=None):
            self.assertIn("s=spy.us", req.full_url)
            return io.BytesIO(self.CSV.encode())
        during = fetch_stock_daily_candles("SPY", opener=opener, now=ny(2026, 9, 28, 15, 0))
        self.assertEqual([c for _, c in during], [500.5, 501.5])
        after = fetch_stock_daily_candles("SPY", opener=opener, now=ny(2026, 9, 28, 17, 0))
        self.assertEqual([c for _, c in after], [500.5, 501.5, 999.0])

    def test_falls_back_to_yahoo(self):
        yahoo = {"chart": {"result": [{"timestamp": [int(ny(2026, 9, 25, 9, 30).timestamp())],
                                        "indicators": {"quote": [{"close": [123.4]}]}}]}}
        def opener(req, timeout=None):
            if "stooq" in req.full_url:
                return io.BytesIO(b"No data")
            return io.BytesIO(json.dumps(yahoo).encode())
        self.assertEqual([c for _, c in fetch_stock_daily_candles("NVDA", opener=opener)], [123.4])

    def test_no_data_is_a_broker_error(self):
        def opener(req, timeout=None):
            raise urllib.error.URLError("down")
        with self.assertRaisesRegex(BrokerError, "no price data for SPY"):
            fetch_stock_daily_candles("SPY", opener=opener)

    def test_market_hours(self):
        self.assertTrue(us_market_open(ny(2026, 9, 28, 9, 30)))
        self.assertFalse(us_market_open(ny(2026, 9, 28, 16, 0)))
        self.assertFalse(us_market_open(ny(2026, 9, 26, 12, 0)))  # Saturday

    def test_ibkr_buys_whole_shares_and_sells_only_its_own(self):
        state = os.path.join(tempfile.mkdtemp(), "stock_positions.json")
        gw = FakeGateway()
        gw.shares = 50  # shares you already owned
        broker = IBKRBroker(gw, state)
        self.assertEqual(broker.buy("MSFT", 2.0, 500.0)["qty"], 2)
        broker = IBKRBroker(gw, state)  # restart keeps the bot's position
        self.assertEqual(broker.position_qty("MSFT"), 2)
        self.assertEqual(broker.close("MSFT", 510.0)["qty"], 2)
        self.assertEqual(gw.shares, 50)
        self.assertEqual(gw.orders, [("MSFT", "BUY", 2), ("MSFT", "SELL", 2)])

    def test_ibkr_refuses_live_account_unless_enabled(self):
        broker = IBKRBroker(FakeGateway(account="U999"), os.path.join(tempfile.mkdtemp(), "s.json"))
        with self.assertRaisesRegex(BrokerError, "live account"):
            broker.buy("SPY", 1, 600.0)
        live = IBKRBroker(FakeGateway(account="U999"), os.path.join(tempfile.mkdtemp(), "s.json"), live=True)
        self.assertEqual(live.buy("SPY", 1, 600.0)["qty"], 1)

    def test_ibkr_unfilled_order_is_an_error_and_records_nothing(self):
        broker = IBKRBroker(FakeGateway(fill=0), os.path.join(tempfile.mkdtemp(), "s.json"))
        with self.assertRaisesRegex(BrokerError, "did not fill"):
            broker.buy("SPY", 1, 600.0)
        self.assertEqual(broker.position_qty("SPY"), 0)

    def test_stock_autotrader_waits_for_market_open(self):
        engine, _ = make_engine(max_position_usd=1000)
        engine.broker = IBKRBroker(FakeGateway(), os.path.join(tempfile.mkdtemp(), "s.json"))
        candles = [(i * 86400, 100.0) for i in range(199)] + [(199 * 86400, 110.0)]
        is_open = {"v": False}
        trader = AutoTrader(engine, "SPY", fetch=lambda s: candles, crypto=False,
                            market_open=lambda: is_open["v"])
        self.assertIsNone(trader.check())
        self.assertEqual(engine.auto_status["SPY"]["waiting"], "market closed")
        is_open["v"] = True
        self.assertEqual(trader.check()["qty"], 9)  # whole shares: 1000 / 110
        self.assertIsNone(trader.check())

    def test_safe_status_reports_gateway_errors(self):
        engine, _ = make_engine()
        def down():
            raise BrokerError("IBKR: ConnectionRefusedError")
        engine.broker.equity = down
        self.assertIn("ConnectionRefused", safe_status(engine)["error"])


class CoveredCallTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.engine, _ = make_engine(max_position_usd=1000)
        self.gw = FakeOptionsGateway()
        self.engine.broker = IBKRBroker(self.gw, os.path.join(d, "stocks.json"))
        self.engine.broker.buy("NVDA", 4, 231.0)  # what the trend bot bought
        self.engine.broker.mark("NVDA", 225.0)
        self.state = os.path.join(d, "calls.json")
        self.cc = self.manager()

    def manager(self, **kw):
        kw.setdefault("market_open", lambda: True)
        kw.setdefault("today", lambda: dt.date(2026, 9, 28))
        return CoveredCallManager(self.engine, ["NVDA"], self.state, **kw)

    def test_picking_helpers(self):
        self.assertEqual(pick_expiry(["20261016", "20261030", "20261120"], dt.date(2026, 9, 28)), "20261030")
        self.assertIsNone(pick_expiry(["20261002"], dt.date(2026, 9, 28)))
        self.assertEqual(pick_strike([240.0, 247.5, 250.0], 225.0), 250.0)  # >= 247.5
        self.assertEqual(limit_price(4.00, 4.40), 4.2)
        self.assertEqual(limit_price(0.52, 0.57), 0.54)
        self.assertEqual(limit_price(2.20, 2.60, misses=1), 2.3)   # halfway to the bid
        self.assertEqual(limit_price(2.20, 2.60, misses=2), 2.2)   # the bid
        self.assertEqual(limit_price(2.20, 2.60, misses=9), 2.2)   # never below it
        self.assertEqual(limit_price(3.10, 3.60, misses=1), 3.2)   # 0.05 ticks from $3

    def test_tops_up_to_100_then_sells_one_call(self):
        self.cc.check()
        self.assertEqual(self.engine.broker.position_qty("NVDA"), 100)
        self.assertIn(("NVDA", "BUY", 96), self.gw.orders)
        self.assertIn(("NVDA", "SELL CALL 20261030 250.0", 1), self.gw.orders)
        self.assertEqual(self.cc.calls["NVDA"][0]["strike"], 250.0)
        orders = len(self.gw.orders)
        self.manager().check()  # restarted: remembers the call, sells nothing more
        self.assertEqual(len(self.gw.orders), orders)
        self.assertEqual(self.engine.auto_status["NVDA calls"]["note"], "all shares covered")

    def test_respects_max_cost_and_market_hours(self):
        self.manager(market_open=lambda: False).check()
        self.assertEqual(len(self.gw.orders), 1)  # only the setUp buy
        self.manager(max_shares_usd=10000).check()
        self.assertIn("CC_MAX_SHARES_USD", self.engine.auto_status["NVDA calls"]["note"])

    def test_assignment_is_reconciled(self):
        self.cc.check()
        self.gw.shares, self.gw.calls = 0, {}  # call exercised: shares called away
        self.cc.check()
        self.assertEqual(self.engine.broker.position_qty("NVDA"), 0)
        self.assertEqual(self.cc.calls["NVDA"], [])
        with open(self.engine.cfg.journal_path) as f:
            self.assertIn("called_away", f.read())

    def test_trend_sell_buys_back_the_call_first(self):
        self.cc.check()
        self.engine.broker.before_close = self.cc.cover
        self.engine.execute("NVDA", "sell", 200.0, crypto=False)
        self.assertEqual(self.gw.orders[-2:], [("NVDA", "BUY CALL 20261030 250.0", 1), ("NVDA", "SELL", 100)])
        self.assertEqual((self.gw.calls, self.gw.shares), ({}, 0))

    def test_shares_not_sold_if_call_buyback_fails(self):
        self.cc.check()
        self.engine.broker.before_close = self.cc.cover
        self.gw.call_fill = 0
        with self.assertRaisesRegex(BrokerError, "buy back"):
            self.engine.execute("NVDA", "sell", 200.0, crypto=False)
        self.assertEqual(self.gw.shares, 100)

    def test_unfilled_retries_ask_less(self):
        self.gw.quote, self.gw.call_fill = (2.20, 2.60), 0
        limits = []
        orig = self.gw.call_order
        self.gw.call_order = lambda *a, **k: (limits.append(k.get("limit")), orig(*a, **k))[1]
        for _ in range(3):
            self.cc.check()
        self.assertEqual(limits, [2.4, 2.3, 2.2])
        self.gw.call_fill = None
        self.cc.check()
        self.assertEqual(self.cc._misses["NVDA"], 0)
        self.assertEqual(len(self.cc.calls["NVDA"]), 1)

    def test_no_bid_means_no_order(self):
        self.gw.quote = (None, None)
        self.cc.check()
        self.assertFalse(any("CALL" in o[1] for o in self.gw.orders))
        self.assertIn("no bid", self.engine.auto_status["NVDA calls"]["note"])


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

    def test_stock_settings(self):
        cfg = Config.from_env({"WEBHOOK_SECRET": SECRET, "STOCK_SYMBOLS": "spy, nvda,", "STOCK_POSITION_USD": "2000"})
        scfg = cfg.stock_engine_config()
        self.assertEqual(cfg.stock_symbols, ["SPY", "NVDA"])
        self.assertEqual((scfg.broker, scfg.live_trading, scfg.max_position_usd), ("ibkr", False, 2000.0))
        self.assertEqual((scfg.journal_path, scfg.allowed_symbols), ("stock_trades.jsonl", {"SPY", "NVDA"}))
        self.assertEqual(cfg.broker, "paper")  # crypto side untouched

    def test_covered_call_settings(self):
        env = {"WEBHOOK_SECRET": SECRET, "STOCK_SYMBOLS": "NVDA,SPY", "COVERED_CALL_SYMBOLS": "nvda"}
        self.assertEqual(Config.from_env(env).covered_call_symbols, ["NVDA"])
        with self.assertRaisesRegex(ValueError, "also be in STOCK_SYMBOLS"):
            Config.from_env(dict(env, COVERED_CALL_SYMBOLS="TSLA"))

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
