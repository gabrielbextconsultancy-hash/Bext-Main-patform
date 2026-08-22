-- Match the domains publishers actually send from.
--
-- The first real newsletter proved the patterns wrong. Reuters' sign-up
-- confirmation came from newsletters@email.reuters.com, and the registered
-- pattern was '%@reuters.com', which requires the domain to be literally
-- reuters.com. It does not match a sending subdomain:
--
--   'newsletters@email.reuters.com' ILIKE '%@reuters.com'    -> false
--   'newsletters@email.reuters.com' ILIKE '%@%.reuters.com'  -> true
--
-- Bulk mail almost always leaves from a marketing subdomain — email., e.,
-- news., mail., mg. — so as written, nearly every publisher would have missed.
-- Nothing would have errored: unmatched mail lands on the catch-all source and
-- reads as a newsletter from a publisher nobody registered. That is the third
-- fault of this exact shape today, after tier 0 counting scraped articles as
-- newsletter deliveries and five sender slugs pointing at sources that did not
-- exist. All three produced a wrong answer wearing the costume of a working one.
--
-- Both forms are kept per publisher: the apex for mail sent from the bare
-- domain, and the wildcard for anything beneath it.

BEGIN;

INSERT INTO newsletter_senders (source_slug, from_pattern, note) VALUES
  ('reuters-carbon',  '%@%.reuters.com',           'Sends from email.reuters.com — the apex pattern alone misses it'),
  ('iea',             '%@%.iea.org',               'Marketing subdomain'),
  ('afr-energy',      '%@%.afr.com',               'Marketing subdomain'),
  ('afr-energy',      '%@%.nine.com.au',           'Nine group sending subdomain'),
  ('the-australian',  '%@%.theaustralian.com.au',  'Marketing subdomain'),
  ('the-australian',  '%@%.news.com.au',           'News Corp sends from newsletters.news.com.au'),
  ('conversation-au', '%@%.theconversation.com',   'Marketing subdomain'),
  ('reneweconomy',    '%@%.reneweconomy.com.au',   'Marketing subdomain')
ON CONFLICT (source_slug, from_pattern) DO NOTHING;

COMMIT;
