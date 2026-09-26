# Mortgage broker lead tools

Two small command-line apps for an Ontario mortgage agent working Durham Region and Scarborough.
Both run on Python 3.10+ with no required dependencies, and store their data in a local SQLite file.

| App | What it does |
|---|---|
| **`renewal_hunter`** | Imports GeoWarehouse land-registry exports, works out which mortgages are still on title and when each one probably renews, scores the leads, and writes a mailing list, door-knocking route sheets and an HTML report. |
| **`asking_monitor`** | Watches Reddit, forum RSS feeds and posts you paste in from Facebook groups for people asking mortgage questions. It alerts you and drafts a helpful reply with Claude. You review the draft and post it yourself. |

```bash
cd mortgage-leads
pip install -r requirements.txt        # optional, only needed for Claude-drafted replies
python -m unittest discover -s tests -t .
```

---

## 1. Renewal Hunter

### How it estimates renewals

* Land registry records a **charge** when a mortgage is registered. A renewal with the same lender
  is **not** registered. A charge from 2016 on a 5-year term probably renewed quietly in 2021 and
  comes up again in 2026, so the app projects the renewal on the term cycle, not just
  registration + 5 years.
* Term length isn't on title. The app assumes **5 years**, which is the most common term, and
  **1 year for private lenders**. It also shows the 3-year alternative date.
* A charge is dropped when a **discharge** references it, when an unreferenced discharge follows it
  (the oldest open charge is assumed paid off), or when the property is **sold** (transfer).
  Charges older than 25 years are ignored.
* On a property with several open charges, the earliest one is treated as the first mortgage. The
  others (HELOCs, second mortgages) are flagged as a consolidation angle.

### Scoring (0–100)

| Factor | Points |
|---|---|
| Timing: renews in 90–240 days (before the lender's ~120-day renewal letter) | 50 (240–365 d: 35, 30–90 d: 30, 365–540 d: 15) |
| Lender: big bank 15, credit union 12, alt lender 12, private 10, monoline 6 (probably already has a broker) | up to 15 |
| Registered amount ≥ $800k / $500k / $300k | 20 / 15 / 10 |
| 5-year term signed Mar 2020 – Mar 2022 (low-rate cohort, so a payment jump at renewal) | 10 |
| Other charges on title | 5 |

### Usage

```bash
# 1. Export charge/instrument data from GeoWarehouse as CSV, then import it (re-importing is safe)
python -m renewal_hunter import exports/*.csv
#    Columns are matched by common header names. If your export uses different ones:
python -m renewal_hunter import export.csv --column-map my_columns.json   # {"reg_date": "Reg Dt", ...}

# 2. See leads in your areas, renewing within the next year
python -m renewal_hunter leads --area Whitby --area Ajax --area Scarborough --within-days 365

# 3. Mailing list CSV, door-knock CSV and printable route sheet, and the HTML report
python -m renewal_hunter export --area Whitby --area Ajax --area Scarborough --min-score 50 --out-dir out/

# 4. Track outreach so won/lost leads drop off the next mailing
python -m renewal_hunter mark DR1234567 mailed --note "Oct postcard"
python -m renewal_hunter mark DR1234567 appointment

# 5. Honour opt-outs
python -m renewal_hunter dnc "231 Cochrane St, Whitby" --reason "asked not to be contacted"

python -m renewal_hunter areas     # list built-in areas and their postal FSAs
```

Built-in areas are Whitby, Ajax, Pickering, Oshawa and Scarborough. They match on municipality or
postal FSA. Scarborough rows usually say "TORONTO", so they're picked out by `M1x` postal codes. To
add your own areas, pass `--areas-config areas.json` with
`[{"name": "Courtice", "municipalities": ["Courtice"], "fsas": ["L1E"]}]`.

Try it with the fake sample data:
```bash
python -m renewal_hunter --db demo.db import sample_data/geowarehouse_sample.csv
python -m renewal_hunter --db demo.db export --area Whitby --area Ajax --area Scarborough --today 2026-09-26
```

---

## 2. Who's Asking monitor

### Pipeline

1. **Sources**
   * **Reddit.** Reads `/new` for each subreddit in the config. Create a free "script" app at
     <https://www.reddit.com/prefs/apps> and set `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` to use
     the official API. Without them the app falls back to Reddit's public JSON, which is heavily
     rate-limited.
   * **Forums.** Any RSS or Atom feed, e.g. a RedFlagDeals or Canadian Money Forum board's feed.
   * **Facebook groups.** Meta shut down the Groups API in 2024, and scraping groups breaks
     Facebook's terms. Instead, copy posts from groups you belong to (where the rules allow it)
     with `add` or `import`.
2. **Classifier.** Fast rules detect intents: renewal, breaking a mortgage or penalties, first-time
   buyers, refinance/HELOC, rate choice, switching lenders, self-employed or bruised credit, and
   payment shock. It adds points when the post is asking for help or mentions your area. It
   penalises US posts (r/durham is mostly Durham, **North Carolina**) and skips promotional posts.
   Every match shows why it matched.
3. **Alerts.** New matches print in the terminal and can also go to a Slack or Discord webhook.
4. **Drafts.** Claude (`claude-opus-5`, server-side fallback enabled) writes a reply that answers
   the question first, with no sales pitch and no "DM me". It won't quote current rates. It ends
   with your disclosure line. It also tells you when **not** to reply, e.g. an off-topic post, a
   poster outside Canada, or a community that bans industry replies. Without an Anthropic API key
   it uses short templates instead.

### Usage

```bash
cp monitor_config.example.json monitor_config.json   # set subreddits, feeds, disclosure, webhook
export ANTHROPIC_API_KEY=...                         # optional
export REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... # recommended

python -m asking_monitor scan --draft                # one pass
python -m asking_monitor watch --interval 900 --draft --digest digest.html   # every 15 min

python -m asking_monitor add "Our renewal letter from TD just came..." --community "Whitby Moms" --draft
python -m asking_monitor import sample_data/sample_posts.json

python -m asking_monitor list
python -m asking_monitor show a813d0d747df
python -m asking_monitor draft a813d0d747df           # redraft
python -m asking_monitor mark a813d0d747df replied    # replied | ignored | converted
python -m asking_monitor digest --out digest.html     # review page with copy-to-clipboard drafts
```

---

## Compliance: read before you use these

These apps help you find and prepare outreach. You're responsible for how you use them.

* **GeoWarehouse licence.** Check your subscription terms on using GeoWarehouse or Teranet data
  for marketing and solicitation before mailing or door-knocking from it.
* **CASL.** Physical mail and door-knocking are outside Canada's Anti-Spam Legislation. Emails and
  texts are not, and you can't message people found through registry data without consent.
* **FSRA.** Advertising has to follow FSRA's rules for mortgage brokerages and agents, including
  identifying your brokerage and licence. Put that in the `disclosure` line and on your mailers.
* **Do not contact.** Log every opt-out with `renewal_hunter dnc`. Suppressed addresses never
  appear in exports.
* **Reddit and communities.** Most subreddits, including r/PersonalFinanceCanada, ban
  self-promotion and soliciting. Post only helpful answers, follow each community's rules, and
  never auto-post or send unsolicited DMs. The app only drafts; posting is always manual.
* **Estimates.** Renewal dates, balances and lender types are inferred. Registered amounts are
  original principal, and collateral charges may be registered above the actual loan.

## Layout

```
renewal_hunter/  importer.py  scoring.py  areas.py  export.py  db.py  cli.py
asking_monitor/  sources.py   classifier.py  drafter.py  digest.py  store.py  alerts.py  cli.py
sample_data/     fake GeoWarehouse CSV (+ generator) and sample posts
tests/           unittest suites for both apps
```
