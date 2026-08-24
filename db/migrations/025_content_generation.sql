-- Content generation: a fortnight of industry news, turned into one LinkedIn post.
--
-- Engagement A already fetches from 68 sources, scores every article, and ships a
-- 05:00 sheet. That editorial judgement is thrown away after one read. Here it
-- becomes the raw material for LinkedIn.
--
-- The shape of the cycle, and the reason for every table below:
--
--   1. scan      14 days of viable sources                    -> content_cycles
--   2. rank      three topic options, each with its sources   -> content_topics
--   3. select    a human picks one and adds their perspective -> content_cycles
--   4. draft     two variants, one of them recommended        -> linkedin_drafts
--   5. verify    a source for every material claim            -> content_claims
--   6. approve   minor edits, then a publication-ready copy   -> linkedin_drafts.final_copy
--   7. publish   manually, by a human                         -> linkedin_drafts.published_at
--   8. record    what it did after publishing                 -> linkedin_performance
--
-- Steps 1, 2, 4 and 5 are machine work. Steps 3, 6 and 7 are the client's, and
-- the whole design is bent around keeping those three to five or ten minutes a
-- fortnight: one selection, one paragraph of human perspective, one approval.
--
-- Nothing here publishes on its own. `published_at` is written by a human
-- confirming they posted it, not by a workflow.
--
-- Named per-platform (linkedin_*) where the shape is LinkedIn's, because the next
-- platform will not share its character limits, hook cutoff or formulas. The
-- cycle and the topics are platform-neutral and named accordingly.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- The cycle
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE content_cycle_status AS ENUM (
    'queued_topics',  -- waiting for the scanner
    'scanning',
    'topics_ready',   -- three options on the table, waiting for a human
    'queued_drafts',  -- a topic was selected, waiting for the drafter
    'drafting',
    'drafts_ready',   -- two variants, waiting for approval
    'approved',       -- final copy signed off, ready to publish
    'published',
    'failed',
    'abandoned'       -- a human closed it without publishing
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS content_cycles (
  id                bigserial PRIMARY KEY,
  -- The 14-day window of source material. Stored rather than derived, so a cycle
  -- opened late still reports the window it actually read.
  window_start      date        NOT NULL,
  window_end        date        NOT NULL,
  -- Which daily reports the human was looking at when they started this. Empty
  -- for a scheduled cycle, which reads the whole window.
  report_ids        int[]       NOT NULL DEFAULT '{}',
  -- 'schedule' for the fortnightly cron, 'manual' when a human pressed the button
  -- on a specific daily report.
  trigger           text        NOT NULL DEFAULT 'manual' CHECK (trigger IN ('schedule', 'manual')),
  requested_by      text,
  status            content_cycle_status NOT NULL DEFAULT 'queued_topics',
  -- Set when a human picks one of the three options. The drafter reads this and
  -- refuses to run without it.
  selected_topic_id bigint,
  -- The one thing the machine cannot supply: what BEXT actually thinks about it.
  -- The brief allows five to ten minutes a fortnight, and this paragraph is where
  -- most of it should go.
  human_perspective text,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  topics_at         timestamptz,
  selected_at       timestamptz,
  drafts_at         timestamptz,
  published_at      timestamptz,
  CHECK (window_end >= window_start)
);

-- The two claim queries, one per workflow.
CREATE INDEX IF NOT EXISTS content_cycles_queued_topics_idx
  ON content_cycles (created_at) WHERE status = 'queued_topics';
CREATE INDEX IF NOT EXISTS content_cycles_queued_drafts_idx
  ON content_cycles (selected_at) WHERE status = 'queued_drafts';
CREATE INDEX IF NOT EXISTS content_cycles_recent_idx
  ON content_cycles (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Three ranked topic options, each with the sources that justify it
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_topics (
  id           bigserial PRIMARY KEY,
  cycle_id     bigint      NOT NULL REFERENCES content_cycles(id) ON DELETE CASCADE,
  -- 1 is the machine's recommendation. The human is free to take 3.
  rank         smallint    NOT NULL CHECK (rank BETWEEN 1 AND 10),
  title        text        NOT NULL,
  -- Why this is worth BEXT's name being on it, in a sentence or two.
  rationale    text        NOT NULL,
  -- The angle BEXT would take, as distinct from what the articles report.
  angle        text,
  -- The supporting sources. Every claim in the eventual draft must trace back
  -- into this set, which is what makes the fact-check record checkable.
  article_ids  bigint[]    NOT NULL DEFAULT '{}',
  -- 0-100, from the same relevance scale the daily report already uses, so the
  -- two rankings are comparable rather than two different opinions of "good".
  score        int         CHECK (score BETWEEN 0 AND 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, rank)
);

CREATE INDEX IF NOT EXISTS content_topics_cycle_idx ON content_topics (cycle_id, rank);

ALTER TABLE content_cycles
  DROP CONSTRAINT IF EXISTS content_cycles_selected_topic_fk;
ALTER TABLE content_cycles
  ADD CONSTRAINT content_cycles_selected_topic_fk
  FOREIGN KEY (selected_topic_id) REFERENCES content_topics(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Two LinkedIn-ready variants, one of them recommended
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE linkedin_draft_status AS ENUM (
    'draft',      -- the machine wrote it, nobody has looked
    'approved',   -- a human signed off the final copy
    'published',  -- a human posted it and said so
    'rejected',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS linkedin_drafts (
  id             bigserial PRIMARY KEY,
  cycle_id       bigint      NOT NULL REFERENCES content_cycles(id) ON DELETE CASCADE,
  topic_id       bigint      REFERENCES content_topics(id) ON DELETE SET NULL,
  -- 'A' and 'B'. Two, not five: the brief asks for a choice, not a shortlist to
  -- work through.
  variant        text        NOT NULL CHECK (variant IN ('A', 'B')),
  -- Exactly one variant per cycle carries this. Enforced by the partial unique
  -- index below, because "the recommended one" is useless if there are two.
  recommended    boolean     NOT NULL DEFAULT false,
  -- F1-F20 from n8n/lib/linkedin/formulas.js, and the reaction it is written to
  -- earn. Stored so the drafts page can say why B differs from A, and so the
  -- next cycle can avoid repeating a shape.
  formula        text        NOT NULL,
  goal           text        NOT NULL CHECK (goal IN ('comments', 'reposts', 'likes', 'saves')),
  -- The first 210 characters decide whether anyone reads the rest, so the hook is
  -- its own column rather than a substring computed at render time.
  hook           text        NOT NULL,
  body           text        NOT NULL,
  char_count     int         NOT NULL DEFAULT 0,
  hashtags       text[]      NOT NULL DEFAULT '{}',
  -- What image or graphic should run with it, described well enough for a
  -- designer or an image model to act on. Not generated here.
  visual_concept text,
  -- Restrained by instruction: an invitation, not a pitch.
  cta            text,
  -- Where a reader who wants more should land. Goes in the first comment, never
  -- in the body: an in-body link costs 40-60% of reach.
  destination_url text,
  -- { blockers: [...], warnings: [...] } from n8n/lib/linkedin/audit.js. Rides
  -- with the row rather than blocking the insert. The reviewer decides whether a
  -- blocker matters, and a draft nobody can see cannot be fixed.
  audit          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         linkedin_draft_status NOT NULL DEFAULT 'draft',
  -- What the human approved, after their edits. Kept separate from `body` so the
  -- machine's output and the published text stay distinguishable: without that,
  -- there is no way to tell whether the drafting is getting better.
  final_copy     text,
  approved_at    timestamptz,
  approved_by    text,
  -- Last time the publish cron announced this approved-and-due post to Teams. In
  -- manual mode the row stays 'approved' after the nudge, so without this it
  -- would be announced every 15 minutes. Guards it to once a day.
  nudged_at      timestamptz,
  -- Written when a human confirms they posted it. No workflow sets this.
  published_at   timestamptz,
  post_url       text,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, variant)
);

CREATE UNIQUE INDEX IF NOT EXISTS linkedin_drafts_one_recommended_idx
  ON linkedin_drafts (cycle_id) WHERE recommended;

CREATE INDEX IF NOT EXISTS linkedin_drafts_status_idx ON linkedin_drafts (status, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- The fact-check record: a source for every material claim
-- ─────────────────────────────────────────────────────────────────────────────

-- This is the part that makes the rest publishable. A model asked to write about
-- a rebate will produce a figure whether or not one was in the source, and the
-- figure will look exactly as confident either way. So every material claim is
-- extracted and matched back to an article, and anything that cannot be matched
-- is marked and shown to the reviewer rather than quietly shipped.
CREATE TABLE IF NOT EXISTS content_claims (
  id           bigserial PRIMARY KEY,
  draft_id     bigint      NOT NULL REFERENCES linkedin_drafts(id) ON DELETE CASCADE,
  -- The claim as it appears in the draft, so the reviewer can find it.
  claim        text        NOT NULL,
  article_id   bigint      REFERENCES articles(id) ON DELETE SET NULL,
  source_url   text,
  -- The sentence in the source that carries it. Present for 'supported', absent
  -- for everything else.
  source_quote text,
  verdict      text        NOT NULL DEFAULT 'needs_check'
                           CHECK (verdict IN ('supported', 'unsupported', 'needs_check')),
  note         text,
  checked_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_claims_draft_idx ON content_claims (draft_id, verdict);

-- ─────────────────────────────────────────────────────────────────────────────
-- The performance register, filled in after publishing
-- ─────────────────────────────────────────────────────────────────────────────

-- Entered by hand, because manual publishing means there is no API response to
-- read the numbers from. One row per observation, not one per post, so a post can
-- be checked at 24 hours and again at a fortnight and the trend survives.
CREATE TABLE IF NOT EXISTS linkedin_performance (
  id          bigserial PRIMARY KEY,
  draft_id    bigint      NOT NULL REFERENCES linkedin_drafts(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  impressions int,
  reactions   int,
  comments    int,
  reposts     int,
  clicks      int,
  followers   int,
  -- What actually happened, in a sentence. The number that matters is usually not
  -- one of the columns above.
  notes       text,
  recorded_by text
);

CREATE INDEX IF NOT EXISTS linkedin_performance_draft_idx
  ON linkedin_performance (draft_id, observed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Voice: one row, read by every drafting node
-- ─────────────────────────────────────────────────────────────────────────────

-- Single row by construction. The upstream skills keep this in a markdown file
-- each tool re-reads; here both n8n and the dashboard need it, and two copies
-- drift.
CREATE TABLE IF NOT EXISTS linkedin_voice (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Who is speaking. Left deliberately open until the client confirms whether
  -- posts go out as Brent or as the BEXT page: the two need different voices.
  author        text        NOT NULL DEFAULT 'BEXT Consultancy',
  audience      text        NOT NULL,
  fingerprint   text        NOT NULL,
  pillars       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Rules the scrubber enforces on top of the built-in ones, so the client can
  -- ban a phrase without a deploy.
  banned_terms  text[]      NOT NULL DEFAULT '{}',
  always_rules  text[]      NOT NULL DEFAULT '{}',
  never_rules   text[]      NOT NULL DEFAULT '{}',
  cta_style     text,
  -- Local times, applied in Australia/Melbourne when a slot is suggested.
  post_windows  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO linkedin_voice (
  id, author, audience, fingerprint, pillars, always_rules, never_rules, cta_style, post_windows
) VALUES (
  1,
  'BEXT Consultancy',
  'Commercial property owners, facility and asset managers, developers, government '
  'organisations and institutional portfolios in Australia. Victoria first.',
  'Plain, specific, unhurried. Short sentences carrying one fact each. A number or a '
  'named scheme in every paragraph. No throat-clearing, no exclamation marks, no hype '
  'verbs. Reads like a consultant explaining something to a client who is paying '
  'attention.',
  '["Solar and PV", "Building performance and compliance", "Victorian schemes", "What this costs a building owner"]'::jsonb,
  ARRAY[
    'One concrete number or named scheme per post, traceable to a source article',
    'Name the source and the date a change takes effect',
    'Say what a building owner should do about it',
    'End on a real question, not a prompt'
  ],
  ARRAY[
    'No em dashes',
    'No engagement bait',
    'Nothing that reads as financial or legal advice',
    'Never state a rebate figure, eligibility rule or deadline the source article does not carry'
  ],
  'Restrained. An invitation, not a pitch. The link goes in the first comment, never in the body.',
  '[{"day": 2, "from": "07:30", "to": "09:00"},
    {"day": 3, "from": "07:30", "to": "09:00"},
    {"day": 4, "from": "07:30", "to": "09:00"}]'::jsonb
) ON CONFLICT (id) DO NOTHING;

COMMIT;
