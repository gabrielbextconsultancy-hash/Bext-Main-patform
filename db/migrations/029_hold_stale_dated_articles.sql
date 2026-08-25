-- 029_hold_stale_dated_articles.sql
--
-- Holds articles that turned out to be old once their real date was read.
--
-- Until the pipeline opened article pages it had no publication date for most
-- scraped sources, so archive material was dated by when we happened to fetch it
-- and read as today's news. Resolving the real dates exposed 484 articles older
-- than the fourteen-day freshness window — including 34 published in 2023, 2024
-- and 2025 that had been sitting in the corpus looking current.
--
-- The report window already excludes them: it runs on
-- coalesce(published_at, fetched_at), so a correctly-dated 2024 article falls
-- outside it. This is the second lock. report_eligible is the flag the sheet has
-- always honoured, and setting it means the article cannot resurface if the
-- window is ever widened or a catch-up sweep reaches further back — which is
-- exactly how forty Clean Energy Council articles from 2022 became eligible once
-- before (migration 022).
--
-- Nothing already delivered is retracted; report_items keeps that record, and an
-- article the client has read stays read.
UPDATE articles
   SET report_eligible = false
 WHERE published_at IS NOT NULL
   AND published_at < now() - interval '14 days'
   AND report_eligible;
