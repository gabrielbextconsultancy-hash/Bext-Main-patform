-- 034_offtopic_kind.sql
--
-- A third verdict for the judge. It had two buckets - news or reference - so
-- when AFR lifestyle pieces (watch collecting, food festivals) were rightly
-- kept out of the sheet, they wore the only not-news label available:
-- "standing reference page", which they are not. The outcome was correct and
-- the label lied. 'offtopic' says what such a page is: a real article that is
-- not industry news of any day.
ALTER TYPE article_content_kind ADD VALUE IF NOT EXISTS 'offtopic';
