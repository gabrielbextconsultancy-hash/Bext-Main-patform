-- 003_progress_and_fetcher.sql
--
-- Records what the build has actually completed, and adds the browser fetch
-- service as a deliverable in its own right. It was not in the original plan —
-- it exists because 15 of the briefed sources refuse plain HTTP requests, which
-- only became visible once every source was tested end to end.

BEGIN;

-- ── Completed ────────────────────────────────────────────────────────────────

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'infra/docker-compose.yml'
WHERE title = 'BEXT Docker stack on VPS';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'db/migrations/001_init.sql'
WHERE title = 'Application database schema';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'https://github.com/'
WHERE title = 'Version-controlled repository';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'sources/registry.yaml',
  description = 'All 68 sources catalogued with every URL recovered from the brief PDF''s '
                'hyperlinks, each classified by what it actually yields: 26 working RSS feeds, '
                '29 scraped over plain HTTP, 15 requiring a headless browser, 4 unreachable.'
WHERE title = 'Source registry';

-- ── Blocked, with the reason recorded rather than left silent ────────────────

UPDATE deliverables SET status = 'blocked',
  description = description || ' BLOCKED: the Microsoft 365 Developer Program no longer '
                'grants free sandboxes — it now requires a Visual Studio Professional or '
                'Enterprise annual subscription. Proceeding via a Microsoft 365 Business '
                'Standard trial instead.'
WHERE title IN ('Azure App Registration', 'Microsoft Graph credential');

-- ── New deliverable: the browser fetch service ───────────────────────────────

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, status,
                          evidence_url, completed_at, sort_order)
SELECT 'daily_report', m.id,
  'Headless browser fetch service',
  'Fifteen briefed sources cannot be read over plain HTTP: AEMO, DEECA, VicGrid, SEC Victoria '
  'and Victorian Energy Upgrades sit behind Imperva bot protection, while AER, UNFCCC and the '
  'Victorian Premier''s media centre render their article lists in JavaScript. A Playwright '
  'container in the stack renders those pages and solves the challenge, recovering the top '
  'Australian energy regulators for the report.',
  'A.Industry Updates', 'in_progress', 'fetcher/server.js', NULL, 145
FROM milestones m
WHERE m.engagement = 'daily_report' AND m.title = 'Final delivery'
ON CONFLICT DO NOTHING;

-- ── Milestone rollup ─────────────────────────────────────────────────────────

UPDATE milestones SET status = 'in_progress'
WHERE title = 'Development environment stood up';

UPDATE milestones SET status = 'blocked'
WHERE title = 'Microsoft 365 integration live';

-- ── Platform health, so the overview is not empty ────────────────────────────

INSERT INTO integration_health (service, status, detail) VALUES
  ('postgres',  'up',           'PostgreSQL 16 on the VPS, 8 tables, reachable through the SSH tunnel.'),
  ('qdrant',    'up',           'Running; no collection created yet — needed from Brief B onward.'),
  ('n8n',       'degraded',     'Container healthy and TLS valid, but no owner account created yet, so no API key and no workflows.'),
  ('fetcher',   'up',           'Headless browser service resolving Imperva challenges for 15 sources.'),
  ('microsoft_graph', 'unconfigured', 'Awaiting a tenant — the M365 Developer sandbox is no longer free.'),
  ('gemini',    'unconfigured', 'Awaiting an API key.');

COMMIT;
