---
name: bext-power-automate
description: Builds and operates Microsoft Power Automate cloud flows and Teams Workflows for BEXT through the vendored FlowAgent MCP server, authenticated with az login. Use when asked to create, edit, publish, disable or delete a Power Automate flow, to create or repair the Teams announcement webhook behind TEAMS_MEETING_WEBHOOK_URL, to post a Teams channel message from an automation (app-only Graph cannot), to trigger n8n from a SharePoint or Teams event, to inspect flow run history or connection health, or to check whether a Power Platform environment and licence exist.
---

# Power Automate and Teams Workflows

"Workflows" inside the Teams client are Power Automate cloud flows. Nothing in Teams itself
authors them, and Microsoft Graph has no endpoint that creates one. This skill is the only path
in the repo that can.

Server key `flowagent` in `.mcp.json`, vendored at `vendor/flowagent/mcp.mjs`. 50+ tools.

## Three ways to create a flow — use them in this order

### 1. `graph/create-channel-flow.js` — for the announcement flow specifically

The repo already has a purpose-built script for `BEXT — Channel Post Bridge`. Prefer it: it
encodes the connection, team and channel ids discovered from the tenant's existing
SharePoint→Teams flow, so they are known good rather than guessed.

```bash
node graph/discover-power-platform.js       # must print GO first
node graph/create-channel-flow.js --dry     # print the definition, create nothing
node graph/create-channel-flow.js           # create it, store the trigger URL in .env
node graph/create-channel-flow.js --url     # re-read the existing flow's URL
```

It calls `api.flow.microsoft.com/providers/Microsoft.ProcessSimple` on the user's own `az login`,
writes the definition to `flows/BEXT-Channel-Post-Bridge.json`, and refuses to run as anyone other
than the intended owner — because whoever `az` is signed in as owns the flow permanently.

### 2. FlowAgent MCP — for everything else

The general-purpose path: list, get, create, edit, copy, publish, disable, delete, run history,
diagnosis, connections, desktop flows.

### 3. `docs/TEAMS-WEBHOOK-SETUP.md` — the manual fallback

A five-minute click-through in the Teams UI. Keep it: it is the record of what the flow must look
like, and the route that still works when the APIs do not.

None of these remove the prerequisites. Those are still Brent's — see below.

## Sign in first

Check before assuming:

```bash
az account show
```

Expect `Admin.bext-automation@bextconsultancy.com.au` on tenant
`9eb458d1-317d-4aae-a9a3-bb68e430d701`, `"name": "N/A(tenant level account)"`. **On this machine
that is already true.**

If it is not, **the user runs this. The agent must never perform a sign-in.**

```bash
az login --tenant 9eb458d1-317d-4aae-a9a3-bb68e430d701 --allow-no-subscriptions
```

`--allow-no-subscriptions` is required, not cosmetic. This tenant has no Azure subscription, and
FlowAgent maps the CLI's `No subscription found` to "not signed in" — so a plain `az login`
reports a misleading authentication failure.

## Gate before you build

Run the gate before proposing any flow work. Creating a flow into a tenant with no environment or
no licence fails late and confusingly.

```bash
node graph/discover-power-platform.js
```

Three checks, one GO/NO-GO line:

1. **Licence** — a Power Automate service plan provisioned on the flow owner. **This passes.**
   `Admin.bext-automation@` holds `FLOW_O365_P1` on Business Premium + Copilot, provisioned.
2. **Environment** — at least one Power Platform environment. Needs `az login` first.
3. **Membership** — the automation account can see `bext_transcripts records`. Reported, not
   tested: only the delegated path can answer it.

The flow uses only the **standard Microsoft Teams connector**, which the seeded Microsoft 365 plan
covers. **No premium Power Automate seat is required.**

**The lapsed `O365 Business Premium` in `docs/HANDOFF.md` is a different account** — the report
sender mailbox. It is a real problem for the 05:00 daily report and it is not a blocker here. Do
not let the two get conflated into "Power Automate is licence-blocked", because that was the
working assumption and it is wrong.

### Brent's prerequisites

From `docs/BRENT-TEAMS-ADMIN.md`, items 1–3, all admin-only:

1. **Workflows app allowed** in Teams admin centre. If it is blocked, the ⋯ → Workflows menu is
   simply absent — which reads as "the menu is missing", not as a permission error.
2. **Licensing confirmed** on the account that will own the flow.
3. **Team membership** for that account.

## Flow ownership

Whoever signs in when the flow is created **owns it permanently**. Posts show as coming from
them, and the flow stops if that account is disabled or loses its licence.

That account must be `Admin.bext-automation@bextconsultancy.com.au`, never a personal one. Check
`az account show` before creating anything.

## The two flows

### `BEXT — Channel Post Bridge` (outbound, exists in design, not yet created)

Template: **"Post to a channel when a webhook request is received"**.

Not the near-identical *"Post a **message** to a channel…"* — that one takes plain text and
renders our Adaptive Card as nothing or as raw JSON. The word that matters is **card** versus
**message**.

- Trigger: *When a Teams webhook request is received*
- Action: post the received Adaptive Card to `bext_transcripts records` › the announcements channel
- Returns: an HTTPS POST URL → `TEAMS_MEETING_WEBHOOK_URL` in `.env`

Callers already exist: `graph/run-meeting-once.js` stage 6, and `n8n/lib/meeting-card.js` builds
the payload. Nothing else needs writing on the sending side.

### `BEXT — Transcript Arrived` (inbound, not built)

- Trigger: *When a file is created* on BEXTHQ › `API Automation Folder/Meeting Transcripts/Inbox/`
- Action: HTTP POST the driveItem id to the n8n webhook

This is the real-time entry point `docs/meeting-workflow-v2.md` §1 describes. The existing
15-minute schedule trigger stays as the licence-free fallback — do not remove it.

See `bext-n8n-teams-bridge` for the webhook contract on the n8n side.

## Repo hygiene

- Export every flow definition to `flows/*.json` and commit it. The portal is not the source of
  truth; the repo is.
- **Redact the trigger URL and any shared secret** before committing. The webhook URL carries its
  own signature in the query string — anyone holding it can post into the channel without signing
  in. Treat it exactly like the client secret: `.env` and the VPS only.
- Name flows `BEXT — ...`, matching the n8n convention.

## Operating flows

| Task | Approach |
|---|---|
| Is it running? | List flows, check state, then read run history |
| A run failed | Pull the run, drill into the failed action, read its inputs and outputs |
| Connection broken | Check connection health before assuming the flow logic changed |
| Change the flow | Edit, then publish. Re-export to `flows/` and commit |
| Stop it safely | Disable rather than delete — deletion loses the trigger URL |

Deleting the outbound flow invalidates `TEAMS_MEETING_WEBHOOK_URL`, and recreating it produces a
**different** URL that must be redistributed to `.env` and the VPS. Disable instead.

## `pac` CLI is not required

FlowAgent needs Node 18+ and `az` only. The `pac` CLI is used by the *other* plugins in the
power-platform-skills marketplace for solution and ALM work. Flow create, edit, publish and debug
are unblocked without it.

## Related

- `microsoft-teams` — path selection and tenant facts
- `bext-n8n-teams-bridge` — the webhook contract in both directions
- `bext-graph-pipeline` — what produces the card this flow posts
- `docs/TEAMS-WEBHOOK-SETUP.md` — the manual fallback, and the definition of correct
- `docs/BRENT-TEAMS-ADMIN.md` — the admin prerequisites

## References

- `references/discovery-gate.md` — what the gate checks and how to read its output
- `references/flow-recipes.md` — both flows in full, with triggers, actions and redaction
- `references/licence-failures.md` — how licence and environment problems actually present
