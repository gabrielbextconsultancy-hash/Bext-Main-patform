-- 028_article_date_state.sql
--
-- Tracks whether an article's page has been opened to read its publication date.
--
-- parseIndex() only ever read the listing page, so published_at was null for
-- every scraped source: 232 of 318 articles over three days. The pipeline knew
-- when it had *looked*, not when a story was *published*, and 33% of the
-- articles that do carry a date would fall in a different day bucket if dated
-- by fetch time. That is what the client kept seeing as missing articles.
--
-- The date is on the article page — renewablesnow and abc.net.au both publish
-- article:published_time — so the fix is to open the page. This column is what
-- keeps that affordable: a page is visited once, not on every pass.
--
-- 'blocked' is deliberately distinct from 'none'. Fetching too fast earns a 429,
-- and a 429 looks exactly like "no date published" unless it is recorded
-- separately. 23 of 31 apparently-dateless articles on 25 Aug 2026 were in fact
-- rate-limited. 'blocked' is retried; 'none' is not.
CREATE TYPE article_date_state AS ENUM ('pending', 'found', 'none', 'blocked');

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS date_state article_date_state NOT NULL DEFAULT 'pending';

-- Articles that already carry a date need no visit.
UPDATE articles SET date_state = 'found' WHERE published_at IS NOT NULL;

-- The enrichment pass reads only the pending ones, so keep that lookup cheap
-- rather than scanning a table that grows by a hundred rows a day forever.
CREATE INDEX IF NOT EXISTS articles_date_pending_idx
  ON articles (fetched_at DESC) WHERE date_state = 'pending';

-- fetch_attempts records one row per source per tier per hour and has never had
-- a retention policy — roughly 70 sources x 5 tiers x 24 hours = 8,400 rows a
-- day, kept forever. Thirty days is well past the point anyone diagnoses from.
DELETE FROM fetch_attempts WHERE run_at < now() - interval '30 days';
