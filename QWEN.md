# BEXT Automation — Qwen Code Project Guide

## What this is
Automation platform for BEXT Consultancy (one-person energy & sustainability consultancy).
Source of truth is always the git repository — never the n8n UI.

## Critical Project Rules (from CLAUDE.md & STRUCTURE.md)
1. **Never touch Premier Fitness stack**: The Hostinger VPS runs docker project `n8n` (`/docker/n8n`) for Premier Fitness. BEXT lives exclusively in project `bext` (`/docker/bext`). Never execute commands against `n8n-pf` or `/docker/n8n`.
2. **Workflow naming & tagging**: Every BEXT workflow is named `BEXT — ...` and tagged `BEXT Consultancy` (`n8n/build-workflows.js` handles this).
3. **Secrets never committed**: `.env` is gitignored.
4. **Postgres & Qdrant**: Bind loopback only.
5. **Melbourne Timezone**: Report crons are `Australia/Melbourne`, not UTC.
6. **Workflow exports**: Export to `n8n/workflows/*.json` and commit after every change.

## MCP & Skills Architecture
- **`n8n-bext`**: Connected to BEXT n8n (`https://bext-n8n.srv1866850.hstgr.cloud`).
- **`teams` (Delegated)**: Interactive Teams channel messaging/reading (`Admin.bext-automation@bextconsultancy.com.au`).
- **`flowagent`**: Power Automate flow generation and management via Azure CLI.
- **`codebase-memory`**: Local code context.
- **Project Domain Skills (`.claude/skills/`)**:
  - `bext-observability`: Uptime Kuma (`bext-kuma`), Prometheus (`bext-prometheus`), Grafana (`bext-grafana`).
  - `bext-graph-pipeline`: Unattended Microsoft Graph pipeline, document generation (`.docx` template rendering via VPS fetcher tunnel), and SharePoint filing.
  - `bext-n8n-teams-bridge`: Webhook contracts between n8n and Power Automate; pure-function constraints on `n8n/lib/meeting-card.js`.
  - `bext-power-automate`: Discovering Power Platform licenses/environments and provisioning announcement flows.
  - `bext-teams-messaging`: Delegated Teams posting, reading, searching via `teams` MCP.
  - `microsoft-teams`: Routing between Graph app-only, delegated `teams` MCP, and FlowAgent.

## Regression Guardrail (`n8n/preflight.js`)
When diagnosing or fixing any failure, always follow the rule in `docs/REGRESSIONS.md`:
1. Document in `docs/REGRESSIONS.md`
2. Add an assertion check in `n8n/preflight.js`
3. Add a heal rule in `n8n/lib/heal-rules.js`
