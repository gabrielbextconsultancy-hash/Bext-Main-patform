# Why yesterday's articles were missing — 25 Aug 2026

Analysis of the 26 example URLs raised by the client. **21 of 26 were fetched.**
The problem is mostly not fetching — it is dating, and the filter floor.

## Cause 1 — Articles are dated by when we FETCHED, not when they were published (biggest)

**71.6% of articles (590 of 824 in 7 days) carry no publish date.** For those we fall
back to `fetched_at`. Ingest runs hourly, so an article published late on the 24th that
we first see after midnight is stamped the 25th — and therefore lands in *tomorrow's*
report, not yesterday's. To the reader it simply looks missing.

11 of the 26 examples are exactly this: Renewables Now stories published 24 Aug sitting
in the 25 Aug bucket.

Worst-affected sources (all publish no machine-readable date):
Renewables Now 57/57 · AEMO 44/44 · Clean Energy Council 40/40 · AFR 12/15 · ABC Climate 7/8

## Cause 2 — The report that went out this morning still used the old floor of 16

This morning's 05:00 send was built **before** today's floor change and contained 44 items
at `score >= 16`. Three of the examples scored exactly 15 and were cut by one point:
AFR Ampol payout · Renewables Now Norway/Ventyr · German wind financing.

Already fixed — the floor is now 1. These would be included today.

## Cause 3 — S&P Global: we monitor a different section (4 examples)

```
we scrape : spglobal.com/commodity-insights/en/news-research
client links: spglobal.com/energy/en/news-research/latest-news/crude-oil/...
                                                             .../metals/...
```
Not a failure — a coverage gap. Those sections were never registered.

## Cause 4 — Two were scored 0 and dropped as irrelevant

- ABC "climate change and corruption are also driving up interest rates"
- AFR "Cutifani's Elliott links collide with race for Woodside chairmanship"

Both are macro-economic / corporate-governance stories at the edge of scope. The scoring
rule introduced today marks out-of-scope as exactly 0, and 0 is the one score dropped.
The client expected these, so **the 0 rule is cutting too deep** for governance-at-an-
energy-major and climate-to-economy stories.

(The Conversation "how do ice cubes cool a drink" is a physics explainer — correctly absent.)

## Proposed fixes, in priority order

1. **Date the article properly.** Extract the publish date from the URL slug
   (`abc.net.au/news/2026-08-24/...`) and the article page, instead of falling back to
   fetch time. Removes the drift at source.
2. **Safety net — never lose a late arrival.** Add a "reported" ledger and include any
   article not yet reported, rather than relying on the date bucket alone. Guarantees an
   article appears exactly once and is never skipped for crossing midnight.
3. **Register the missing S&P sections** (crude-oil, metals, and siblings).
4. **Soften the 0 rule** so 0 means "no energy/building/climate bearing at all"; edge
   stories score low but stay in.

1 and 2 together close the "yesterday's news is missing" class of complaint permanently.
