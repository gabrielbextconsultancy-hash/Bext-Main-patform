-- Reuters sends from two unrelated-looking domains.
--
-- The first real Reuters newsletters arrived from three addresses:
--
--   newsletters@email.reuters.com      matched  (%@%.reuters.com)
--   dailybriefing@thomsonreuters.com   MISSED
--   breakingviews@thomsonreuters.com   MISSED
--
-- thomsonreuters.com ends in the letters "reuters.com" but is a different domain:
-- there is no dot before "reuters", so neither '%@reuters.com' nor
-- '%@%.reuters.com' matches it. The corporate domain and the newsroom domain are
-- separate, and both carry newsletters.
--
-- Fourth pattern fault of the day, all found by watching real mail rather than
-- reasoning about what publishers ought to do.

BEGIN;

INSERT INTO newsletter_senders (source_slug, from_pattern, note) VALUES
  ('reuters-carbon', '%@thomsonreuters.com',   'Weekend Briefing and Breakingviews send from the corporate domain, not the newsroom one'),
  ('reuters-carbon', '%@%.thomsonreuters.com', 'Subdomains of the corporate domain')
ON CONFLICT (source_slug, from_pattern) DO NOTHING;

COMMIT;
