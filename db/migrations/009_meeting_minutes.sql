-- 009 — Meeting intake (Brief B, review area 3).
--
-- One row per meeting the workflow has processed. Its first job is idempotence:
-- the workflow polls every fifteen minutes and would otherwise re-transcribe,
-- re-draft and re-file the same meeting on every tick. Its second is evidence —
-- which meeting produced which minutes, and whether the draft was ever sent.

CREATE TYPE minutes_status AS ENUM (
  'transcribed',   -- VTT retrieved and archived
  'drafted',       -- minutes document generated and filed
  'failed'
);

CREATE TABLE meeting_minutes (
  id                bigserial PRIMARY KEY,

  -- Graph's onlineMeeting id. Unique: this is what makes a re-poll a no-op
  -- rather than a duplicate set of minutes.
  meeting_id        text NOT NULL UNIQUE,
  subject           text,
  organiser_upn     text,
  started_at        timestamptz,
  ended_at          timestamptz,
  attendees         text[] NOT NULL DEFAULT '{}',

  status            minutes_status NOT NULL DEFAULT 'transcribed',

  -- SharePoint paths rather than ids: ids change if a file is re-uploaded, and
  -- a path is what a person needs when asking where their minutes went.
  transcript_path   text,
  minutes_path      text,

  -- The Outlook draft. Nothing is ever sent automatically, so this records what
  -- is waiting for review, not what went out.
  draft_message_id  text,

  -- What the model extracted, kept whole. The document is a rendering of this,
  -- and when a set of minutes reads wrongly this is the only way to tell a bad
  -- extraction from a bad template.
  extracted         jsonb,

  model             text,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The workflow's own question on every tick: what has been handled already?
CREATE INDEX meeting_minutes_ended_idx ON meeting_minutes (ended_at DESC);

-- Action items are queried across meetings ("what is outstanding?"), which a
-- jsonb column cannot answer efficiently without this.
CREATE INDEX meeting_minutes_extracted_idx ON meeting_minutes USING gin (extracted);
