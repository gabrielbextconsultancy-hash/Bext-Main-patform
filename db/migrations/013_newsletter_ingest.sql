-- Newsletter ingestion: the route for sources that no fetcher can reach.
--
-- Four sources in the brief cannot be scraped, and no amount of better fetching
-- changes that. Measured 22 Aug 2026, after TLS impersonation fixed everything
-- that was merely blocked:
--
--   AFR             200 but truncated — "already a subscriber"   paywall
--   The Australian  200 but truncated                            paywall
--   Reuters         401                                          refused
--   IEA             403, to plain HTTP and to headless Chromium  refused
--
-- All four publish a free email newsletter carrying the same headlines. So the
-- articles arrive by mail instead, into gabriel.bextconsultancy@gmail.com, and
-- are parsed into the same articles table the scrapers feed. A newsletter is
-- just another source with a different transport.

BEGIN;

-- Enum values cannot be added inside a transaction that then uses them, but the
-- value itself commits fine; the table below refers to sources by id, not method.
ALTER TYPE ingest_method ADD VALUE IF NOT EXISTS 'email';

COMMIT;

BEGIN;

-- Which sending address belongs to which source. A publisher sends from several
-- addresses over time (afr.com uses both @afr.com and @nine.com.au), so this is
-- many-to-one and matched by pattern rather than equality.
CREATE TABLE IF NOT EXISTS newsletter_senders (
  id            serial PRIMARY KEY,
  source_slug   text NOT NULL,
  -- Matched with ILIKE against the From header, so '%@afr.com' covers the domain.
  from_pattern  text NOT NULL,
  -- Optional subject filter, for publishers whose one address sends several
  -- newsletters and only one of them is about energy.
  subject_like  text,
  active        boolean NOT NULL DEFAULT true,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_slug, from_pattern)
);

-- Every message we have already turned into articles. Without this a re-poll of
-- the mailbox re-imports the same newsletter, and the daily sheet doubles up.
CREATE TABLE IF NOT EXISTS newsletter_messages (
  id            serial PRIMARY KEY,
  message_id    text NOT NULL UNIQUE,   -- RFC 5322 Message-ID, the only stable key
  source_slug   text,
  from_address  text,
  subject       text,
  received_at   timestamptz,
  links_found   integer NOT NULL DEFAULT 0,
  articles_kept integer NOT NULL DEFAULT 0,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletter_messages_received_idx
  ON newsletter_messages (received_at DESC);

-- The senders for the four unreachable sources. Patterns are deliberately broad:
-- a newsletter that silently stops matching is the failure mode that costs weeks,
-- and an over-broad match is caught by the per-source relevance scoring anyway.
INSERT INTO newsletter_senders (source_slug, from_pattern, subject_like, note) VALUES
  ('afr',            '%@afr.com',              NULL, 'Paywalled site; Before the Bell / Energy newsletters carry the headlines'),
  ('afr',            '%@nine.com.au',          NULL, 'AFR mail is sometimes sent from the Nine group domain'),
  ('the-australian', '%@theaustralian.com.au', NULL, 'Paywalled site'),
  ('the-australian', '%@news.com.au',          NULL, 'News Corp group sending domain'),
  ('reuters',        '%@reuters.com',          NULL, 'Site returns 401 to every non-browser client'),
  ('iea',            '%@iea.org',              NULL, 'Site returns 403 to plain HTTP and to headless Chromium alike')
ON CONFLICT (source_slug, from_pattern) DO NOTHING;

COMMIT;
