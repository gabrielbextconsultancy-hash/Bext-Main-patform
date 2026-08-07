-- 006_purge_archive_backfill.sql
--
-- Index and "most read" panels carry old stories, and the early ingest runs took
-- everything they found. The result is 381 articles published more than 90 days
-- ago sitting in a table whose purpose is a daily news sheet.
--
-- Ingest now rejects dated items older than 14 days, so this only has to clean up
-- what already landed. Undated articles are left alone: without a publication date
-- there is no evidence they are old, and the URL-level dedupe stops them recurring.

BEGIN;

-- Analysis rows go first — article_analysis references articles.
DELETE FROM article_analysis
WHERE article_id IN (
  SELECT id FROM articles
  WHERE published_at IS NOT NULL
    AND published_at < now() - interval '30 days'
);

-- Anything already cited in a delivered report stays, so history keeps matching
-- what was actually sent.
DELETE FROM articles
WHERE published_at IS NOT NULL
  AND published_at < now() - interval '30 days'
  AND id NOT IN (SELECT article_id FROM report_items);

COMMIT;
