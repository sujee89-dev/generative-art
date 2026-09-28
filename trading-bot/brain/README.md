# Trading second brain

This folder is the memory Claude reads before it helps with this bot. It holds your rules,
your strategy and your goals, so every conversation starts with full context instead of from
scratch. `../CLAUDE.md` tells Claude Code to read it automatically.

| File | What's in it | Committed to git? |
|---|---|---|
| `trading-rules.md` | Entry, exit, take-profit, stop-loss, sizing and risk limits | Yes |
| `strategy.md` | Why the strategy works, backtest results, what to expect | Yes |
| `interview.md` | 30 questions Claude asks you to fill in the rest | Yes |
| `private/personal-context.md` | Who you are, experience, time, temperament | **No** (gitignored) |
| `private/financial-plan.md` | Money, goals, what you can afford to lose | **No** (gitignored) |

`trading-rules.md` and `strategy.md` describe what the code actually does today. Where a rule
is yours to decide, it's marked **TODO (interview)**.

## Set it up (about 30 minutes, once)

1. Create your private notes from the templates:

   ```bash
   cd trading-bot/brain
   mkdir -p private && cp private-template/*.md private/
   ```

   This repository is **public**, so anything personal goes in `private/`, which git ignores.
   Never put API keys in this folder; they belong in Render's Environment settings.

2. Open Claude (the desktop app works best, because you can talk instead of type) and paste:

   > Read trading-bot/brain/. Then interview me using brain/interview.md, one question at a
   > time. After each answer, update the right file: rules and strategy answers go in
   > trading-rules.md or strategy.md, and anything personal or about money goes in
   > private/personal-context.md or private/financial-plan.md. Replace each TODO you answer.
   > If an answer conflicts with what the bot's code does, tell me and ask which one should change.

3. Tweak the files by hand over time (TextEdit, VS Code, anything). They're plain Markdown.

## Keeping it on your Desktop instead

The guide this is based on keeps the brain in a Desktop folder. That works too: copy this
folder to your Desktop, add it to a Claude Desktop project, and use the same prompt. Keep one
copy as the source of truth, or the two will drift apart.

## Rules for the brain itself

- If the code and the brain disagree, the **code is what trades**. Fix one so they match.
- When you change a rule, write the date and why under "Change log" in that file.
- Don't change a rule after a losing trade until you've slept on it.
