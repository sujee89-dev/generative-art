"""Broker adapters. Each broker supports: buy(symbol, qty, price, crypto), close(symbol, price),
position_qty(symbol), mark(symbol, price), equity()."""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal

# Quote currencies recognised at the end of a TradingView crypto ticker (longest match first).
QUOTES = ("FDUSD", "USDT", "USDC", "USD", "CAD", "EUR", "BTC", "ETH")
STABLECOINS = ("USDT", "USDC", "FDUSD", "USD")


class BrokerError(Exception):
    pass


def split_pair(symbol):
    """'BTCUSDT' -> ('BTC', 'USDT')."""
    for quote in QUOTES:
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return symbol[: -len(quote)], quote
    raise BrokerError(f"can't tell the quote currency of {symbol}")


class PaperBroker:
    """In-memory simulator that fills orders at the alert price. No money involved."""

    def __init__(self, starting_cash=10000.0):
        self.cash = starting_cash
        self.positions = {}  # symbol -> qty
        self.last_price = {}

    def buy(self, symbol, qty, price, crypto=False):
        cost = qty * price
        if cost > self.cash:
            raise BrokerError(f"insufficient cash: need {cost:.2f}, have {self.cash:.2f}")
        self.cash -= cost
        self.positions[symbol] = self.positions.get(symbol, 0) + qty
        self.last_price[symbol] = price
        return {"symbol": symbol, "side": "buy", "qty": qty, "price": price}

    def close(self, symbol, price):
        qty = self.positions.pop(symbol, 0)
        self.last_price[symbol] = price
        if qty == 0:
            return None
        self.cash += qty * price
        return {"symbol": symbol, "side": "sell", "qty": qty, "price": price}

    def position_qty(self, symbol):
        return self.positions.get(symbol, 0)

    def mark(self, symbol, price):
        self.last_price[symbol] = price

    def equity(self):
        return self.cash + sum(q * self.last_price.get(s, 0) for s, q in self.positions.items())


class AlpacaBroker:
    """Alpaca REST API (US stocks and crypto). Uses the paper endpoint unless LIVE_TRADING=true."""

    def __init__(self, key, secret, base_url, opener=urllib.request.urlopen):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
            "Content-Type": "application/json",
        }
        self._open = opener

    def _request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, headers=self.headers, method=method)
        try:
            with self._open(req, timeout=10) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise BrokerError(f"Alpaca {method} {path} failed: {e.code} {e.read().decode(errors='replace')}")
        except urllib.error.URLError as e:
            raise BrokerError(f"Alpaca {method} {path} failed: {e.reason}")

    def buy(self, symbol, qty, price, crypto=False):
        if crypto:
            # Alpaca names crypto pairs "BTC/USD" and only accepts gtc/ioc for them.
            order = {"symbol": "/".join(split_pair(symbol)), "qty": f"{qty:.6f}", "time_in_force": "gtc"}
        else:
            order = {"symbol": symbol, "qty": str(qty), "time_in_force": "day"}
        placed = self._request("POST", "/v2/orders", dict(order, side="buy", type="market"))
        return {"symbol": symbol, "side": "buy", "qty": qty, "price": price, "order_id": placed.get("id")}

    def close(self, symbol, price):
        order = self._request("DELETE", f"/v2/positions/{symbol}")
        if order is None:
            return None
        return {"symbol": symbol, "side": "sell", "qty": float(order.get("qty", 0)), "price": price,
                "order_id": order.get("id")}

    def position_qty(self, symbol):
        pos = self._request("GET", f"/v2/positions/{symbol}")
        return float(pos["qty"]) if pos else 0

    def mark(self, symbol, price):
        pass  # Alpaca marks positions itself

    def equity(self):
        return float(self._request("GET", "/v2/account")["equity"])


class BinanceBroker:
    """Binance spot API (crypto only). Uses the testnet unless LIVE_TRADING=true.

    Only sells coins the bot bought itself (tracked in state_path), so coins you already
    held in the account are never touched.
    """

    def __init__(self, key, secret, base_url, state_path, opener=urllib.request.urlopen, clock=time.time):
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.secret = secret.encode()
        self.state_path = state_path
        self._open = opener
        self._clock = clock
        self._info = {}
        self.last_price = {}
        self.held = {}
        if os.path.exists(state_path):
            with open(state_path) as f:
                self.held = json.load(f)

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.held, f)
        os.replace(tmp, self.state_path)

    def _request(self, method, path, params=None, signed=False):
        query = urllib.parse.urlencode(params or {})
        if signed:
            query += ("&" if query else "") + f"recvWindow=5000&timestamp={int(self._clock() * 1000)}"
            query += "&signature=" + hmac.new(self.secret, query.encode(), hashlib.sha256).hexdigest()
        url = self.base_url + path + ("?" + query if query else "")
        req = urllib.request.Request(url, headers={"X-MBX-APIKEY": self.key}, method=method)
        try:
            with self._open(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise BrokerError(f"Binance {method} {path} failed: {e.code} {e.read().decode(errors='replace')}")
        except urllib.error.URLError as e:
            raise BrokerError(f"Binance {method} {path} failed: {e.reason}")

    def _symbol_info(self, symbol):
        if symbol not in self._info:
            info = self._request("GET", "/api/v3/exchangeInfo", {"symbol": symbol})["symbols"][0]
            step = next(f["stepSize"] for f in info["filters"] if f["filterType"] == "LOT_SIZE")
            self._info[symbol] = (info["baseAsset"], Decimal(step))
        return self._info[symbol]

    def _balances(self):
        account = self._request("GET", "/api/v3/account", signed=True)
        return {b["asset"]: float(b["free"]) + float(b["locked"]) for b in account["balances"]}

    def buy(self, symbol, qty, price, crypto=True):
        base, _ = self._symbol_info(symbol)
        # Spend a dollar amount and let Binance work out the coin quantity and lot size.
        order = self._request("POST", "/api/v3/order", {
            "symbol": symbol, "side": "BUY", "type": "MARKET",
            "quoteOrderQty": f"{qty * price:.2f}", "newOrderRespType": "FULL",
        }, signed=True)
        executed = float(order["executedQty"])
        fees = sum(float(f["commission"]) for f in order.get("fills", []) if f["commissionAsset"] == base)
        received = executed - fees
        avg = float(order["cummulativeQuoteQty"]) / executed if executed else price
        self.held[symbol] = self.held.get(symbol, 0) + received
        self._save()
        return {"symbol": symbol, "side": "buy", "qty": received, "price": avg, "order_id": order.get("orderId")}

    def close(self, symbol, price):
        held = self.held.get(symbol, 0)
        if held <= 0:
            return None
        base, step = self._symbol_info(symbol)
        available = min(held, self._balances().get(base, 0))
        qty = (Decimal(str(available)) // step) * step
        if qty <= 0:
            self.held.pop(symbol, None)
            self._save()
            return None
        order = self._request("POST", "/api/v3/order", {
            "symbol": symbol, "side": "SELL", "type": "MARKET", "quantity": format(qty, "f"),
        }, signed=True)
        self.held.pop(symbol, None)
        self._save()
        return {"symbol": symbol, "side": "sell", "qty": float(qty), "price": price, "order_id": order.get("orderId")}

    def position_qty(self, symbol):
        return self.held.get(symbol, 0)

    def mark(self, symbol, price):
        self.last_price[symbol] = price

    def equity(self):
        """Stablecoin cash plus the bot's own coins at their last alert price."""
        balances = self._balances()
        cash = sum(balances.get(c, 0) for c in STABLECOINS)
        return cash + sum(q * self.last_price.get(s, 0) for s, q in self.held.items())


class KrakenBroker:
    """Kraken spot API (crypto, available in Canada). Kraken has no practice environment,
    so this is only used with LIVE_TRADING=true; practise with BROKER=paper first.

    Like BinanceBroker, it only sells coins the bot bought itself (tracked in state_path).
    """

    ALIASES = {"BTC": "XBT", "DOGE": "XDG"}  # Kraken's names for some coins
    CASH = ("ZCAD", "ZUSD", "USDC", "USDT")

    def __init__(self, key, secret, state_path, base_url="https://api.kraken.com",
                 opener=urllib.request.urlopen, clock=time.time):
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.secret = secret
        self.state_path = state_path
        self._open = opener
        self._clock = clock
        self._nonce = 0
        self._info = {}
        self.last_price = {}
        self.held = {}
        if os.path.exists(state_path):
            with open(state_path) as f:
                self.held = json.load(f)

    _save = BinanceBroker._save

    def sign(self, path, postdata, nonce):
        message = path.encode() + hashlib.sha256((str(nonce) + postdata).encode()).digest()
        mac = hmac.new(base64.b64decode(self.secret), message, hashlib.sha512)
        return base64.b64encode(mac.digest()).decode()

    def _request(self, path, params=None, private=False):
        headers, data = {}, None
        if private:
            self._nonce = max(self._nonce + 1, int(self._clock() * 1000))
            postdata = urllib.parse.urlencode(dict(params or {}, nonce=self._nonce))
            headers = {"API-Key": self.key, "API-Sign": self.sign(path, postdata, self._nonce),
                       "Content-Type": "application/x-www-form-urlencoded"}
            data = postdata.encode()
        elif params:
            path += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers,
                                     method="POST" if private else "GET")
        try:
            with self._open(req, timeout=10) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise BrokerError(f"Kraken {path} failed: {e.code} {e.read().decode(errors='replace')}")
        except urllib.error.URLError as e:
            raise BrokerError(f"Kraken {path} failed: {e.reason}")
        if body.get("error"):
            raise BrokerError(f"Kraken {path} failed: {', '.join(body['error'])}")
        return body["result"]

    def _symbol_info(self, symbol):
        """'BTCCAD' -> (Kraken pair 'XBTCAD', base asset 'XXBT', lot size)."""
        if symbol not in self._info:
            base, quote = split_pair(symbol)
            pair = self.ALIASES.get(base, base) + quote
            info = next(iter(self._request("/0/public/AssetPairs", {"pair": pair}).values()))
            self._info[symbol] = (info["altname"], info["base"], Decimal(1).scaleb(-info["lot_decimals"]))
        return self._info[symbol]

    def _order(self, symbol, side, qty):
        pair, _, _ = self._symbol_info(symbol)
        result = self._request("/0/private/AddOrder", {
            "pair": pair, "type": side, "ordertype": "market", "volume": format(qty, "f"),
        }, private=True)
        return result["txid"][0]

    def buy(self, symbol, qty, price, crypto=True):
        _, _, lot = self._symbol_info(symbol)
        volume = (Decimal(str(qty)) // lot) * lot
        if volume <= 0:
            raise BrokerError(f"order for {symbol} is below Kraken's lot size")
        txid = self._order(symbol, "buy", volume)
        # Kraken takes fees in the quote currency (CAD/USD), so we receive the full volume.
        self.held[symbol] = self.held.get(symbol, 0) + float(volume)
        self._save()
        return {"symbol": symbol, "side": "buy", "qty": float(volume), "price": price, "order_id": txid}

    def close(self, symbol, price):
        held = self.held.get(symbol, 0)
        if held <= 0:
            return None
        _, base, lot = self._symbol_info(symbol)
        available = min(held, self._balances().get(base, 0))
        volume = (Decimal(str(available)) // lot) * lot
        if volume <= 0:
            self.held.pop(symbol, None)
            self._save()
            return None
        txid = self._order(symbol, "sell", volume)
        self.held.pop(symbol, None)
        self._save()
        return {"symbol": symbol, "side": "sell", "qty": float(volume), "price": price, "order_id": txid}

    def _balances(self):
        return {asset: float(amount) for asset, amount in self._request("/0/private/Balance", private=True).items()}

    def position_qty(self, symbol):
        return self.held.get(symbol, 0)

    def mark(self, symbol, price):
        self.last_price[symbol] = price

    def equity(self):
        """Cash plus the bot's own coins at their last alert price (mixes CAD and USD if you hold both)."""
        balances = self._balances()
        cash = sum(balances.get(c, 0) for c in self.CASH)
        return cash + sum(q * self.last_price.get(s, 0) for s, q in self.held.items())
