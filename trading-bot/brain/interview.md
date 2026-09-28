# Second-brain interview: 30 questions

Claude asks these one at a time and writes each answer into the file named in brackets.
Skip any question that doesn't apply. Answers about money or your life go in `private/`.

## Goals and money  [private/financial-plan.md]

1. What do you want this bot to achieve, and over what time frame?
2. How much will you put into the bot at first, and how much at most later?
3. How much of that could you lose completely without it affecting your life?
4. Do you have an emergency fund and long-term savings separate from this money?
5. What yearly return would make this worth it, compared with just holding BTC or an index fund?
6. Do you already hold crypto outside the bot, and should the bot ever touch it?
7. Which account will you trade from, and have you asked an accountant how crypto trades are taxed for you?

## Strategy  [strategy.md]

8. Why do you trust the 200-day SMA trend strategy? What would make you stop trusting it?
9. Would you rather have fewer, bigger trends (current strategy) or more frequent trades?
10. Do you want to stay on BTC/CAD only, or add other pairs later? Which ones, and why?
11. Do you have a strategy of your own you'd like turned into Pine Script and backtested?
12. How long would you tolerate the strategy trailing buy-and-hold before reviewing it?

## Entries  [trading-rules.md]

13. Is "daily close above the 200-day SMA" enough to buy, or do you want an extra condition?
14. Should the bot buy all at once, or scale in over several days?
15. Are there times you never want it to buy (big news, weekends, after a huge green day)?

## Exits, take-profit and stop-loss  [trading-rules.md]

16. Are you comfortable with no fixed take-profit, letting the trend exit close winners?
17. Do you want a hard stop-loss below your entry, on top of the 3% trend exit? At what level?
18. Should the bot ever take partial profit (for example sell a third after +50%)?
19. Would you ever override a sell signal by hand? Under what conditions, if any?

## Size and risk  [trading-rules.md]

20. How much per trade during paper trading, and how much once live?
21. What daily loss should stop new buys for the day? (Now $30.)
22. At what total drawdown do you pause the bot and review everything?
23. What would make you increase position size, and what's the maximum you'd ever use?

## Going live  [trading-rules.md]

24. How many weeks or trades of paper trading do you need before real money?
25. What has to be true in the paper results before you switch to live?
26. After going live, how will you check the bot (Telegram, `/status`, weekly review)?

## You and Claude  [private/personal-context.md]

27. How experienced are you with trading and crypto, and what mistakes do you tend to make?
28. How do you usually react after a big loss or a big win?
29. How much time a week do you want to spend on this?
30. How should Claude talk to you, and when should it push back?
