# Trading bot: notes for Claude

Before any trading-related work (strategy, risk settings, orders, going live), read the second
brain in `brain/`:

- `brain/trading-rules.md`: entry, exit, stop-loss, sizing and risk limits, plus the rules you
  must follow as my trading assistant. They are not suggestions.
- `brain/strategy.md`: the strategy, its backtests, and what to expect.
- `brain/private/*.md` if present: my personal context and financial plan. This folder is
  gitignored because the repo is public; never commit it, quote it in commits or PRs, or copy it
  anywhere that gets pushed.

If the brain and the code disagree, say so and ask which one to change. When a change to the
code changes a rule, update `brain/trading-rules.md` (including its change log) in the same commit.

Never put API keys or secrets in any file. They live in Render's Environment settings.

Run the tests with `python -m unittest discover -s tests -t .` from this directory.
