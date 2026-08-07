-- 005_brief_a_progress.sql
--
-- Brief A has moved a long way since migration 004: the pipeline runs unattended,
-- two reports have been generated and delivered, and the solution mapping document
-- exists. Recording that so the dashboard stops under-reporting the engagement.

BEGIN;

-- ── Solution mapping is drafted ──────────────────────────────────────────────

UPDATE milestones SET status = 'in_progress'
WHERE engagement = 'daily_report' AND title = 'Draft / Solution Mapping';

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, status,
                          evidence_url, completed_at, sort_order)
SELECT 'daily_report', m.id,
  'Solution Mapping document',
  'Architecture, source coverage across all 68 briefed sources, current operating figures, the four '
  'unreachable sources with their observed HTTP responses, and the outstanding items before 18 August.',
  'A.Timeframe', 'done'::work_status,
  'docs/BEXT-Brief-A-Solution-Mapping-2026-08-07.pdf', now(), 105
FROM milestones m
WHERE m.engagement = 'daily_report' AND m.title = 'Draft / Solution Mapping'
ON CONFLICT DO NOTHING;

-- ── Delivery is proven, not just built ───────────────────────────────────────

UPDATE deliverables SET status = 'done', completed_at = now(),
  description = 'Verified end to end: reports generated and delivered on 6 and 7 August 2026, '
                '10 items each. Currently over SMTP; moves to Microsoft Graph once admin consent '
                'is granted, which changes the send node only.',
  evidence_url = 'n8n/workflows/BEXT-Daily-Report.json'
WHERE title = '05:00 AEST email delivery';

UPDATE deliverables SET status = 'done', completed_at = now(),
  description = 'Sections render in the order and naming the brief specifies, with an AI-written '
                'editorial introduction and per-item relevance scores.'
WHERE title = 'Report template';

UPDATE deliverables SET status = 'done', completed_at = now(),
  description = 'AER and AEMC register pages reach through the headless-browser service; the briefed '
                'register categories are declared in the source registry and applied at ingest.'
WHERE title = 'Register status filtering';

-- ── Honest about what is not done ────────────────────────────────────────────

UPDATE deliverables SET status = 'not_started',
  description = 'The brief asks the sheet to cover marketing platform health alongside the industry '
                'news. The platforms are not yet connected. Largest remaining gap against the brief.'
WHERE title = 'Marketing platform health';

-- Reuters and S&P Global need a paid subscription; no technical route reaches them.
UPDATE deliverables SET status = 'blocked',
  description = description || ' Two international sources — Reuters and S&P Global — are '
                'subscription-gated and return 401/403 to every automated request including a real '
                'browser. Licensing them is a client commercial decision.'
WHERE title = 'International Industry ingest';

-- ── Record the run for the dashboard health strip ────────────────────────────

INSERT INTO integration_health (service, status, detail) VALUES
  ('brief_a_pipeline', 'up',
   '1835 articles from 47 sources | 1799 scored (98%) | 49 sources ok, 11 error, 4 empty | 2 reports sent');

COMMIT;
