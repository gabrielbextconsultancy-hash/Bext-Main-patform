# STRUCTURE.md — session bootstrap for BEXT Automation

Read order for a fresh session: `CLAUDE.md` → this file → `docs/INFRASTRUCTURE.md` →
`docs/SETUP-CHECKLIST.md`.
The repo is the source of truth — never the n8n UI.

## Repo map

| Path | What it is |
|---|---|
| `n8n/workflows/*.json` | Exported n8n workflows (source of truth). Built/tagged by `n8n/build-workflows.js` |
| `n8n/build-architecture.js` | Generates `dashboard/src/lib/architecture.generated.ts` and `docs/diagrams/*.excalidraw` from exported workflows |
| `db/migrations/` | Numbered, append-only SQL. Never edit an applied migration |
| `sources/registry.yaml` | Single source of truth for the monitored sources (73 entries → 74 rows incl. the newsletter catch-all; 67 are brief links); seeds the `sources` table. Never hand-edit `sources` |
| `dashboard/` | Next.js 16 App Router + Tailwind v4, direct `pg` from server components (`/architecture` live workflow map). Deployed to Hostinger VPS via `.github/workflows/deploy.yml` |
| `graph/` | Microsoft Graph setup: `app-registration.md` (instructions + blocker log), `verify.js` (4-step health check) |
| `docs/INFRASTRUCTURE.md` | **Verified map of hosting, cPanel/DNS, mail and M365.** Read before touching any of them |
| `docs/diagrams/` | Excalidraw architectural estate and workflow maps generated from runnable JSON |
| `docs/` | Deliverable drafts, runbook (`05-runbook.md`), `SETUP-CHECKLIST.md` (manual human steps) |
| `deliverables/` | Client-facing PDFs |
| `api/`, `fetcher/`, `infra/` | Support code and infra config |
| `n8n/preflight.js` | Every failure already paid for, as an assertion (R001–R040). Run before assuming anything works |
| `n8n/validate-replay.js` | Replays the shipped pre-send validator over reports already delivered. A gate that would block a good sheet fails the build (R036) |
| `n8n/rebuild-audit.js` | Rebuilds the current day audit on demand instead of waiting for the 23:50 pass; reuses the workflow's own SELECT, UPSERT and `lib/day-audit.js` |
| `n8n/lib/source-report.js` | The daily fetch-audit report, inlined into the 05:00 run and shared with any CLI |
| `db/prune-before.js` | Deletes articles/reports/audits before a cutoff. Prints what it will take; `--dry` rolls back. Pair with the ingest age floor or a prune undoes itself (R039) |
| `docs/build-coverage-explainer.js` | Client-facing PDF: why a sheet carries what it carries, every source listed, a worked example from the day. Figures read live |
| `docs/build-overview.js` | Client-facing PDF: how the report works end to end |
| `n8n/self-heal.js` + `n8n/lib/heal-rules.js` | The healer, and the rules it recognises. **Read `docs/SELF-HEALING.md` before changing what it may do** |

## Engagements + dates

| Engagement | Draft | Architecture | Final | State |
|---|---|---|---|---|
| A — Industry Daily Report | 11 Aug ✓ | — | 18 Aug | Live, six workflows: `BEXT Daily News — 1 Source Ingest` (hourly) / `2 Newsletter Intake` (IMAP) / `3 Article Analysis` (15 min) / `4 News Quality` (06:00, 12:00, 23:50) / `5 Daily Report` (05:00 Melbourne) / `6 Teams Card` (05:20). Gemini reviews the sheet before it sends; a daily fetch-audit PDF is stored beside each send |
| B — Business Structure Efficiency | 11 Aug ✓ (proposal live) | 25 Aug | 8 Sep | Assessment drafted; zero integration code yet |
| C — LinkedIn Blog Generation | — | — | — | Fortnightly: news feed → 3 ranked topics → 2 drafts → human approval → post. Engine built: `BEXT — Content Topics` / `Content Drafts` / `LinkedIn Publish`, craft lib in `n8n/lib/linkedin/`. Dashboard `/content` pending. Brief PDF (18 Aug) not yet ingested |

Status data lives in the DB (`milestones`, `deliverables`); the dashboard renders it. Don't hardcode status in the UI.

## Hosting

- Hostinger VPS `srv1866850`, docker project **`bext`** at `/docker/bext` (n8n 2.32.6 Community, Postgres 16, Qdrant, traefik + Let's Encrypt).
- Monitoring: `bext-kuma` (Uptime Kuma) in the same project. HTTP monitors plus one **push** monitor per scheduled workflow — the push ones are what catch a workflow that is active and not running (R024).
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

Every BEXT workflow is tagged `BEXT Consultancy` (folders are enterprise-only) and named one of
two ways, both asserted by preflight R010: standalone work is `BEXT — ...`; the six that produce
the morning sheet are `BEXT Daily News — N ...`, numbered for their place in the run so n8n's
alphabetical list reads as the pipeline. Those six also carry the `Daily Report` tag.
Renaming a workflow means renaming its `connections` keys too — R037 exists because that was
missed once and the deploy half-landed. Export to `n8n/workflows/*.json` and commit after every change.

## Status board

**Brief A, verified 31 Aug 2026.** 15 workflows deployed, preflight 35 checks passing,
41 migrations applied (latest `037_source_reports.sql`).

The day's rules, all enforced in the shipped `Top articles, prior day` query and mirrored in the
dashboard preview:

- The window covers the previous publication day plus a two-day reach-back for anything never sent.
- Nothing **gathered** today may send today — a separate cutoff from the publication bound, because
  a piece published yesterday and fetched at 02:00 today would otherwise go out at 05:01.
- An article whose page has **not been opened for a date** cannot send. Unknown age is not new.
- `report_items` joined to sent reports is the exactly-once ledger; nothing sends twice.
- RenewEconomy is `always_relevant` — it bypasses the score floor by client instruction.

Before the send, `Gemini reviews the sheet` advises and `Validate before send` decides. Only
deterministic faults can hold a report; the model never can, and a Gemini outage still sends.

Dashboard: `/pipeline` merges the management table, daily report and sources into one page with
three tabs. The Before card previews tomorrow's email as rendered HTML; the After archive groups
day → brief link → article and opens the delivered sheet with any article outlined. A daily
fetch-audit PDF is stored per publication day and downloadable from the header.

## Status board (verified 11 Aug 2026)

**Done:** VPS + docker stack + TLS · schema + 68 sources · Brief A pipeline + daily 05:00 AEST email · dashboard deployed · proposal deck live · current-state assessment (`docs/current-state-assessment.md`) · HubSpot audit.

**Done (11 Aug): Microsoft Graph wired.** App **BEXT Automation (Dev)** on tenant
`bextconsultancy.com.au` (`9eb458d1-317d-4aae-a9a3-bb68e430d701`), client
`b72d1df4-06ec-4390-937a-1293f34d31be`, admin `Admin.bext-automation@bextconsultancy.com.au`.
`node graph/verify.js`: all 4 checks pass (token, User.Read.All, Mail.Send, Sites.ReadWrite.All).

**Done (11 Aug): HubSpot + ProjectManager API tokens** in `.env`, both verified live
(HubSpot portal 443333225; ProjectManager projects readable).

**Done (11 Aug): SharePoint + Graph Health.** The tenant already had a four-site IA
(BEXTHQ / CRM / ProgramManagement / CommercialManagement) — documented in
`docs/sharepoint-ia.md`, extended not replaced. `graph/provision-sharepoint.js` added
`Templates/`, `Meeting Transcripts/`, `Meeting Minutes/` under BEXTHQ › API Automation Folder.
`BEXT — Graph Health` is deployed and active (`S1AEzQfVRRfpYcWW`, daily 06:00).

**Still blocked (Brief B, client-side):** Xero API token, Teams transcription toggle +
`OnlineMeetingTranscript.Read.All` + application access policy (`graph/teams-access-policy.ps1`),
company minutes template, the naming/filing decisions in `docs/sharepoint-ia.md` §Open decisions.

## Next workflows (order)

1. **`BEXT — Meeting Intake`** (n8n) — needs the three Teams prerequisites above.
2. **25 Aug architecture deliverables**: Business Systems Integration Diagram, Process Flow Maps
   (SharePoint IA drafted).
3. **Email/document automation** (review areas 4–5) once templates agreed.
4. **Brief A, open items** (31 Aug 2026):
   - **S&P Global** now 403s the sitemaps its three active sources read, so they return nothing.
     Same remedy as IEA and The Australian — a public news index — or retire them.
   - Client-rendered listings still returning navigation instead of stories: DEECA, Victorian
     Energy Upgrades, Victorian Premier media, AIDC, AER Registers. VicGrid proved the sitemap
     fix works on this pattern.
   - Pruned articles return on the next hourly sweep undated and are held rather than sent; a rule
     that discards on *dating* older than the window would keep the shelf tidy as well as the sheet.
