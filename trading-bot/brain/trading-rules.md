# Trading rules

These are the rules the bot follows. Claude must follow them too when it suggests, reviews or
places trades. Values marked *(code)* are what `bot/` does today; change the code and this file
together.

## Market

- **Exchange:** Kraken (registered in Canada). *(code: `BROKER=kraken`)*
- **Pair:** BTC/CAD spot. *(code: `AUTO_TRADE_SYMBOL=BTCCAD`)*
- **Direction:** long only. No shorting, no leverage, no futures, no margin.
- **Timeframe:** daily candles. The bot checks hourly but acts only on a *completed* day, at most
  once per candle. *(code: `bot/autotrader.py`)*

## Entry

- Buy when the bot holds no BTC and the daily close is **above the 200-day SMA**. *(code)*
- Only one open position per pair; a second buy signal while holding does nothing. *(code)*

## Exit

- **Trend exit (this is the stop-loss):** sell everything when the daily close is **more than 3%
  below the 200-day SMA**. *(code: `TREND_EXIT_BUFFER_PCT=3`)*
- **Take-profit:** none. The strategy makes its money from a few long trends, so a fixed target
  would cut the winners short. Let the trend exit close winning trades.
- **Hard stop-loss:** none today. The worst case is a sharp drop within one day before the close
  confirms it. TODO (interview): decide whether you want a hard stop (for example 15% below entry)
  on top of the trend exit. It would need code.
- Selling to close is always allowed, even when trading is halted. *(code)*

## Position size

- Each buy spends a fixed **`MAX_POSITION_USD`** (in CAD for CAD pairs). Currently **$100** in
  `render.yaml`. *(code)*
- The backtest compounds 95% of the account; the live bot does not. That's deliberate while testing.
- TODO (interview): the size you'll move to after paper trading, and the maximum you'd ever use.

## Risk limits (enforced by the bot, whatever the signal says)

| Limit | Value | Setting |
|---|---|---|
| Max loss per day before buys stop | $30 | `MAX_DAILY_LOSS_USD` |
| Max buys per day | 10 | `MAX_TRADES_PER_DAY` |
| Max per buy | $100 | `MAX_POSITION_USD` |
| Pause switch | Telegram `/pause` | see README, "Phone control" |

- TODO (interview): the total account drawdown at which you stop the bot and review everything.

## Costs

- Kraken market orders cost about **0.4% each way**, so a round trip needs a move of more than
  about 0.8% to break even. The backtest already charges this.

## Going live

- The bot runs in **paper mode** (`BROKER=paper`) until every item here is true:
  - [ ] TODO (interview): minimum weeks of paper trading (suggestion: at least 8, or 2 real trades)
  - [ ] Paper trades matched what the Pine Script backtest would have done on the same days
  - [ ] You've written down, in `private/financial-plan.md`, the amount you can afford to lose
- Kraken API key: **only** *Query Funds* and *Create & Modify Orders*. **Never** enable
  withdrawals. Turn on 2FA on the Kraken account. Keys live in Render's Environment, nowhere else.

## Rules for Claude as my trading assistant

- Never place, cancel or change a live order without my explicit "yes" in the same conversation.
- Never raise a risk limit or position size on your own; propose it and explain the downside.
- If I ask for a trade that breaks these rules, say which rule it breaks before doing anything.
- Backtest any new strategy idea before it touches the bot, and compare it with buy-and-hold
  after fees.
- Don't trust a backtest tuned on the same period it's tested on. Tune on one period, check once
  on a later one (see `strategy.md`).

## Change log

- 2026-09-28: file created from the bot's current code.
