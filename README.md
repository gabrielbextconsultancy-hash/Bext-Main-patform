# BEXT Consultancy — Automation Platform

Two engagements for a one-person energy & sustainability consultancy, built on a self-hosted
n8n + PostgreSQL + Qdrant stack with Microsoft Graph as the M365 surface.

| Engagement | Deliverable | Dates (2026) |
|---|---|---|
| **A — Industry Daily Report** | One consolidated industry insight sheet emailed daily 05:00 AEST from ~60 named sources | Draft 11 Aug · Final 18 Aug |
| **B — Business Structure Efficiency** | AI-enabled operating model across M365, HubSpot, Xero, ProjectManager, WordPress, LinkedIn | Draft 11 Aug · Architecture 25 Aug · Final 8 Sep |

## Architecture

```
      ~60 industry sources (RSS + scrape)
                  │
                  ▼
   n8n  ── BEXT Consultancy folder ───────────────┐
    │  Source Ingest (hourly)                     │
    │  Article Analysis (30 min, Gemini)          │
    │  Daily Report (05:00 Australia/Melbourne)   │
    │  Health Check (15 min)                      │
    └──────────────┬──────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
  PostgreSQL    Qdrant     Microsoft Graph
  (articles,   (knowledge   (Outlook · Teams ·
   reports,     base RAG)    SharePoint · OneDrive)
   milestones)
      │
      ▼
  Next.js dashboard — timeline · deliverables · sources · reports
```

Everything runs in one Docker Compose project (`bext`) on a Hostinger VPS, behind the traefik
already on that host. All production credentials transfer to the client at handover.

## Layout

| Path | Contents |
|---|---|
| `infra/` | `docker-compose.yml` for the `bext` stack |
| `db/migrations/` | Numbered SQL migrations, applied with `psql` over SSH |
| `n8n/workflows/` | Exported workflow JSON — the version-controlled source of truth |
| `sources/registry.yaml` | The ~60 monitored sources |
| `dashboard/` | Next.js 15 + Tailwind dashboard |
| `graph/` | Azure app registration guide + Graph permission list |
| `docs/` | Briefs, architecture, runbook |

## Getting started

```bash
cp .env.example .env   # then fill in the blanks
```

See `docs/05-runbook.md` for deploy, tunnel, and migration commands.

## Hosts

| Service | URL |
|---|---|
| n8n (BEXT) | https://bext-n8n.srv1866850.hstgr.cloud |
| Dashboard | https://bext.srv1866850.hstgr.cloud |
| n8n (Premier Fitness — do not touch) | https://n8n.srv1866850.hstgr.cloud |
