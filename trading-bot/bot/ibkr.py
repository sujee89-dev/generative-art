"""Interactive Brokers stocks/ETFs through IB Gateway (paper account unless IBKR_LIVE=true).

IBKRBroker holds the trading rules (whole shares, only sell what the bot bought, paper-account
safety check) and talks to IB Gateway through a small `gateway` object, so the rules can be
tested without IBKR. IBGateway is the real implementation, built on the ib_async library.
"""
import asyncio
import json
import os
import threading

from .brokers import BrokerError


class IBKRBroker:
    def __init__(self, gateway, state_path, live=False):
        self.gw = gateway
        self.before_close = None  # e.g. CoveredCallManager.cover: buy back calls before selling shares
        self.state_path = state_path
        self.live = live
        self.last_price = {}
        self.held = {}
        self._checked_account = False
        if os.path.exists(state_path):
            with open(state_path) as f:
                self.held = json.load(f)

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.held, f)
        os.replace(tmp, self.state_path)

    def _check_account(self):
        """Refuse to touch a real-money account unless IBKR_LIVE=true (paper accounts start with D)."""
        if self._checked_account:
            return
        account = self.gw.account_id()
        if not self.live and not account.upper().startswith("D"):
            raise BrokerError(f"IB Gateway is logged in to live account {account} but IBKR_LIVE is not true")
        self._checked_account = True

    def buy(self, symbol, qty, price, crypto=False):
        self._check_account()
        qty = int(qty)
        if qty < 1:
            raise BrokerError(f"need at least 1 share of {symbol}")
        order_id, filled, avg = self.gw.market_order(symbol, "BUY", qty)
        if filled <= 0:
            raise BrokerError(f"IBKR buy of {symbol} did not fill (order {order_id})")
        self.held[symbol] = self.held.get(symbol, 0) + filled
        self._save()
        return {"symbol": symbol, "side": "buy", "qty": filled, "price": avg or price, "order_id": order_id}

    def close(self, symbol, price):
        held = self.held.get(symbol, 0)
        if held <= 0:
            return None
        self._check_account()
        if self.before_close:
            self.before_close(symbol)  # never leave a sold call uncovered
        qty = int(min(held, self.gw.position(symbol)))
        if qty <= 0:  # sold or transferred outside the bot
            self.held.pop(symbol, None)
            self._save()
            return None
        order_id, filled, avg = self.gw.market_order(symbol, "SELL", qty)
        if filled <= 0:
            raise BrokerError(f"IBKR sell of {symbol} did not fill (order {order_id})")
        remaining = held - filled
        if remaining > 0:
            self.held[symbol] = remaining
        else:
            self.held.pop(symbol, None)
        self._save()
        return {"symbol": symbol, "side": "sell", "qty": filled, "price": avg or price, "order_id": order_id}

    def position_qty(self, symbol):
        return self.held.get(symbol, 0)

    def mark(self, symbol, price):
        self.last_price[symbol] = price

    def equity(self):
        return self.gw.net_liquidation()


class IBGateway:
    """ib_async connection to IB Gateway, run on its own event-loop thread so any thread can call it."""

    FILL_TIMEOUT_S = 60

    def __init__(self, host, port, client_id=1):
        self.host, self.port, self.client_id = host, port, client_id
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True, name="ib-gateway").start()
        self._ib = None

    def _run(self, coro, timeout=90):
        try:
            return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)
        except BrokerError:
            raise
        except Exception as e:
            raise BrokerError(f"IBKR: {type(e).__name__}: {e}")

    async def _connected(self):
        from ib_async import IB  # imported lazily so the crypto-only bot never needs it

        if self._ib is None:
            self._ib = IB()
        if not self._ib.isConnected():
            await self._ib.connectAsync(self.host, self.port, clientId=self.client_id, timeout=20)
            # Live quotes if subscribed, otherwise free delayed ones (enough to price monthly calls).
            self._ib.reqMarketDataType(4)
        return self._ib

    async def _contract(self, ib, symbol):
        from ib_async import Stock

        contracts = await ib.qualifyContractsAsync(Stock(symbol, "SMART", "USD"))
        if not contracts or contracts[0] is None:
            raise BrokerError(f"IBKR doesn't know the US stock {symbol}")
        return contracts[0]

    def account_id(self):
        async def go():
            ib = await self._connected()
            return ib.managedAccounts()[0]
        return self._run(go())

    def net_liquidation(self):
        async def go():
            ib = await self._connected()
            for v in await ib.accountSummaryAsync():
                if v.tag == "NetLiquidation":
                    return float(v.value)
            raise BrokerError("IBKR account summary has no NetLiquidation")
        return self._run(go())

    def position(self, symbol):
        async def go():
            ib = await self._connected()
            return sum(p.position for p in ib.positions()
                       if p.contract.symbol == symbol and p.contract.secType == "STK")
        return self._run(go())

    async def _place(self, ib, contract, order):
        """Place an order, wait up to FILL_TIMEOUT_S for it to finish, and cancel it if it hasn't, so a
        retry at the next check can never stack up duplicate orders. Any partial fill is reported."""
        trade = ib.placeOrder(contract, order)
        for _ in range(self.FILL_TIMEOUT_S):
            if trade.isDone():
                break
            await asyncio.sleep(1)
        if not trade.isDone():
            ib.cancelOrder(trade.order)
            for _ in range(15):
                if trade.isDone():
                    break
                await asyncio.sleep(1)
        status = trade.orderStatus
        return trade.order.orderId, float(status.filled), float(status.avgFillPrice or 0)

    def market_order(self, symbol, side, qty):
        """Market order for shares. Returns (order_id, filled_qty, avg_price)."""
        async def go():
            from ib_async import MarketOrder

            ib = await self._connected()
            return await self._place(ib, await self._contract(ib, symbol), MarketOrder(side, qty, tif="DAY"))
        return self._run(go())

    # --- options (covered calls) ---

    async def _call_contract(self, ib, symbol, expiry, strike):
        from ib_async import Option

        found = await ib.qualifyContractsAsync(
            Option(symbol, expiry, strike, "C", "SMART", multiplier="100", currency="USD", tradingClass=symbol))
        if not found or found[0] is None:
            raise BrokerError(f"IBKR has no {symbol} {expiry} {strike} call")
        return found[0]

    def call_chain(self, symbol):
        """Available call expirations ('YYYYMMDD') and strikes for a stock, both sorted."""
        async def go():
            ib = await self._connected()
            stock = await self._contract(ib, symbol)
            chains = await ib.reqSecDefOptParamsAsync(stock.symbol, "", stock.secType, stock.conId)
            smart = [c for c in chains if c.exchange == "SMART"]
            chain = next((c for c in smart if c.tradingClass == symbol), smart[0] if smart else None)
            if chain is None:
                raise BrokerError(f"IBKR has no option chain for {symbol}")
            return sorted(chain.expirations), sorted(chain.strikes)
        return self._run(go())

    def call_quote(self, symbol, expiry, strike):
        """(bid, ask) for a call; None for a side with no quote."""
        async def go():
            ib = await self._connected()
            ticker = (await ib.reqTickersAsync(await self._call_contract(ib, symbol, expiry, strike)))[0]
            clean = lambda x: x if x == x and x is not None and x > 0 else None  # drop NaN / -1
            return clean(ticker.bid), clean(ticker.ask)
        return self._run(go())

    def call_order(self, symbol, expiry, strike, side, qty, limit=None):
        """Sell (limit) or buy back (market, or limit) calls. Returns (order_id, filled_qty, avg_price)."""
        async def go():
            from ib_async import LimitOrder, MarketOrder

            ib = await self._connected()
            contract = await self._call_contract(ib, symbol, expiry, strike)
            order = (LimitOrder(side, qty, limit, tif="DAY") if limit is not None
                     else MarketOrder(side, qty, tif="DAY"))
            return await self._place(ib, contract, order)
        return self._run(go())

    def short_calls(self, symbol):
        """Open short call positions on a stock: {(expiry, strike): contracts}."""
        async def go():
            ib = await self._connected()
            out = {}
            for p in ib.positions():
                c = p.contract
                if c.symbol == symbol and c.secType == "OPT" and c.right == "C" and p.position < 0:
                    key = (c.lastTradeDateOrContractMonth, float(c.strike))
                    out[key] = out.get(key, 0) - int(p.position)
            return out
        return self._run(go())
