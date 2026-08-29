-- 032_linkedin_post_at.sql
--
-- The column LinkedIn Publish was designed around and the content migration
-- never created. "Due posts" selects approved drafts whose post_at has come;
-- without the column every 15-minute run died on "column post_at does not
-- exist" and Self-Heal filed it as unclassified ring-3, four times an hour.
--
-- Nullable on purpose: an approved draft with no post_at is parked, not
-- published - nothing goes to LinkedIn until a person sets the time.
ALTER TABLE linkedin_drafts ADD COLUMN IF NOT EXISTS post_at timestamptz;
CREATE INDEX IF NOT EXISTS linkedin_drafts_due_idx
  ON linkedin_drafts (post_at) WHERE status = 'approved' AND post_at IS NOT NULL;
