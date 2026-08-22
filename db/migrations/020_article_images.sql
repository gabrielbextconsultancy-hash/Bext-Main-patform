-- Article artwork, for the card layout of the daily sheet.
--
-- Publishers already declare a lead image in their Open Graph tags, which is the
-- picture that appears when a link is shared. Using that means the sheet shows
-- the publisher's own artwork for the story rather than a stock photograph or
-- something generated — a fabricated image beside a real headline reads as though
-- it depicts the event, which for a news brief is worse than no image at all.
--
-- image_state records what happened, so a missing picture is explicable rather
-- than mysterious: some sites publish no og:image, and some articles are behind
-- a wall we cannot read.

BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url text;

DO $$ BEGIN
  CREATE TYPE article_image_state AS ENUM (
    'pending',    -- not looked for yet
    'found',      -- the publisher declared one
    'none',       -- page read, no og:image present
    'blocked'     -- the article page could not be fetched
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_state article_image_state NOT NULL DEFAULT 'pending';

-- Images are only looked up for the handful of articles that reach the sheet, so
-- this index serves "which of today's selected items still need one".
CREATE INDEX IF NOT EXISTS articles_image_pending_idx
  ON articles (image_state) WHERE image_state = 'pending';

COMMIT;
