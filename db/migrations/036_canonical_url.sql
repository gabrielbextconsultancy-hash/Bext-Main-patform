-- 036_canonical_url.sql
--
-- The publisher's own URL, where the one we fetched is a syndication stub.
--
-- Reuters reaches us through a Google News feed whose links are redirect stubs:
-- news.google.com/rss/articles/CBMi... They are not article pages, so no body
-- can be read from them, and the link in the client's email is a redirect
-- rather than reuters.com.
--
-- Deliberately a second column, never a rewrite of url. url is the conflict key
-- that makes every article unique and the ledger key that proves what was sent;
-- mutating it would let a story arrive twice under two names and be sent twice.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS canonical_url text;

CREATE INDEX IF NOT EXISTS articles_syndicated_idx
  ON articles (fetched_at DESC)
  WHERE canonical_url IS NULL AND url LIKE '%news.google.com%';
