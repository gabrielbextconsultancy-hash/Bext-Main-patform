-- Newsletter senders for sources we can already scrape.
--
-- 013 registered the four sources that CANNOT be fetched, where mail is the only
-- route. These two are different: RenewEconomy and The Conversation are both
-- healthy scraped sources, and the operator subscribed to their newsletters on
-- 22 Aug 2026. Registering them anyway is deliberate.
--
-- An index page shows what the publisher chose to feature today, and rolls items
-- off as new ones arrive. Between hourly fetches a story can appear and be pushed
-- below the fold; the newsletter is a second, independent record of what was
-- published. Several of the articles the client flagged as missing on 21 August
-- were of exactly that shape — published, then displaced before we looked.
--
-- The overlap is free: ingest hashes article content to deduplicate stories that
-- arrive by more than one path, which is the same mechanism that already handles
-- syndication across sources. Two routes to the same article is redundancy, not
-- duplication in the sheet.

BEGIN;

INSERT INTO newsletter_senders (source_slug, from_pattern, subject_like, note) VALUES
  ('reneweconomy',   '%@reneweconomy.com.au', NULL,
   'Backstop for a healthy scraped source: the daily newsletter records what the index page rolls off between fetches'),
  ('conversation-au', '%@theconversation.com', NULL,
   'Backstop for a healthy scraped source. The registry entry filters to five categories; the newsletters subscribed to are broader, so relevance scoring does the narrowing')
ON CONFLICT (source_slug, from_pattern) DO NOTHING;

COMMIT;
