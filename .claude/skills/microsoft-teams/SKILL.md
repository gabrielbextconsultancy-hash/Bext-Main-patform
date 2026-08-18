---
name: microsoft-teams
description: Routes Microsoft Teams, Microsoft 365 and Microsoft Graph work on the BEXT tenant (bextconsultancy.com.au) to the correct authentication path. Use when posting or reading Teams channel or chat messages, listing teams and channels, working with online meetings or meeting transcripts, adding or consenting Graph permissions, debugging 401, 403, 404 or 429 responses from graph.microsoft.com, running graph/verify.js, or choosing between app-only client credentials, the delegated teams-mcp server and Power Automate.
---

# Microsoft Teams on the BEXT tenant

Start here for any Teams, Microsoft 365 or Graph work. This skill decides *which* of the three
authentication paths a task needs, then hands off to the skill that owns that path.

Picking the wrong path is the most common way to waste an hour here: app-only credentials cannot
post a channel message no matter how the request is shaped, and the delegated server cannot run
inside a scheduled workflow. Both failures look like a permissions bug and are not.

## Tenant facts

| | |
|---|---|
| Tenant | `9eb458d1-317d-4aae-a9a3-bb68e430d701` (bextconsultancy.com.au) |
| App registration | `BEXT Automation (Dev)`, client `b72d1df4-06ec-4390-937a-1293f34d31be` |
| Automation account | `Admin.bext-automation@bextconsultancy.com.au` — **no directory roles** |
| Records team | `bext_transcripts records`, channel `Bext Transcripts` |
| Records site | `/sites/bext_transcriptsrecords`, library `Documents` |
| Archive site | `bextconsultancy.sharepoint.com:/sites/BEXTHQ` |

Ten application permissions are consented. Full list and the troubleshooting table live in
`graph/app-registration.md`.

## Choose the path

```
Does the work run unattended (n8n, cron, a scheduled workflow)?
├── yes → app-only client credentials .......... skill: bext-graph-pipeline
│         Reads transcripts, files documents, drafts mail.
│         CANNOT post a channel message.
│         └── needs to post? → route through Power Automate
│                              skill: bext-n8n-teams-bridge
└── no  → is it creating or editing a Power Automate flow / Teams Workflow?
          ├── yes → az login + FlowAgent MCP ... skill: bext-power-automate
          └── no  → delegated teams-mcp ........ skill: bext-teams-messaging
                    Posts, reads, searches, uploads, as the automation account.
```

### The three paths

| # | Path | Credential | Identity | Owned by |
|---|---|---|---|---|
| 1 | Graph app-only | `MS_CLIENT_ID` / `MS_CLIENT_SECRET` in `.env` | the app itself | `bext-graph-pipeline` |
| 2 | teams-mcp delegated | device-code token cached in `~/.teams-mcp-token-cache.json` | `Admin.bext-automation@` | `bext-teams-messaging` |
| 3 | FlowAgent | `az login` | the signed-in work account | `bext-power-automate` |

Path 2 and path 3 both require an interactive sign-in that **the user performs, never the agent**.
See `references/auth-matrix.md` for the exact commands and what to do when a path reports
unauthenticated.

## The four Teams gates

All four are cleared, each was found the hard way, and each can regress independently. If
transcripts suddenly return empty, walk these in order before suspecting the code:

1. **Admin consent** on the ten application permissions — granted by Brent.
2. **Application access policy**, granted `-Global` via `graph/teams-access-policy.ps1`.
3. **Tenant control *Transcript API access → Microsoft Graph access*** — added by Microsoft in
   late July 2026 and **off by default**. Not visible in the app registration; it lives in the
   Teams admin centre.
4. **Transcription enabled** on the meeting policy. This produced output on only two of five
   attempts before settling, so treat a regression here as plausible.

Gates 1, 2 and 3 need a Teams Administrator or Global Administrator. `Admin.bext-automation@`
holds no directory roles, so re-granting any of them is a client escalation, not a task you can
complete. That role is still an open item with Brent.

## Before you debug

Run the cheap checks first. Most "Graph is broken" reports are one of these:

```bash
node graph/verify.js
```

Four checks in dependency order — token, user lookup, sendMail, sites search. The first failure
names the step of `graph/app-registration.md` that went wrong.

For the delegated path, `mcp__teams__auth_status` answers in one call whether a sign-in is even
present.

## Known traps

Read `references/graph-pitfalls.md` before writing any new Graph call. The short version:

- The **meetings API rejects a UPN** and needs the user's object GUID. Mail and calendar accept a
  UPN, which makes this inconsistency easy to miss.
- **SharePoint compound paths return 400.** Resolve the drive id first, then address the path.
- **No application permission exists for posting channel messages.** This is a platform gap, not
  a consent gap — stop looking for the permission to add.
- **404 often means "not permitted to see"**, not "does not exist". Do not report a resource as
  missing on a 404 alone.
- Always follow `@odata.nextLink`. A single page is not the whole answer.
- Honour `Retry-After` on 429 with jittered backoff.
- Teams messages cap at roughly 28 KB. Long minutes must be chunked or linked, not pasted.

## Related skills

- `bext-teams-messaging` — posting, reading, searching, uploading via the delegated server
- `bext-graph-pipeline` — the unattended meeting → minutes → SharePoint → draft pipeline
- `bext-power-automate` — creating and operating cloud flows and Teams Workflows
- `bext-n8n-teams-bridge` — wiring n8n workflows to Teams in both directions

## References

- `references/auth-matrix.md` — the three paths in full, with sign-in commands and failure modes
- `references/tenant-facts.md` — ids, sites, teams, permissions, accounts
- `references/graph-pitfalls.md` — pagination, status codes, throttling, size limits
