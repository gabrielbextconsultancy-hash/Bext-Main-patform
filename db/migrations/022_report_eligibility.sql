-- Separate "we have this article" from "this article is today's news".
--
-- Scraped listing pages rarely carry a date, so those articles arrive with
-- published_at NULL and the report falls back to fetched_at — reading as
-- published today. That is a fair assumption while a source trickles, and wrong
-- the moment a backlog arrives at once.
--
-- It did, on 23 Aug 2026. Repairing two link-scorer faults unlocked forty Clean
-- Energy Council articles in one run, among them "Australian rooftop solar breaks
-- new ground in 2022" and a 2023 scholarship announcement. Undated, all of them
-- would have gone to the client the next morning as current news.
--
-- Fetching each article page recovered a real date for only 31 of 130; most
-- government pages publish none. So eligibility is recorded explicitly rather
-- than inferred from a date that does not exist. The articles are kept — they are
-- legitimate content for search and for context — they are simply not presented
-- as news of the day.

BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS report_eligible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN articles.report_eligible IS
  'False for archive material discovered in bulk rather than published today. '
  'The daily sheet filters on this; search and analysis do not.';

-- The 23 Aug unlock. Scoped to that run's window and to undated articles only:
-- anything that arrived with a real publication date is judged on the date, and
-- anything dated within the window stays eligible.
UPDATE articles a
   SET report_eligible = false
  FROM sources s
 WHERE s.id = a.source_id
   AND a.published_at IS NULL
   AND a.fetched_at > now() - interval '4 hours'
   AND s.slug IN ('cec', 'dcceew', 'aer-news', 'veu-news')
   AND a.report_eligible;

-- Backlog is a per-source burst, so record what was set aside and why.
CREATE INDEX IF NOT EXISTS articles_report_eligible_idx
  ON articles (report_eligible) WHERE NOT report_eligible;

COMMIT;
