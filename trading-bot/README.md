# TradingView Trading Bot

Automates trades from TradingView chart signals:

```
TradingView chart ──(Pine Script alert)──▶ webhook ──▶ this bot ──▶ risk checks ──▶ broker
```

> **Read this first.** No bot can guarantee profit, and most retail trading strategies lose money
> after fees. This bot runs in **paper (fake money) mode by default**. Only switch to live trading
> after the strategy has been profitable in the TradingView Strategy Tester **and** in weeks of paper
> trading, and only with money you can afford to lose.

## How it reads the charts

TradingView has no API for pulling chart data or signals. The supported way to automate it is a
**Pine Script** strategy that runs on TradingView's servers, analyses each bar, and fires a
**webhook alert** when it wants to trade. `pine/ema_rsi_strategy.pine` is a starter strategy:

- **Trend:** 20 EMA above 50 EMA means an uptrend.
- **Buy:** in an uptrend, RSI crosses back up through 35 (buys the pullback).
- **Sell:** the trend flips, RSI goes above 70, or the 3% stop-loss or 6% take-profit is hit.

The strategy is long-only. Each alert sends JSON like
`{"secret":"...","symbol":"AAPL","action":"buy","price":187.2}`.

## Risk controls (enforced by the bot, whatever the alert says)

| Setting | Default | What it does |
|---|---|---|
| `MAX_POSITION_USD` | 1000 | Dollars spent per buy |
| `MAX_DAILY_LOSS_USD` | 200 | Stops new buys for the rest of the day once equity falls this much |
| `MAX_TRADES_PER_DAY` | 10 | Maximum buys per day |
| `ALLOWED_SYMBOLS` | *(any)* | Comma-separated whitelist, e.g. `SPY,AAPL` |

Sells that close a position are always allowed, even after trading is halted. The bot won't buy
a symbol it already holds, alerts need the shared secret, and every trade is appended to
`trades.jsonl`.

## Setup

Requires Python 3.9 or newer. It uses only the standard library, so there's nothing to install.

### 1. Run the bot with the built-in simulator

```bash
cd trading-bot
export WEBHOOK_SECRET="pick-a-long-random-string"
python -m bot.server            # listens on :8080
```

Test it:

```bash
curl -X POST localhost:8080/webhook -H 'Content-Type: application/json' \
  -d '{"secret":"pick-a-long-random-string","symbol":"AAPL","action":"buy","price":190}'
curl localhost:8080/status
```

### 2. Put it on the internet

TradingView webhooks need a public HTTPS URL on port 443 or 80. You can:

- deploy to a small VPS or a service such as Render, Railway or Fly.io, or
- for testing, run `ngrok http 8080` and use the https URL it prints.

### 3. Connect TradingView

You need a TradingView plan that includes webhook alerts.

1. Open the Pine Editor, paste `pine/ema_rsi_strategy.pine`, and click **Add to chart**.
2. In the script's settings, set **Webhook secret** to your `WEBHOOK_SECRET`.
3. Check the **Strategy Tester** tab. If the backtest isn't profitable on your symbol and
   timeframe, adjust it or pick another one before going further.
4. Create an alert: set **Condition** to *EMA/RSI Webhook Bot* with *alert() function calls
   only*, and set **Notifications → Webhook URL** to `https://your-server/webhook`.

### 4. Paper trade with a real broker (Alpaca)

1. Create a free account at [alpaca.markets](https://alpaca.markets) and generate **paper**
   API keys.
2. Run the bot with those keys:

   ```bash
   export BROKER=alpaca ALPACA_KEY=... ALPACA_SECRET=...
   python -m bot.server
   ```

   It uses Alpaca's paper endpoint, so orders are real simulated orders with fake money.

### 5. Live trading (optional, at your own risk)

Set `LIVE_TRADING=true` and use your **live** Alpaca keys. The bot logs `mode=LIVE MONEY` at
startup. Start with a small `MAX_POSITION_USD`.

## Tests

```bash
cd trading-bot && python -m unittest discover -s tests -t .
```

## Files

- `bot/server.py`: HTTP server with `POST /webhook` and `GET /status`.
- `bot/engine.py`: alert validation, risk limits and the trade journal.
- `bot/brokers.py`: `PaperBroker` (the simulator) and `AlpacaBroker`.
- `bot/config.py`: settings read from environment variables.
- `pine/ema_rsi_strategy.pine`: the TradingView strategy that generates the signals.
