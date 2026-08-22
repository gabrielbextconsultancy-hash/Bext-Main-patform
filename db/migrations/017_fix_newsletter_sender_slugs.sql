-- Point the newsletter senders at sources that actually exist.
--
-- 013 registered senders against slugs guessed from the publisher's name rather
-- than read from the registry, and five of the eight matched nothing:
--
--   afr            -> the source is afr-energy
--   reuters        -> the source is reuters-carbon
--   the-australian -> there was no such source at all
--
-- The join is a LEFT JOIN with a catch-all fallback, so nothing would have
-- errored. Every AFR and Reuters newsletter would simply have been filed under
-- 'newsletter — unrecognised sender' and looked, at a glance, like mail from a
-- publisher nobody had registered. Quiet misfiling rather than a failure, which
-- is the class of fault this whole ladder exists to make visible.

BEGIN;

UPDATE newsletter_senders SET source_slug = 'afr-energy'      WHERE source_slug = 'afr';
UPDATE newsletter_senders SET source_slug = 'reuters-carbon'  WHERE source_slug = 'reuters';

-- The Australian is paywalled and was never in the brief's registry, but the
-- client's missing-article list included it. Inactive: there is no page we can
-- usefully fetch, so it exists to own the articles its newsletter delivers.
INSERT INTO sources (slug, name, category, url, method, active, email_authoritative, config)
VALUES (
  'the-australian',
  'The Australian — Mining & Energy',
  'Australian News',
  'https://www.theaustralian.com.au/business/mining-energy',
  'email',
  false,
  true,
  '{"note": "Subscriber wall: the page returns 200 but truncated behind a paywall marker. Articles arrive by newsletter instead. Inactive so the ingest ladder does not try to fetch a page it can never read."}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
