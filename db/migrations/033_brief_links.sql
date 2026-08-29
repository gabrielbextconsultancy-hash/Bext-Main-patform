-- 033_brief_links.sql
--
-- The client brief's hyperlinks as data, so the dashboard can show every
-- article under the brief link it answers to without touching the filesystem.
-- Seeded from docs/brief-links.txt by db/seed-brief-links.js, which computes
-- the link-to-source mapping with the same logic the nightly audit uses.
CREATE TABLE IF NOT EXISTS brief_links (
  n          int PRIMARY KEY,           -- the link's position in the brief
  url        text NOT NULL,
  source_id  int REFERENCES sources (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
