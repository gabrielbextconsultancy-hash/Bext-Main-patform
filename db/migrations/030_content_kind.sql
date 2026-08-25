-- 030_content_kind.sql
--
-- Separates news from a website's standing furniture.
--
-- The link scraper collects whatever a listing page links to, and industry sites
-- link their own scaffolding alongside their stories. Opening every article to
-- read its date exposed how much: AEMO contributed "Markets portal help", an
-- XML standards page and a scholarship; regulators contributed "Renewable
-- Energy Zones", "Gas Retail Markets" and "Equipment Energy Efficiency (E3)
-- Program". Those are real pages about real subjects — they score well and they
-- are on topic — but they are not news of any particular day, and a daily
-- briefing that carries them looks broken.
--
-- Having no publication date is the tell, but not proof: Clean Energy Council
-- and NABERS publish genuine articles with no date in their metadata either. The
-- distinction is editorial rather than mechanical, which is why it is judged by
-- the model rather than by a regex — and why the verdict is stored, so a page is
-- judged once and the reasoning stays inspectable.
CREATE TYPE article_content_kind AS ENUM ('unknown', 'news', 'reference');

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS content_kind article_content_kind NOT NULL DEFAULT 'unknown';

-- Anything carrying a real publication date is news by construction: a standing
-- reference page does not declare the day it was published.
UPDATE articles SET content_kind = 'news' WHERE published_at IS NOT NULL;

-- The classifier reads only what is still undecided.
CREATE INDEX IF NOT EXISTS articles_content_kind_unknown_idx
  ON articles (fetched_at DESC) WHERE content_kind = 'unknown';
