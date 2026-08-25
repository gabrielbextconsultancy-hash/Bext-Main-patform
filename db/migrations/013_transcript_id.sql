-- 013 — dedupe meetings by transcript, not by meeting
--
-- A RECURRING Teams meeting reuses one meetingId for every occurrence. The
-- 25 Aug weekly carried byte-for-byte the same meetingId as the 18 Aug one:
--
--   MSoyYTg4…OTk6bWVldGluZ19OMlptTXpRelpUUXRNbVk0…QHRocmVhZC52Mg
--
-- Discovery excluded anything already in meeting_minutes keyed on meeting_id,
-- so occurrence 2 looked done and was skipped — permanently, not merely
-- delayed. Every weekly after the first would have vanished with the workflow
-- reporting success, because a skipped candidate is not an error.
--
-- transcriptId IS unique per occurrence (it carries the occurrence timestamp:
-- …-1787022989-TranscriptV2 vs …-1787626860-TranscriptV2), so it becomes the
-- identity. meeting_id stays as a plain column — it is now what GROUPS a
-- recurring series, which is the useful thing to have it for.

ALTER TABLE meeting_minutes
  ADD COLUMN IF NOT EXISTS transcript_id text;

COMMENT ON COLUMN meeting_minutes.transcript_id IS
  'Graph transcript id — unique per meeting OCCURRENCE. The dedupe key. Null for '
  'transcripts dropped in as files, which have no Graph id.';
COMMENT ON COLUMN meeting_minutes.meeting_id IS
  'Graph onlineMeeting id. NOT unique: a recurring series shares one across every '
  'occurrence. Groups a series; see transcript_id for identity.';

-- The old unique index is exactly the bug. Demote it to a plain index so the
-- series lookup stays fast without forbidding a second occurrence.
DROP INDEX IF EXISTS meeting_minutes_meeting_id_idx;
CREATE INDEX IF NOT EXISTS meeting_minutes_meeting_id_idx
  ON meeting_minutes (meeting_id);

-- Partial, for the same reason 010 made the old one partial: a dropped file has
-- no Graph id, and many rows may legitimately carry null. ON CONFLICT must
-- repeat this predicate or Postgres will not infer the index.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_minutes_transcript_id_idx
  ON meeting_minutes (transcript_id) WHERE transcript_id IS NOT NULL;
