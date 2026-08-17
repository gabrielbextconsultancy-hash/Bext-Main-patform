-- 009_gov_via_google_news.sql
--
-- Nine government sources sit behind GovCMS/Akamai, which tarpits our VPS: TCP
-- and TLS complete, then no HTTP response ever arrives. Proven geographic, not
-- IP reputation — a probe from a US datacenter (GitHub Actions) was refused on
-- all nine while a non-gov control answered normally. The VPS is in Kuala
-- Lumpur and Hostinger has no Australian region, so no reachable proxy exists
-- inside the current hosting.
--
-- Google News indexes the same content and is not geo-fenced. Measured from
-- inside bext-fetcher over a 14-day window:
--
--     aer.gov.au 33 | industry.gov.au 25 | minister.dcceew.gov.au 22
--     climatechangeauthority.gov.au 4 | energy.gov.au 2
--     energyrating.gov.au 1 | nabers.gov.au 1 | cbd.gov.au 0
--
-- The full ingest path was run against these feeds before this migration:
-- parseFeed -> normalise -> freshness gave 31, 21 and 1 usable items with real
-- publication dates.
--
-- Two consequences, both accepted deliberately:
--
--   * Article links are news.google.com redirect stubs. The destination is an
--     opaque server-side token — decoding five of them recovered no URL — so we
--     cannot store the real gov.au address. This does not affect the reader:
--     the recipient is in Australia, so the stub redirects and loads normally.
--     Only our server is blocked, not Brent.
--
--   * Path filters are cleared. They matched on gov.au URL paths, which the
--     stub URLs do not contain, so leaving them in place would reject every
--     item exactly as the arena-knowledge filter did in migration 008.
--
-- aer-registers is deactivated rather than repointed: `site:` with a path
-- returns far less than the bare domain (6 against 33), and the bare aer.gov.au
-- feed already carries the register and network-exemption notices. Splitting
-- them would recreate the shared-feed starvation that 008 fixed.

BEGIN;

UPDATE sources SET
  method = 'rss',
  config = (config - 'filter' - 'requires_browser')
           || jsonb_build_object('feed_url', feed, 'via', 'google-news'),
  active = true,
  last_status = 'never_run',
  last_error = NULL,
  consecutive_failures = 0,
  updated_at = now()
FROM (VALUES
  ('aer-news',           'https://news.google.com/rss/search?q=site:aer.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('cca',                'https://news.google.com/rss/search?q=site:climatechangeauthority.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('disr',               'https://news.google.com/rss/search?q=site:industry.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('energy-gov-au',      'https://news.google.com/rss/search?q=site:energy.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('energy-rating-gems', 'https://news.google.com/rss/search?q=site:energyrating.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('minister-bowen',     'https://news.google.com/rss/search?q=site:minister.dcceew.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  ('nabers',             'https://news.google.com/rss/search?q=site:nabers.gov.au+when:14d&hl=en-AU&gl=AU&ceid=AU:en'),
  -- cbd.gov.au returns nothing under a site: query even at 30 days; it
  -- publishes very rarely. A name query is the only thing that yields anything.
  ('cbd',                'https://news.google.com/rss/search?q=%22Commercial+Building+Disclosure%22+Australia+when:30d&hl=en-AU&gl=AU&ceid=AU:en')
) AS v(target_slug, feed)
WHERE sources.slug = v.target_slug;

UPDATE sources SET
  active = false,
  config = config || jsonb_build_object(
    'note', 'Deactivated: aer.gov.au is unreachable from this VPS and its register notices now arrive through aer-news via Google News. A separate path-scoped query returned 6 items against 33 for the bare domain.'),
  updated_at = now()
WHERE slug = 'aer-registers';

COMMIT;
