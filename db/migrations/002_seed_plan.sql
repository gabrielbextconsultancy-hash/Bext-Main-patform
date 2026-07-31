-- 002_seed_plan.sql — milestones and deliverables transcribed from the two briefs
--
-- Dates are the contracted ones from:
--   Project Brief_Industry Daily Report_2026.07.28.pdf
--   Project Brief_Business Structure Efficiency_2026.07.28.pdf
--
-- Re-runnable: keyed on (engagement, title).

BEGIN;

-- ── Milestones ───────────────────────────────────────────────────────────────

INSERT INTO milestones (engagement, title, detail, due_date, is_contracted, sort_order) VALUES
  ('infrastructure',     'Development environment stood up',
   'Hostinger VPS, Docker, n8n Community, PostgreSQL, Qdrant, repository, dashboard scaffold.',
   NULL, false, 10),
  ('infrastructure',     'Microsoft 365 integration live',
   'Azure App Registration in the M365 Developer Sandbox, Graph permissions consented, n8n credential verified against Outlook.',
   NULL, false, 20),

  ('daily_report',       'Draft / Solution Mapping',
   'Solution map for the automated daily industry sheet, with the source registry and pipeline design.',
   DATE '2026-08-11', true, 30),
  ('daily_report',       'Final delivery',
   'Daily consolidated industry and marketing insight sheet emailed at 05:00 AEST.',
   DATE '2026-08-18', true, 40),

  ('business_structure', 'Draft Plan',
   'Draft of the AI-enabled business operating model.',
   DATE '2026-08-11', true, 50),
  ('business_structure', 'Schematic Architecture Plan',
   'Business Systems Integration Diagram plus process flow maps.',
   DATE '2026-08-25', true, 60),
  ('business_structure', 'Final delivery',
   'Complete future-state architecture, API integration list, software recommendations.',
   DATE '2026-09-08', true, 70)
ON CONFLICT DO NOTHING;

-- ── Deliverables: infrastructure ─────────────────────────────────────────────

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, status, sort_order)
SELECT 'infrastructure', m.id, d.title, d.description, d.brief_ref, d.status::work_status, d.sort_order
FROM milestones m, (VALUES
  ('BEXT Docker stack on VPS',        'n8n 2.32.6 + PostgreSQL 16 + Qdrant as compose project `bext`, behind the existing traefik with Let''s Encrypt.', 'PLAN 1', 'done', 10),
  ('Application database schema',     'sources, articles, article_analysis, reports, report_items, milestones, deliverables, integration_health.', 'PLAN 1', 'in_progress', 20),
  ('Version-controlled repository',   'bext-automation: infra, migrations, workflow exports, source registry, dashboard, docs.', 'PLAN 1', 'in_progress', 30),
  ('n8n "BEXT Consultancy" folder',   'Dedicated folder holding every workflow for this engagement.', 'PLAN 1', 'not_started', 40),
  ('Azure App Registration',          'Tenant ID, Client ID, Client Secret in the M365 Developer Sandbox with admin consent granted.', 'PLAN 1', 'not_started', 50),
  ('Microsoft Graph credential',      'n8n OAuth2 client-credentials credential verified against Outlook mail send and read.', 'PLAN 1', 'not_started', 60),
  ('Gemini API key wired',            'AI model available to n8n for article summarisation and drafting.', 'PLAN 1', 'not_started', 70),
  ('Power BI Desktop',                'Installed locally for engagement B dashboard development.', 'PLAN 1', 'not_started', 80)
) AS d(title, description, brief_ref, status, sort_order)
WHERE m.engagement = 'infrastructure' AND m.title = 'Development environment stood up'
ON CONFLICT DO NOTHING;

-- ── Deliverables: engagement A — Industry Daily Report ───────────────────────

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, sort_order)
SELECT 'daily_report', m.id, d.title, d.description, d.brief_ref, d.sort_order
FROM milestones m, (VALUES
  ('Source registry',                 'All briefed sources catalogued with ingest method, feed URL or scrape selector, and category.', 'A.Scope', 110),
  ('Australian News ingest',          'ABC News (Energy, Climate Change), Australian Financial Review, The Conversation across the five named categories.', 'A.Australian News', 120),
  ('International Industry ingest',   'Reuters, S&P Global, IEA, IEA Energy Efficiency, IRENA, UNFCCC, European Commission Energy, US DOE, NZ Herald, IEEFA, Energy Tracker, Renewables Now.', 'A.International', 130),
  ('Industry Updates ingest',         'AEMO, AER, AEMC, Clean Energy Regulator, ARENA, CEFC, Climate Change Authority, ACCC, VEU, ESC, FMA, Infrastructure, DCCEEW, federal and state government, NABERS, CBD, ABCB, GEMS, DISR, NGER, DEECA, VicGrid, SEC Victoria, Solar Victoria, EEC, CEC, AEC, GBCA, PCA, A2EP, AHC, Smart Energy Council, EUAA, IGCC, Climate Works, RACV, CSIRO, RenewEconomy, PV Magazine, Energy Magazine, The Fifth Estate, Eco Generation.', 'A.Industry Updates', 140),
  ('Register status filtering',       'AER and AEMC register pages filtered to Authorisations, Network Exemptions, Retail Exemptions, Guidelines Schemes Models and Reviews, Projects, Decisions, Determination and Access Arrangements.', 'A.Industry Updates', 150),
  ('Deduplication',                   'Same story syndicated across multiple sources appears once.', 'A.Outcomes', 160),
  ('AI summarisation and ranking',    'Each article summarised and scored for relevance so the sheet leads with what matters.', 'A.Outcomes', 170),
  ('Report template',                 'Single consolidated sheet, sections in the briefed order and naming.', 'A.Outcomes', 180),
  ('05:00 AEST email delivery',       'Scheduled send via Microsoft Graph, daily, Australia/Melbourne time.', 'A.Outcomes', 190),
  ('Marketing platform health',       'Health of marketing platforms reported alongside the news.', 'A.Purpose', 200),
  ('Grants / Funding section',        'Deferred by the brief to a separate report; section links out.', 'A.Grants', 210),
  ('LinkedIn industry behaviour',     'Deferred by the brief to a separate report; section links out.', 'A.LinkedIn', 220)
) AS d(title, description, brief_ref, sort_order)
WHERE m.engagement = 'daily_report' AND m.title = 'Final delivery'
ON CONFLICT DO NOTHING;

-- ── Deliverables: engagement B — Business Structure Efficiency ───────────────
-- The five contracted artefacts, due at Final.

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, sort_order)
SELECT 'business_structure', m.id, d.title, d.description, d.brief_ref, d.sort_order
FROM milestones m, (VALUES
  ('Current State Assessment',        'Assessment of the existing arrangement and set up across ProjectManager, HubSpot, Xero, Microsoft Suite, Copilot, Claude, Canva, Adobe PDF, WordPress and LinkedIn.', 'B.Deliverables', 310),
  ('Business Systems Integration Diagram', 'Visual map of every platform, how data flows between them, where AI is invoked, and which system is the source of truth for each data type.', 'B.Deliverables', 320),
  ('Business Process Flow Maps',      'Process maps for the standardised workflows.', 'B.Deliverables', 330),
  ('API Integration & Automation list', 'Recommended integrations with estimated implementation effort and ongoing maintenance.', 'B.Deliverables', 340),
  ('Software Recommendations',        'Only where materially beneficial — the stated preference is to avoid introducing additional software.', 'B.Deliverables', 350)
) AS d(title, description, brief_ref, sort_order)
WHERE m.engagement = 'business_structure' AND m.title = 'Final delivery'
ON CONFLICT DO NOTHING;

-- The nine review areas, due at Schematic Architecture.

INSERT INTO deliverables (engagement, milestone_id, title, description, brief_ref, sort_order)
SELECT 'business_structure', m.id, d.title, d.description, d.brief_ref, d.sort_order
FROM milestones m, (VALUES
  ('1. Business Operating Model',     'Single source of truth, centralised document management, minimal duplicate entry, minimal app switching, standardised workflows, scalability.', 'B.1', 410),
  ('2. AI Workflow Design',           'Where AI becomes the primary worker rather than an assistant: transcription, minutes, action items, email drafting, proposals and reports through Canva templates, presentations, filing, naming conventions.', 'B.2', 420),
  ('3. Meeting Workflow',             'Highest priority. Record in Teams, AI transcribes, produces minutes in the company template, extracts decisions, allocates actions, drafts follow-up emails, files to the right folder. No manual note taking. Extends to daily brainstorming and note taking.', 'B.3', 430),
  ('4. Email Automation',             'Drafting, proposal responses, meeting follow-ups, client updates, reminders, project progress emails with graphics and status attachments, standard enquiry responses, prompted filing of key commercial email.', 'B.4', 440),
  ('5. Document Management',          'SharePoint folder structure, naming conventions, version control, automatic filing, searchable knowledge base, AI retrieval, SharePoint page design.', 'B.5', 450),
  ('6. Marketing Automation',         'Enquiry handling from potential clients, LinkedIn energy-industry behaviour summarised from latest posts and articles, fortnightly LinkedIn content drafting.', 'B.6', 460),
  ('7. Knowledge Management',         'Internal system letting AI leverage previous proposals, reports, masterplans, capability statements, technical reports, presentations, meeting notes, templates, lessons learned and standard methodologies.', 'B.7', 470),
  ('8. Forms & Data Capture',         'Structured forms for project initiation, client onboarding, site inspections, meeting preparation, proposal requests, consultant checklists, stakeholder input, design review, defect claims, stakeholder enquiry.', 'B.8', 480),
  ('9. Recommended Future Software',  'With business justification, estimated cost and implementation effort.', 'B.9', 490)
) AS d(title, description, brief_ref, sort_order)
WHERE m.engagement = 'business_structure' AND m.title = 'Schematic Architecture Plan'
ON CONFLICT DO NOTHING;

COMMIT;
