-- 008_fix_starved_feeds.sql
--
-- Two sources had never produced a single article, while reporting last_status
-- 'ok' — because "fetched cleanly but yielded nothing" and "delivered" share
-- that status. Both were pointed at a site-wide feed they had to share with a
-- sibling source:
--
--   arena-knowledge      filters for /knowledge-bank, but arena.gov.au/feed/
--                        carries no such URLs, so all ten items were rejected
--                        every run. Its own feed exists.
--
--   reneweconomy-leitch  read the same feed as `reneweconomy`. articles.url is
--                        globally unique, so whichever source ran first claimed
--                        the row and this one kept nothing. The author feed is
--                        disjoint from what the sibling takes.
--
-- Both replacements were parsed with the real ingest parser and the source's
-- own filter before being applied: arena-knowledge 0 -> 2 fresh items,
-- reneweconomy-leitch 1 -> 4.
--
-- Not changed, having been checked and found healthy: aemc-registers and
-- veu-program also lose rows to a sibling on the unique index, but the articles
-- are still ingested under that sibling and still reach the daily sheet. Only
-- the attribution differs, which is not worth a schema change.

BEGIN;

UPDATE sources
SET config = jsonb_set(config, '{feed_url}', '"https://arena.gov.au/knowledge-bank/feed/"'),
    consecutive_failures = 0,
    updated_at = now()
WHERE slug = 'arena-knowledge';

UPDATE sources
SET config = jsonb_set(config, '{feed_url}', '"https://reneweconomy.com.au/author/david-leitch/feed/"'),
    consecutive_failures = 0,
    updated_at = now()
WHERE slug = 'reneweconomy-leitch';

-- gbca returned 522 for long enough to be written off, but now answers 200 with
-- 286 links. Clear the failure count so it is not treated as chronically broken.
UPDATE sources
SET consecutive_failures = 0, last_error = NULL, updated_at = now()
WHERE slug = 'gbca';

COMMIT;
