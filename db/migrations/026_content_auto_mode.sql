-- Auto mode: run a cycle end to end with no human in the loop.
--
-- The default cycle stops twice for a person (pick a topic, approve a draft),
-- which is what the brief asks for. This flag lets a cycle skip both gates: the
-- ranker's top topic is selected automatically, the recommended draft is approved
-- automatically and scheduled to post now, and LinkedIn Publish sends it. It is
-- opt-in per cycle, so the client-facing default stays human-reviewed while a
-- test (or a later "let it run" mode) can be fully hands-off.
--
-- Publishing still obeys LINKEDIN_PUBLISH_MODE: in manual mode even an auto cycle
-- only produces the finished text and a Teams nudge; it reaches LinkedIn for real
-- only once a posting backend (Publora or the official API) is configured.

BEGIN;

ALTER TABLE content_cycles
  ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN content_cycles.auto IS
  'When true the cycle self-advances through both human gates: top topic selected '
  'automatically, recommended draft approved and scheduled automatically.';

COMMIT;
