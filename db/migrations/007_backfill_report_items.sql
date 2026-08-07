-- 007_backfill_report_items.sql
--
-- The Daily Report workflow recorded how many articles it sent but never which
-- ones, so report_items was empty and there was no record of what the client
-- actually received. The workflow now writes it; this recovers the two reports
-- already delivered.
--
-- The stored HTML is the only evidence of what went out, and it contains each
-- article's URL, so the links are matched back to articles. Rank is left at the
-- order the links appear, which is the order they were read in.

BEGIN;

WITH links AS (
  SELECT r.id AS report_id,
         m[1] AS url,
         row_number() OVER (PARTITION BY r.id) AS rank
  FROM reports r,
       LATERAL regexp_matches(r.html, '<a[^>]+href="(https?://[^"]+)"', 'g') AS m
  WHERE r.status = 'sent'
)
INSERT INTO report_items (report_id, article_id, category, rank, blurb)
SELECT l.report_id,
       a.id,
       s.category,
       l.rank::int,
       left(coalesce(an.summary, ''), 500)
FROM links l
JOIN articles a           ON a.url = l.url
JOIN sources s            ON s.id = a.source_id
LEFT JOIN article_analysis an ON an.article_id = a.id
ON CONFLICT (report_id, article_id) DO NOTHING;

COMMIT;
