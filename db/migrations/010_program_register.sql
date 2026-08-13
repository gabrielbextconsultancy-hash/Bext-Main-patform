-- 010 — The program register: one record per fact, rendered into every document.
--
-- The minutes, the Excel actions register and the summary email are three views
-- of the same data. Holding that data once is what stops them disagreeing, and
-- it is the brief's "capture once" outcome expressed in a schema.
--
-- It also carries state between meetings. The check-in is weekly and covers the
-- same projects, so the model is never asked to invent the project list: it is
-- given last week's rows and asked what changed. Actions likewise persist until
-- closed rather than being re-extracted from scratch each week.

-- ── Programs ────────────────────────────────────────────────────────────────
-- A recurring meeting series. "RACV Property Electrification — Weekly Program
-- Check-in" is one program; a second client would be another.
CREATE TABLE programs (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,           -- fills {program}
  client        text NOT NULL,
  venue         text NOT NULL DEFAULT 'Microsoft Teams',
  minutes_by    text,                    -- fills {minutes_by}
  -- Increments per meeting, filling {meeting_no}. Held here rather than counted
  -- from the meetings table so a meeting minuted late cannot renumber the rest.
  last_meeting_no int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── People ──────────────────────────────────────────────────────────────────
-- A transcript gives a display name and nothing else. The template wants
-- initials, company and email, so they are held per program and looked up.
-- Without this the email column could only ever be guessed.
CREATE TABLE participants (
  id            serial PRIMARY KEY,
  program_id    int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name          text NOT NULL,
  initials      text,
  company       text,
  email         text,
  -- Names in a Teams transcript vary — "Brent Craig", "Brent", "Craig, Brent".
  -- Alternates are matched against before a new person is invented.
  aliases       text[] NOT NULL DEFAULT '{}',
  regular       boolean NOT NULL DEFAULT true,
  UNIQUE (program_id, name)
);

-- ── Projects ────────────────────────────────────────────────────────────────
-- The Project Status table, carried forward week to week. Each row is the
-- current state; the meeting updates it.
CREATE TYPE project_status AS ENUM
  ('On Track', 'Monitor', 'At Risk', 'On Hold', 'Complete');

CREATE TABLE program_projects (
  id            serial PRIMARY KEY,
  program_id    int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name          text NOT NULL,                    -- "Noosa – PV"
  phase         text,                             -- Delivery, Design, Quoting
  status        project_status NOT NULL DEFAULT 'On Track',
  latest_update text,                             -- {update}
  next_action   text,
  owner         text,
  due           text,       -- free text: "End of week", "26/08 shutdown"
  -- The template writes the DNSP line inside the update cell. Kept separate so
  -- it can be maintained across weeks rather than re-typed into prose.
  network_note  text,
  sort_order    int NOT NULL DEFAULT 0,
  closed        boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, name)
);

-- ── Actions ─────────────────────────────────────────────────────────────────
-- The Excel register is the master view of this table. The Action Register in
-- the minutes is the same rows filtered to the meeting that touched them.
--
-- Status is stored as the register's own vocabulary, Open/Closed. The minutes
-- render "Done" for Closed — the two documents already word it differently and
-- both should keep reading as they do, from one stored value.
CREATE TYPE action_status AS ENUM ('Open', 'Closed');

CREATE TABLE actions (
  id            bigserial PRIMARY KEY,
  program_id    int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  project_id    int REFERENCES program_projects(id) ON DELETE SET NULL,

  -- Numbering restarts per project, as the supplied register does: both
  -- RACV_Noosa BESS and RACV_Cobram BESS begin at 1.
  project_label text NOT NULL,
  number        int NOT NULL,

  title         text NOT NULL,           -- "Noosa – PV (DNSP)"
  detail        text,
  owner         text,                    -- "Brent Craig (BC)"
  company       text,
  allocated_on  date,
  due           date,
  completed_on  date,
  status        action_status NOT NULL DEFAULT 'Open',
  comments      text,

  -- Which meeting raised it, and which last touched it. An action that stops
  -- being mentioned is not closed — it is stale, and that distinction is the
  -- point of keeping both.
  raised_in     text,
  last_seen_in  text,

  -- Set when the extractor matched this to an existing action by title rather
  -- than exactly. Surfaced for review instead of applied silently: an action
  -- wrongly marked complete is worse than a duplicate.
  match_uncertain boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, project_label, number)
);

CREATE INDEX actions_open_idx ON actions (program_id, status) WHERE status = 'Open';
CREATE INDEX actions_due_idx  ON actions (due) WHERE status = 'Open';

-- ── Link meetings to programs ───────────────────────────────────────────────
ALTER TABLE meeting_minutes
  ADD COLUMN program_id int REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN meeting_no int,
  -- Transcripts now also arrive as files dropped in SharePoint rather than only
  -- from meetings on BEXT's own calendar, and those have no Graph meeting id.
  ADD COLUMN source     text NOT NULL DEFAULT 'calendar';

-- meeting_id is the Graph id, which a dropped file does not have. Uniqueness
-- has to allow many NULLs while still preventing the calendar path from
-- minuting the same meeting twice — a partial index does both, where the
-- original UNIQUE constraint could not.
ALTER TABLE meeting_minutes DROP CONSTRAINT meeting_minutes_meeting_id_key;
CREATE UNIQUE INDEX meeting_minutes_meeting_id_idx
  ON meeting_minutes (meeting_id) WHERE meeting_id IS NOT NULL;

-- ── Seed the one program that exists ────────────────────────────────────────
INSERT INTO programs (slug, name, client, minutes_by) VALUES
  ('racv-electrification',
   'RACV Property Electrification — Weekly Program Check-in',
   'RACV', 'David Coulthard')
ON CONFLICT (slug) DO NOTHING;
