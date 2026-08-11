# STRUCTURE.md — session bootstrap for BEXT Automation

Read order for a fresh session: `CLAUDE.md` → this file → `docs/SETUP-CHECKLIST.md`.
The repo is the source of truth — never the n8n UI.

## Repo map

| Path | What it is |
|---|---|
| `n8n/workflows/*.json` | Exported n8n workflows (source of truth). Built/tagged by `n8n/build-workflows.js` |
| `db/migrations/` | Numbered, append-only SQL. Never edit an applied migration |
| `sources/registry.yaml` | Single source of truth for the 68 monitored sources; seeds the `sources` table |
| `dashboard/` | Next.js 16 App Router + Tailwind v4, direct `pg` from server components. Deployed to Hostinger VPS via `.github/workflows/deploy.yml` |
| `graph/` | Microsoft Graph setup: `app-registration.md` (instructions + blocker log), `verify.js` (4-step health check) |
| `docs/` | Deliverable drafts, runbook (`05-runbook.md`), `SETUP-CHECKLIST.md` (manual human steps) |
| `deliverables/` | Client-facing PDFs |
| `api/`, `fetcher/`, `infra/` | Support code and infra config |

## Engagements + dates

| Engagement | Draft | Architecture | Final | State |
|---|---|---|---|---|
| A — Industry Daily Report | 11 Aug ✓ | — | 18 Aug | Pipeline live: `BEXT — Source Ingest` / `Article Analysis` / `Daily Report` (05:00 AEST) |
| B — Business Structure Efficiency | 11 Aug ✓ (proposal live) | 25 Aug | 8 Sep | Assessment drafted; zero integration code yet |

Status data lives in the DB (`milestones`, `deliverables`); the dashboard renders it. Don't hardcode status in the UI.

## Hosting

- Hostinger VPS `srv1866850`, docker project **`bext`** at `/docker/bext` (n8n 2.32.6 Community, Postgres 16, Qdrant, traefik + Let's Encrypt).
- Public: dashboard `https://bext.dev-environment.site` (proposal deck at `/proposal`, no auth, noindex); n8n `https://bext-n8n.srv1866850.hstgr.cloud`.
- Postgres + Qdrant bind loopback only. `N8N_ENCRYPTION_KEY` in `.env` is irreplaceable — keep backed up.
- **Never touch docker project `n8n` (Premier Fitness)** on the same VPS.

## MCP + skills — scope map

| Server / skill | Scope | Use for BEXT? |
|---|---|---|
| `n8n-pf`, `hostinger-pf`, `supabase-pf` MCP | Premier Fitness | **No.** Never create BEXT workflows through `n8n-pf` |
| `n8n-bext` MCP (project `.mcp.json`) | BEXT n8n instance | Yes — needs `BEXT_N8N_API_KEY` in your user env |
| `n8n-*` skills (expression-syntax, code-javascript, workflow-patterns, validation-expert, node-configuration, mcp-tools-expert) | Generic n8n | Yes |
| `hostinger-bg-deploy`, `*-bg-ops` skills | Blue Goat Marketing | **No** — different client |
| `bg-gcloud` skill | Blue Goat GCP | Only if rotating the Gemini key pattern is reused; keys for BEXT live in BEXT `.env` |

Every BEXT workflow: named `BEXT — ...`, tagged `BEXT Consultancy` (folders are enterprise-only).
Export to `n8n/workflows/*.json` and commit after every change.

## Status board (verified 11 Aug 2026)

**Done:** VPS + docker stack + TLS · schema + 68 sources · Brief A pipeline + daily 05:00 AEST email · dashboard deployed · proposal deck live · current-state assessment (`docs/current-state-assessment.md`) · HubSpot audit.

**Done (11 Aug): Microsoft Graph wired.** App **BEXT Automation (Dev)** on tenant
`bextconsultancy.com.au` (`9eb458d1-317d-4aae-a9a3-bb68e430d701`), client
`b72d1df4-06ec-4390-937a-1293f34d31be`, admin `Admin.bext-automation@bextconsultancy.com.au`.
`node graph/verify.js`: all 4 checks pass (token, User.Read.All, Mail.Send, Sites.ReadWrite.All).

**Still blocked (Brief B, client-side):** HubSpot/Xero/ProjectManager API tokens, Teams
transcription toggle, company templates, SharePoint `BEXT` site structure (`docs/SETUP-CHECKLIST.md`).

## Next workflows (order)

1. **`BEXT — Graph Health`** (n8n): daily token/sendMail/sites check → `integration_health`. Unblocked — build now; reuse `graph/verify.js` logic.
2. **25 Aug architecture deliverables** (docs): Business Systems Integration Diagram, Process Flow Maps, SharePoint IA.
3. **`BEXT — Meeting Intake`** (n8n, needs Teams transcription toggle): recording → transcript → minutes → action items → draft follow-ups.
4. **Email/document automation** (review areas 4–5) once templates + SharePoint IA agreed.
