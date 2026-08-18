-- 011 — Channel announcement for the meeting record.
--
-- 009 stores paths, deliberately: a path is what a person needs when asking where
-- their minutes went. The Teams card needs webUrls, which are a different thing
-- and expensive to re-derive — resolving one means a site lookup, a drive lookup
-- and an item lookup per file. So both are kept.
--
-- posted_at doubles as the answer to "did the channel ever hear about this
-- meeting", which is why no 'posted' value is added to minutes_status: the record
-- is complete whether or not the announcement landed, and ALTER TYPE ... ADD VALUE
-- is irreversible.

ALTER TABLE meeting_minutes
  ADD COLUMN IF NOT EXISTS folder_url     text,        -- the per-meeting channel folder
  ADD COLUMN IF NOT EXISTS minutes_url    text,
  ADD COLUMN IF NOT EXISTS summary_url    text,
  ADD COLUMN IF NOT EXISTS transcript_url text,
  ADD COLUMN IF NOT EXISTS posted_at      timestamptz, -- when the Teams card was accepted
  ADD COLUMN IF NOT EXISTS post_error     text;        -- non-fatal: the record still stands

COMMENT ON COLUMN meeting_minutes.folder_url IS
  'Channel folder webUrl. Also feeds the dashboard meeting view.';
COMMENT ON COLUMN meeting_minutes.post_error IS
  'Set when the Teams webhook rejected the card. Never sets status to failed.';
