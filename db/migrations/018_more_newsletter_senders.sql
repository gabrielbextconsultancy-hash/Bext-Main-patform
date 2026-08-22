-- Senders for the remaining publishers we subscribe to.
--
-- PV Magazine was already subscribed (Australia Daily, 22 Aug 2026) with no
-- matching row here, so its mail would have been filed under the catch-all —
-- working, but attributed to nobody. Registering a publisher before subscribing
-- is the cheaper order of operations.
--
-- Patterns are deliberately broad. Publishers send from marketing subdomains
-- (news.example.com, e.example.com, mail.example.com) and switch providers
-- without announcement, and a pattern that silently stops matching costs far
-- more than one that occasionally over-matches — relevance scoring filters the
-- latter, nothing catches the former.

BEGIN;

INSERT INTO newsletter_senders (source_slug, from_pattern, subject_like, note) VALUES
  ('pv-magazine-au', '%pv-magazine.com',  NULL,
   'Australia Daily Newsletter. Subscribed 22 Aug 2026; covers both pv-magazine.com and its subdomains'),
  ('pv-magazine-au', '%pv-magazine-australia.com', NULL,
   'The AU edition sends from its own domain in some campaigns'),
  ('fifth-estate',   '%thefifthestate.com.au', NULL,
   'Backstop for a healthy scraped source'),
  ('eco-generation', '%ecogeneration.com.au', NULL,
   'The site refuses plain HTTP but is readable with TLS impersonation; the newsletter is a second record'),
  -- The Conversation sends its Australian editions from a separate domain.
  ('conversation-au', '%theconversation.edu.au', NULL,
   'AU editions have historically sent from the .edu.au domain')
ON CONFLICT (source_slug, from_pattern) DO NOTHING;

COMMIT;
