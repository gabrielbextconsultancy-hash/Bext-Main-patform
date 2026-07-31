-- 004_progress_2026_07_31.sql
--
-- Brings the plan state in line with what has actually shipped, so the timeline
-- and deliverables pages stop under-reporting.

BEGIN;

-- ── Infrastructure ───────────────────────────────────────────────────────────

UPDATE deliverables SET status = 'done', completed_at = now(),
  title = 'n8n "BEXT Consultancy" tag',
  description = 'Folders turned out to need an enterprise licence (feat:folders is rejected on '
                'Community), so grouping is by tag instead. Every workflow is named "BEXT — …" '
                'and carries the tag, applied automatically by the build script.'
WHERE title = 'n8n "BEXT Consultancy" folder';

UPDATE deliverables SET status = 'done', completed_at = now(), evidence_url = 'n8n/build-workflows.js'
WHERE title = 'Gemini API key wired';

UPDATE deliverables SET status = 'done', completed_at = now()
WHERE title = 'Power BI Desktop';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'https://github.com/gabrielbextconsultancy-hash/Bext-Main-patform'
WHERE title = 'Version-controlled repository';

-- The Microsoft items are no longer blocked on money: the registration and Graph
-- are free, and Brief A no longer depends on them.
UPDATE deliverables SET status = 'not_started',
  description = 'Free on a no-cost Entra tenant — does not require a paid licence. Click-path and '
                'permission list in graph/app-registration.md, verification in graph/verify.js.'
WHERE title = 'Azure App Registration';

UPDATE deliverables SET status = 'not_started',
  description = 'The API is free; the licence buys the data behind it (mailbox, SharePoint, Teams). '
                'Needed for Brief B build, not for the daily report.'
WHERE title = 'Microsoft Graph credential';

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, status,
                          evidence_url, completed_at, sort_order)
SELECT 'infrastructure', m.id, d.title, d.description, 'PLAN 1', 'done'::work_status,
       d.evidence_url, now(), d.sort_order
FROM milestones m, (VALUES
  ('SMTP report delivery',
   'reports@bext.dev-environment.site over mail.dev-environment.site:465, authenticated and stored '
   'as an n8n credential. Unblocks the 5am report without waiting on Microsoft.', 'n8n/build-workflows.js', 90),
  ('Client-facing proposal site',
   'bext.dev-environment.site — public proposal deck, admin pages behind login with a long-lived '
   'session, deployed from GitHub Actions on every push.', 'dashboard/src/app/proposal', 100)
) AS d(title, description, evidence_url, sort_order)
WHERE m.engagement = 'infrastructure' AND m.title = 'Development environment stood up'
ON CONFLICT DO NOTHING;

-- ── Engagement A — Industry Daily Report ─────────────────────────────────────

UPDATE deliverables SET status = 'done', completed_at = now(), evidence_url = 'n8n/lib/ingest.js'
WHERE title IN ('Australian News ingest', 'International Industry ingest', 'Industry Updates ingest',
                'Deduplication');

UPDATE deliverables SET status = 'done', completed_at = now(), evidence_url = 'fetcher/server.js'
WHERE title = 'Headless browser fetch service';

UPDATE deliverables SET status = 'done', completed_at = now(),
  evidence_url = 'n8n/workflows/BEXT-Article-Analysis.json',
  description = 'Gemini 3.6 Flash scores each article 0-100 for relevance to an Australian energy '
                'consultant and writes a two-sentence summary, so the sheet leads with what matters.'
WHERE title = 'AI summarisation and ranking';

UPDATE deliverables SET status = 'in_progress',
  description = 'AER and AEMC register pages are reachable through the browser service; the category '
                'filter is declared in the source registry and applied at ingest.'
WHERE title = 'Register status filtering';

UPDATE deliverables SET status = 'in_progress'
WHERE title IN ('Report template', '05:00 AEST email delivery');

-- ── Engagement B — Business Structure Efficiency ─────────────────────────────
-- The draft plan due 11 Aug answers all five contracted artefacts and all nine
-- review areas. They are in progress rather than done — final is 8 September.

UPDATE deliverables SET status = 'in_progress',
  evidence_url = 'https://bext.dev-environment.site/proposal'
WHERE engagement = 'business_structure';

COMMIT;
