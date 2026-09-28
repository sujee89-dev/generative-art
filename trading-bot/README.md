# TradingView Trading Bot

Automates stock and crypto trades from TradingView chart signals:

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
**webhook alert** when it wants to trade. There are two strategies in `pine/`:

- **`trend_breakout_strategy.pine`** (try this first, on the **daily** chart): three trend styles
  you choose between in its settings (20-bar breakout, 200-SMA trend and 50/200 golden cross). All
  of them sit in cash during downtrends. It has start and stop date inputs, so you can pick a style
  on one period and check it on a later one it was never tuned on.
  - **Default: Trend (200 SMA).** It was chosen on 2016–2021 (Trend +6,606%, Golden cross
    +5,908% from only 5 trades, Breakout +2,164%). Then it was checked once on **2022–Sep 2026**,
    which it was never tuned on: **+218.8%, max drawdown 21.2%**, 4 of 10 trades profitable.
    Buy and hold made about +100% over that period, with a ~65% crash in 2022, which the strategy
    sat out in cash.
  - It profits from a few long trends and takes several small losses in between, so expect long
    quiet spells. Past results don't guarantee future ones.
  - An earlier Breakout run at 10% per trade made only about 2%/year (2022–2026), which is why
    position size now defaults to 95%.
- **`ema_rsi_strategy.pine`**: buys RSI pullbacks in an EMA uptrend with a 3% stop and 6% target.
  On `KRAKEN:BTCCAD` 1h (Dec 2024–Sep 2026) it **lost 2.5%**: 2 winners out of 26 trades, with
  fees making up most of the loss. It's kept as an example of what the Strategy Tester is for.

Always compare a strategy with **Buy & hold** in the Strategy Tester. If it doesn't beat simply
holding the coin, after fees, it isn't worth running.

Both strategies are long-only. It works on stock and crypto charts. Each alert sends JSON like
`{"secret":"...","symbol":"BTCUSDT","type":"crypto","action":"buy","price":64210.5}`.

## Supported brokers

| `BROKER` | Markets | Practice mode (default) | Live (`LIVE_TRADING=true`) |
|---|---|---|---|
| `paper` | anything | built-in simulator, $10k fake cash | — |
| `binance` | crypto (e.g. `BTCUSDT`) | Binance Spot **testnet** | api.binance.com |
| `alpaca` | US stocks + crypto (e.g. `BTCUSD`) | Alpaca paper account | api.alpaca.markets |
| `kraken` | crypto (e.g. `BTCCAD`) | none: practise with `paper` | api.kraken.com |

### Which broker to use in Canada

- **Crypto: Kraken.** It's registered with Canadian securities regulators in every province.
  Binance left Canada in 2023. Trade CAD pairs such as `KRAKEN:BTCCAD`.
- **Practice:** `BROKER=paper` (the built-in simulator) on `KRAKEN:BTCCAD` charts, or an Alpaca
  paper account, which Canadians can open even though Alpaca doesn't offer them live accounts.
- **Stocks with real money:** not supported yet. Interactive Brokers is the usual choice with an
  API that works in Canada; Wealthsimple and Questrade don't let bots place orders.

Stocks are bought in whole shares; crypto in fractions. On Binance and Kraken the bot tracks the
coins it bought itself (in `STATE_PATH`) and only ever sells those, so coins you already own are safe.

## Auto-trading without TradingView (recommended)

Set `AUTO_TRADE_SYMBOL=BTCCAD` and the bot reads the chart itself. Once an hour it downloads
Kraken's daily BTC/CAD candles (a free public API, no account needed) and applies the tested
**Trend (200 SMA)** rule to the last *completed* day:

- **Buy** when it holds nothing and the close is above the 200-day average.
- **Sell** when it holds a position and the close is more than 3% below the 200-day average.

It acts at most once per daily candle. It uses the same risk limits and journal as webhooks, and
`GET /status` shows the last check under `auto_trader` (close, average, signal, result).
No TradingView subscription or alert is needed; the Pine Script is only for backtesting.
Settings: `TREND_SMA` (200), `TREND_EXIT_BUFFER_PCT` (3) and `AUTO_CHECK_MINUTES` (60). It works
with `BROKER=paper` or `kraken`.

Unlike the backtest, which compounds 95% of the account, the bot spends a fixed
`MAX_POSITION_USD` per buy (in CAD for CAD pairs). With `BROKER=paper` the simulated position
lives in memory, so after a restart the bot is flat and simply buys again at the next check if
the trend is still up.

## Second brain: your rules and goals for Claude

`brain/` holds your trading rules, strategy and goals as Markdown, so Claude has full context
every time you work on the bot (`CLAUDE.md` tells Claude Code to read it first). The rules and
strategy files are already filled in from what the code does; a 30-question interview fills in
the rest. Start with `brain/README.md`. Personal and financial answers go in `brain/private/`,
which git ignores, because this repository is public.

## Phone control (Telegram)

The bot can message you on every trade and when something goes wrong, and answers `/status`,
`/pause` (stop new buys; sells still go through) and `/resume`. It runs on the server, so
nothing needs to stay on at home.

1. In Telegram, search for **@BotFather**, send `/newbot` and follow the steps. It gives you a
   token like `123456:ABC...`. Treat it like a password.
2. In Render → Environment, set `TELEGRAM_BOT_TOKEN` to that token.
3. Send your new bot any message. It replies with your chat id.
4. Set `TELEGRAM_CHAT_ID` to that number. From then on, only your chat can use the commands;
   messages from anyone else are ignored.

`/pause` lasts until `/resume` or a restart (a redeploy starts unpaused). It can't place trades;
the bot still only trades on its own signals.

## Risk controls (enforced by the bot, whatever the alert says)

| Setting | Default | What it does |
|---|---|---|
| `MAX_POSITION_USD` | 1000 | Dollars spent per buy |
| `MAX_DAILY_LOSS_USD` | 200 | Stops new buys for the rest of the day once equity falls this much |
| `MAX_TRADES_PER_DAY` | 10 | Maximum buys per day |
| `ALLOWED_SYMBOLS` | *(any)* | Comma-separated whitelist, e.g. `SPY,AAPL` |
| Telegram `/pause` | off | Stops new buys until `/resume` |

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

### 2. Deploy online (Render)

TradingView webhooks need a public HTTPS URL. The repo includes a Render Blueprint
(`render.yaml` at the repo root) that sets everything up. It costs about **$7/month**: the free
plan sleeps when idle and would miss alerts.

1. Merge this branch into `main` (Render deploys `main` by default).
2. Sign up at [render.com](https://render.com) with your GitHub account.
3. Click **New → Blueprint**, pick this repository, and click **Apply**.
4. Leave the key fields blank for now; the bot starts in `paper` mode.
5. When it's live, open the service and copy:
   - the URL, e.g. `https://tradingview-bot-xxxx.onrender.com`; your webhook is that plus `/webhook`
   - **Environment → WEBHOOK_SECRET** (Render generated it); this goes into the Pine Script
6. Check `https://<your-url>/status` in a browser.

Trade logs and Binance positions are stored on a 1 GB disk at `/data`, so they survive restarts.
The server runs in Render's Ohio region, the closest to Canada.

To change a setting later (broker, keys, limits), edit **Environment** in the Render dashboard;
the bot restarts automatically.

For quick local testing instead, run `ngrok http 8080` and use the https URL it prints.

### 3. Connect TradingView

Backtesting in the Strategy Tester works on the **free** plan. Webhook alerts need a **paid**
plan and 2‑factor authentication turned on in your TradingView account. Only pay once the backtest
looks good.

1. Open the Pine Editor, paste `pine/trend_breakout_strategy.pine`, and click **Add to chart**.
2. In the script's settings, set **Webhook secret** to your `WEBHOOK_SECRET`.
3. Check the **Strategy Tester** tab. If the backtest isn't profitable on your symbol and
   timeframe, adjust it or pick another one before going further.
4. Create an alert: set **Condition** to *EMA/RSI Webhook Bot* with *alert() function calls
   only*, and set **Notifications → Webhook URL** to `https://your-server/webhook`.

### 4. Crypto on Kraken (Canada)

1. Practise first: keep `BROKER=paper` and point your TradingView alert at a `KRAKEN:BTCCAD`
   chart. Watch `/status` and `trades.jsonl` for a few weeks.
2. When you're ready for real money, open and verify a Kraken account and deposit a small amount
   of CAD.
3. Create an API key under **Settings → API** with **only** *Query Funds* and *Create & Modify
   Orders* ticked. Never tick withdrawals.
4. In Render → Environment, set `BROKER=kraken`, `KRAKEN_KEY=...`, `KRAKEN_SECRET=...` and
   `LIVE_TRADING=true`. The bot refuses to start with Kraken unless `LIVE_TRADING=true`, because
   Kraken has no practice mode.

Set `MAX_POSITION_USD` and `MAX_DAILY_LOSS_USD` in CAD when you trade CAD pairs; the bot doesn't
convert currencies. Market orders on Kraken cost about 0.4% each way, so a trade has to move more
than about 0.8% just to break even. The Pine Script's backtest already charges that.

### 4a. Practice crypto trading on Binance (not available in Canada)

1. Log in at [testnet.binance.vision](https://testnet.binance.vision) with GitHub and click
   **Generate HMAC_SHA256 Key**. You get free test USDT and BTC.
2. In Render → Environment, set `BROKER=binance`, `BINANCE_KEY=...` and `BINANCE_SECRET=...`.
3. In TradingView, open a Binance chart such as `BINANCE:BTCUSDT` and create the alert on it.

For live trading later: create an API key on binance.com with **only "Enable Spot Trading"** ticked
(never withdrawals), restrict it to your Render server's outbound IPs (shown under
**Connect → Outbound** in Render), and set `LIVE_TRADING=true`.

### 4b. Practice stocks or crypto on Alpaca (paper only in Canada)

1. Create a free account at [alpaca.markets](https://alpaca.markets) and generate **paper**
   API keys.
2. Run the bot with those keys:

   ```bash
   export BROKER=alpaca ALPACA_KEY=... ALPACA_SECRET=...
   python -m bot.server
   ```

   It uses Alpaca's paper endpoint, so orders are real simulated orders with fake money.
   For crypto on Alpaca, use a `COINBASE:BTCUSD`-style chart so the ticker is `BTCUSD`.

### 5. Live trading (optional, at your own risk)

Set `LIVE_TRADING=true` and use your **live** broker keys. The bot logs `mode=LIVE MONEY` at
startup. Start with a small `MAX_POSITION_USD`.

## Tests

```bash
cd trading-bot && python -m unittest discover -s tests -t .
```

## Files

- `bot/autotrader.py`: reads Kraken's daily chart and trades Trend (200 SMA) without TradingView.
- `bot/server.py`: HTTP server with `POST /webhook`, `GET /status` and `GET /health`.
- `bot/telegram.py`: trade alerts and `/status`, `/pause`, `/resume` on Telegram.
- `bot/engine.py`: alert validation, risk limits and the trade journal.
- `bot/brokers.py`: `PaperBroker` (the simulator), `AlpacaBroker`, `BinanceBroker` and `KrakenBroker`.
- `bot/config.py`: settings read from environment variables.
- `pine/trend_breakout_strategy.pine`, `pine/ema_rsi_strategy.pine`: the TradingView strategies that generate the signals.
- `brain/`: the second brain (rules, strategy, interview); `CLAUDE.md` points Claude to it.
- `Dockerfile`, `../render.yaml`: deployment.
