# Strategy: Trend (200 SMA) on daily BTC/CAD

## The idea

Bitcoin spends long stretches trending. Being in the market only while price is above its
200-day average catches most of the big uptrends and sits in cash through most of the big
crashes. It doesn't try to predict tops or bottoms; it reacts after the trend has turned.

## Why this one

Three styles were compared in `pine/trend_breakout_strategy.pine` on 2016–2021:

| Style | 2016–2021 return | Note |
|---|---|---|
| Trend (200 SMA) | +6,606% | chosen |
| Golden cross (50/200) | +5,908% | only 5 trades, too few to trust |
| 20-bar breakout | +2,164% | more trades, more fees |

Trend (200 SMA) was then checked **once** on 2022 to Sep 2026, a period it was never tuned on:

- **+218.8%**, max drawdown **21.2%**, 4 of 10 trades profitable.
- Buy-and-hold made about +100% over the same period, with a ~65% crash in 2022 that the
  strategy sat out in cash.

An EMA/RSI pullback strategy on the 1h chart **lost 2.5%** (2 winners out of 26 trades, mostly
fees). It's kept in `pine/ema_rsi_strategy.pine` as a reminder that more trades usually means
more fees, not more profit.

## What to expect

- Long quiet spells, sometimes months, with no trades.
- More losing trades than winning ones. The losses are small whipsaws around the average; the
  profit comes from one or two long trends.
- A position can give back a large part of its gains before the trend exit triggers.
- Past results don't guarantee future ones. A backtest with 10 trades is a small sample.

## When I'd consider the strategy broken

- TODO (interview): for example, a drawdown well beyond 21%, or trailing buy-and-hold for a
  full cycle.

## Ideas to test later (not live)

- TODO (interview): anything you want to try, such as ETH/CAD, a hard stop, or scaling in.
  Each one gets backtested in the Pine Script first, tuned on one period and checked on another.

## Change log

- 2026-09-28: file created from the README's backtest results.
