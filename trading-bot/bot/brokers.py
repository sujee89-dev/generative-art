"""Broker adapters. Each broker supports: buy(symbol, qty, price), close(symbol, price),
position_qty(symbol), equity()."""
import json
import urllib.error
import urllib.request


class BrokerError(Exception):
    pass


class PaperBroker:
    """In-memory simulator that fills orders at the alert price. No money involved."""

    def __init__(self, starting_cash=10000.0):
        self.cash = starting_cash
        self.positions = {}  # symbol -> qty
        self.last_price = {}

    def buy(self, symbol, qty, price):
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
    """Alpaca REST API (stocks/crypto). Uses the paper endpoint unless LIVE_TRADING=true."""

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

    def buy(self, symbol, qty, price):
        order = self._request("POST", "/v2/orders", {
            "symbol": symbol, "qty": str(qty), "side": "buy", "type": "market", "time_in_force": "day",
        })
        return {"symbol": symbol, "side": "buy", "qty": qty, "price": price, "order_id": order.get("id")}

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
