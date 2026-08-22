-- What was tried, in what order, and which route actually delivered.
--
-- `sources.last_status` records only the verdict. It cannot distinguish a source
-- that answered on the first request from one limping in on the model at the last
-- tier, and it cannot say which routes were even attempted. That
-- indistinguishability is the failure this whole exercise is about: DCCEEW
-- reported 'ok' for weeks while returning nothing, and the registry carried a
-- note calling it unfixable, because nothing recorded what had actually happened.
--
-- One row per source, per tier, per run.

BEGIN;

DO $$ BEGIN
  CREATE TYPE fetch_tier_outcome AS ENUM (
    'success',   -- this tier produced articles; later tiers were skipped
    'empty',     -- retrieved, parsed, nothing found — escalate
    'refused',   -- 401/403/404, the server declined — escalate
    'error',     -- transport or code failure — escalate
    'skipped'    -- never attempted, because an earlier tier had already won
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS fetch_attempts (
  id             bigserial PRIMARY KEY,
  source_id      integer NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  run_at         timestamptz NOT NULL DEFAULT now(),
  -- 0 email · 1 direct (TLS impersonation) · 2 browser · 3 authenticated browser
  -- · 4 model extraction. Stored as a number so ordering is the escalation order.
  tier           smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),
  outcome        fetch_tier_outcome NOT NULL,
  articles_found integer NOT NULL DEFAULT 0,
  detail         text,
  duration_ms    integer
);

-- The dashboard reads the most recent run per source, so this is the access path.
CREATE INDEX IF NOT EXISTS fetch_attempts_source_run_idx
  ON fetch_attempts (source_id, run_at DESC);
CREATE INDEX IF NOT EXISTS fetch_attempts_run_idx
  ON fetch_attempts (run_at DESC);

-- Current state, denormalised onto sources so the common dashboard query does not
-- have to aggregate the log. NULL means no tier succeeded on the last run —
-- distinct from "never tried", which is last_fetch_at IS NULL.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS satisfied_by_tier smallint;

-- Whether a newsletter is sufficient on its own for this source.
--
-- True only where scraping cannot work — the four account walls. Elsewhere the
-- newsletter is additive: a daily newsletter carries a fraction of what a
-- publisher ran, so treating it as sufficient for a scrapeable source would cut
-- RenewEconomy from roughly twenty items to five. Defaulting to false keeps the
-- expensive-but-complete route as the norm.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS email_authoritative boolean NOT NULL DEFAULT false;

UPDATE sources SET email_authoritative = true
 WHERE slug IN ('reuters-carbon', 'iea', 'iea-energy-efficiency', 'afr-energy');

COMMIT;
