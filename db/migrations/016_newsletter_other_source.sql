-- A home for newsletters from senders we have not registered.
--
-- The email tier reads every message that looks like a newsletter, not only the
-- ones whose sender appears in newsletter_senders. That is deliberate: a
-- subscription taken out next month should work immediately, and a publisher
-- quietly changing its sending domain is precisely the failure that goes
-- unnoticed for weeks. But an article needs a source_id, so unrecognised mail
-- needs somewhere to land rather than being dropped.
--
-- Inactive on purpose: the ingest ladder must never try to fetch this, because
-- there is no page to fetch. It exists only as the owner of articles that
-- arrived by post from a sender nobody has claimed yet. Anything accumulating
-- here is a prompt to add a row to newsletter_senders.

BEGIN;

INSERT INTO sources (slug, name, category, url, method, active, config)
VALUES (
  'newsletter-other',
  'Newsletter — unrecognised sender',
  'Australian News',
  'mailto:gabriel.bextconsultancy@gmail.com',
  'email',
  false,
  '{"note": "Catch-all for newsletter mail whose sending address matches no row in newsletter_senders. Not fetchable — articles are posted here by the email tier. If items collect here, register the sender."}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
