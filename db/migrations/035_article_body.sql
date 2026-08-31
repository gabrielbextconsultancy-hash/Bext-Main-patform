-- 035_article_body.sql
--
-- The article's own text, not the feed's teaser.
--
-- Until now the scorer read summary_raw: an RSS excerpt averaging 303
-- characters and often ending in "The post ... appeared first on". It judged
-- relevance from a headline and two sentences, and the client's summaries were
-- written from the same scrap. For a source whose every article matters, that
-- is reading the cover and reviewing the book.
--
-- body_state mirrors date_state: a page is read once, a refusal is retried, a
-- genuine absence is not.
CREATE TYPE article_body_state AS ENUM ('pending', 'found', 'none', 'blocked');

ALTER TABLE articles ADD COLUMN IF NOT EXISTS body_text  text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS body_state article_body_state NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS articles_body_pending_idx
  ON articles (fetched_at DESC) WHERE body_state = 'pending';
