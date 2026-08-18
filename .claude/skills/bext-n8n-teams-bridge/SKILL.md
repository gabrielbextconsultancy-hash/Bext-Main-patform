---
name: bext-n8n-teams-bridge
description: Connects BEXT n8n workflows to Microsoft Teams and Power Automate in both directions. Use when an n8n workflow must post to a Teams channel, when a Teams message, SharePoint file drop or Power Automate flow must trigger an n8n workflow, when adding or changing a webhook between n8n and a cloud flow, when porting graph/run-meeting-once.js into MEETING_CODE, or when editing n8n/build-workflows.js to add or change a `BEXT — ...` workflow that touches Microsoft 365.
---

# The n8n ⇄ Teams bridge

Two directions, two different mechanisms. Neither uses the delegated `teams` MCP server — that
path depends on a live sign-in and will fail silently in a scheduled workflow.

```
n8n  ──HTTP POST──▶  Power Automate flow  ──▶  Teams channel     (outbound: built)
n8n  ◀──HTTP POST──  Power Automate flow  ◀──  SharePoint/Teams  (inbound: not built)
```

## Outbound — already built

The sending side is complete. It exists because **no Graph application permission can post a
channel message**, so an unattended workflow has to hand the job to a flow.

| Piece | Where | State |
|---|---|---|
| Card builder | `n8n/lib/meeting-card.js` | Built. Pure function, returns the envelope, posts nothing. |
| Caller | `graph/run-meeting-once.js` stage 6 | Built. |
| Caller | `MEETING_CODE` in `n8n/build-workflows.js` | **Not yet** — part of the port. |
| Transport | `TEAMS_MEETING_WEBHOOK_URL` | In `.env.example` and `infra/docker-compose.yml`. Value pending. |
| The flow | `BEXT — Channel Post Bridge` | **Not created.** Build with `graph/create-channel-flow.js`. |
| Manual fallback | `docs/TEAMS-WEBHOOK-SETUP.md` | Documented, the specification and the fallback. |
| Storage | migration `011_meeting_card_post.sql` | Adds `folder_url`, `minutes_url`, `summary_url`, `transcript_url`, `posted_at`, `post_error` to `meeting_minutes`. |

`posted_at` answers "did the channel ever hear about this meeting". `post_error` records a
rejected card **without** failing the record — the minutes stand whether or not the announcement
landed, which is why no `posted` value was added to `minutes_status` (`ALTER TYPE … ADD VALUE` is
irreversible).

The card builder is deliberately transport-free because its two callers differ:
`run-meeting-once.js` uses `fetch`, the n8n Code node uses `this.helpers.httpRequest`.

**Power Automate answers `202 Accepted`.** Test `r.ok`, never `r.status === 200`.

### The URL is a secret

It carries its own signature in the query string — anyone holding it can post into that channel
without signing in. `.env` and the VPS only. Never git, never a workflow JSON file. Treat it like
the client secret.

## Inbound — not built

Real-time replacement for the 15-minute poll.

- n8n side: `BEXT — Teams Inbound`, an `n8n-nodes-base.webhook` node, POST,
  `path: 'teams-inbound'`, with an **explicit hardcoded `webhookId`** so redeploys do not change
  the URL, and `authentication: 'headerAuth'` against a `BEXT Webhook Auth` credential
  (`N8N_WEBHOOK_CREDENTIAL_ID` in `.env`, mirroring `N8N_PG_CREDENTIAL_ID`).
- Flow side: `BEXT — Transcript Arrived` — see `bext-power-automate`.

**Keep the existing 15-minute schedule trigger** as the licence-free fallback. The inbound flow is
gated on a Power Automate licence; the poll is not.

Full contract in `references/webhook-contract.md`.

## Editing `build-workflows.js`

The repo is the source of truth. The n8n UI is not — anything edited there is overwritten on the
next build.

Read `references/build-workflows-conventions.md` before touching that file. The essentials:

- Workflows are **JS functions returning object literals** — `{ name, nodes, connections, settings }`.
  There are five, assembled at the bottom.
- `deploy(wf)` writes `n8n/workflows/<Name-Slugified>.json`, then matches an existing workflow **by
  name** and PUTs or POSTs, then applies the `BEXT Consultancy` tag. Folders need an enterprise
  licence; tags do not.
- Names are `BEXT — ...` with an em dash. The slug is derived from the name, so renaming a workflow
  orphans its JSON file and creates a second workflow in n8n.
- `--dry` writes JSON without deploying. Use it first, always.
- Guards: the build exits without `N8N_PG_CREDENTIAL_ID`; it skips the report, health and meeting
  workflows without `N8N_SMTP_CREDENTIAL_ID`.

### The inlining trap

`n8n/lib/ingest.js` and `n8n/lib/meeting-card.js` are read from disk and interpolated into
template literals at build time. A backtick or a `${` anywhere in either file — **comments
included** — is evaluated during the build and silently corrupts the copy that reaches n8n.

Single quotes and string concatenation only in those files. No `require`, no `fetch`, no
`process.env`. The corruption is silent: the workflow deploys, then fails at runtime with a syntax
error that does not match the file on disk.

Inside a Code node, environment variables are `$env.NAME`, not `process.env.NAME`.

## After every change

```bash
node n8n/build-workflows.js --dry    # inspect the JSON
node n8n/build-workflows.js          # deploy
git add n8n/workflows && git commit
```

Exporting and committing is a hard project rule, not a courtesy.

## Related

- `bext-power-automate` — creating the flows on the other end of both webhooks
- `bext-graph-pipeline` — what produces the card, and the port that is pending
- `microsoft-teams` — why app-only cannot post, and the tenant facts
- `bext-teams-messaging` — the interactive path. **Never call it from a workflow.**

## References

- `references/webhook-contract.md` — payloads, headers, secrets, failure handling
- `references/build-workflows-conventions.md` — the file's structure and its traps
