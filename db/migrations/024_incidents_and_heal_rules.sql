-- What broke, what we did about it, and whether it worked.
--
-- docs/REGRESSIONS.md and n8n/preflight.js already carry every failure we have
-- paid for, as prose and as a static assertion. Neither is readable at runtime,
-- so the same diagnosis that takes a human ten seconds ("that's R001 again")
-- costs the machine nothing and it does it anyway — by waking someone up.
--
-- This is the third view of the same fact: the rule as data, and a log of every
-- time it fired. Ring 2 of docs/SELF-HEALING.md reads it to decide, and writes
-- to it before it acts, so an action that kills the healer mid-run still leaves
-- a record that it was attempted.
--
-- heal_rules mirrors n8n/lib/heal-rules.js the way `sources` mirrors
-- sources/registry.yaml: the repo is the source of truth and this table is
-- seeded from it. Never hand-edit it.

BEGIN;

DO $$ BEGIN
  -- The allowlist from the approved plan, and nothing else. A class with no
  -- matching action escalates to a human; it does not fall back to something
  -- "close enough".
  CREATE TYPE heal_action AS ENUM (
    'retry_execution',      -- re-run the failed execution unchanged
    'reactivate_workflow',  -- a workflow that deactivated itself
    'redeploy_workflow',    -- push the repo's JSON over the live copy
    'restart_container',    -- bext-* only; see the guard in n8n/self-heal.js
    'refresh_graph_token',  -- expired Microsoft Graph credential
    'flag_source_browser',  -- route a source through the browser fetcher
    'escalate'              -- no automatic action: post to Teams and stop
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incident_outcome AS ENUM (
    'detected',   -- classified, nothing attempted yet
    'attempted',  -- written before the action ran; a crash leaves this behind
    'healed',     -- the action ran and the follow-up check passed
    'failed',     -- the action ran and did not fix it
    'escalated',  -- handed to a human
    'suppressed'  -- rate cap, or the same action already tried on this execution
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per rule, seeded from n8n/lib/heal-rules.js.
CREATE TABLE IF NOT EXISTS heal_rules (
  -- The regression id: R001…Rnnn. Deliberately the SAME id as the check in
  -- n8n/preflight.js and the section in docs/REGRESSIONS.md, so a rule is one
  -- fact with a static view and a runtime view, not two facts that can drift.
  rule_id      text PRIMARY KEY,
  title        text NOT NULL,
  -- Regex matched against the execution's error message.
  signature    text NOT NULL,
  -- Optional narrowing: only match inside this workflow / node.
  workflow     text,
  node         text,
  action       heal_action NOT NULL,
  -- False parks a rule without deleting it — an action we no longer trust stops
  -- firing but keeps its history.
  enabled      boolean NOT NULL DEFAULT true,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id            bigserial PRIMARY KEY,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  workflow      text NOT NULL,
  -- n8n's execution id. Text because the API returns it as a string and
  -- comparing an int to a string silently matches nothing.
  execution_id  text,
  -- NULL means no rule matched — that is the ring 3 queue.
  rule_id       text REFERENCES heal_rules (rule_id) ON DELETE SET NULL,
  signature     text,
  action        heal_action NOT NULL DEFAULT 'escalate',
  outcome       incident_outcome NOT NULL DEFAULT 'detected',
  detail        text,
  -- Set when ring 3 asks a human about an unclassified failure, so the same
  -- unknown failure does not post to Teams every fifteen minutes.
  escalated_at  timestamptz,
  resolved_at   timestamptz
);

-- The healer's hot path: "have I already acted on this execution?" (R016 in
-- spirit — a single failure must not be retried forever) and "how many actions
-- this hour?" for the rate cap.
CREATE INDEX IF NOT EXISTS incidents_execution_idx ON incidents (execution_id);
CREATE INDEX IF NOT EXISTS incidents_detected_idx  ON incidents (detected_at DESC);
CREATE INDEX IF NOT EXISTS incidents_open_idx      ON incidents (workflow, detected_at DESC)
  WHERE resolved_at IS NULL;

-- Where ring 1 resumed from, so a restart does not re-import the whole
-- execution history and re-heal things that were already handled.
CREATE TABLE IF NOT EXISTS heal_watermark (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO heal_watermark (id) VALUES (1) ON CONFLICT DO NOTHING;

COMMIT;
