# Teams webhook — links, and who does what

When a meeting is processed, the pipeline files `Transcript.vtt`, `Minutes.docx` and `Summary.docx`
into a folder in SharePoint. The last step announces it: an Adaptive Card in the **Bext Transcripts**
channel carrying the date, time, summary, decisions and actions, with buttons that open each document
in Teams.

Code cannot post to a channel on its own — Microsoft publishes no application permission for it. A
Power Automate flow does it, and its trigger URL becomes `TEAMS_MEETING_WEBHOOK_URL`.

**Tenant state, verified 18 August 2026:** licence, environment, team membership, Teams Administrator
role and the Teams connector are all in place. See
**[BRENT-TEAMS-ADMIN.md](BRENT-TEAMS-ADMIN.md)**. Brent has been added to the team, so the card has an
audience.

---

## The links

| Purpose | URL |
|---|---|
| Power Automate — My flows (the flow lives here) | <https://make.powerautomate.com/environments/Default-9eb458d1-317d-4aae-a9a3-bb68e430d701/flows> |
| Power Automate — connections | <https://make.powerautomate.com/connections> |
| Teams admin centre — manage teams and members | <https://admin.teams.microsoft.com/teams/manage> |
| Teams admin centre — allowed apps | <https://admin.teams.microsoft.com/policies/manage-apps> |
| Teams admin centre — meeting policies (transcription gate) | <https://admin.teams.microsoft.com/policies/meeting> |
| M365 admin — subscriptions / licences | <https://admin.microsoft.com/#/subscriptions> · <https://admin.microsoft.com/#/licenses> |
| Entra — app registration and consent | <https://entra.microsoft.com> |
| The channel's document library | `/sites/bext_transcriptsrecords` › `Documents` › `Bext Transcripts` |

Tenant `9eb458d1-317d-4aae-a9a3-bb68e430d701` · team `bext_transcripts records` · channel
**Bext Transcripts** (the only channel) · flow owner `Admin.bext-automation@bextconsultancy.com.au`.

---

## Route A — let the repo create it (recommended)

Reproducible, committed, and it reuses the existing Teams connection, so **no consent prompt**.

```bash
node graph/discover-power-platform.js
```

Must print **GO**. It checks the flow owner's Power Automate licence, that an environment exists, and
reminds you to confirm team membership.

```bash
node graph/create-channel-flow.js --dry
```

Prints the exact flow definition and creates nothing.

```bash
node graph/create-channel-flow.js
```

Creates `BEXT — Meeting Report`, writes the trigger URL straight into `.env` (never printed),
and exports a redacted `flows/BEXT-Meeting-Report.json`.

It refuses to run unless `az` is signed in as the automation account — flow ownership is permanent —
and refuses to create a second copy if one already exists.

**Prerequisite, run by you, not by the agent:**

```bash
az login --tenant 9eb458d1-317d-4aae-a9a3-bb68e430d701 --allow-no-subscriptions
```

`--allow-no-subscriptions` is required, not cosmetic: on a subscription-less tenant a plain `az login`
reports a misleading authentication failure.

---

## Route B — the manual click-through

Kept as the fallback and as the definition of what correct looks like.

1. Teams → team **bext_transcripts records** → hover the **Bext Transcripts** channel →
   **⋯ (More options) → Workflows**.
   *If Workflows is missing, use the app rail: **⋯ → Workflows → + New flow → See more templates**.*
2. Choose **“Post to a channel when a webhook request is received”**.
   > ⚠️ **Not** the near-identical **“Post a message to a channel…”** — that variant takes plain text
   > and renders the card as nothing or as raw JSON. **Card**, not **message**.
3. **Next** → confirm the **Microsoft Teams** connection. Whoever signs in **owns the flow
   permanently** — use `Admin.bext-automation@bextconsultancy.com.au`.
4. **Next** → **Team** = `bext_transcripts records`, **Channel** = `Bext Transcripts`.
5. **Create flow** → **copy the HTTPS POST URL** before dismissing the dialog.

Find it again: <https://make.powerautomate.com> → **My flows** → the flow → **Edit** → trigger
**When a Teams webhook request is received** → the **HTTP URL** field.

**Send me:**

```
TEAMS_MEETING_WEBHOOK_URL=
```

This URL is a **secret** — it carries its own signature, so anyone holding it can post into the channel
without signing in. It goes into `.env` and onto the VPS only. Never into git, never into a workflow
file.

---

## Never delete the flow

Deleting invalidates the trigger URL permanently, and recreating mints a **different** one that must be
redistributed to `.env` and the VPS. **Disable** instead — it costs nothing and is reversible.

---

## What you'll see when it works

A card per meeting carrying the subject and program, status chips (meeting number, date, actions open,
actions closed, projects at risk), the date/time/venue/organiser, attendees, the summary, the decisions,
an actions table with owner and due date, and four buttons: **Open meeting folder**, **Minutes.docx**,
**Summary.docx**, **Transcript.vtt**. The buttons open in Teams' own viewer — no download, no leaving
Teams, no sharing links to manage.

---

## What was actually built — 18 August 2026

`BEXT — Meeting Report`, flow id `bbe06a8c-b747-851e-40e7-f1be6157edbc`, **Started**, created
programmatically and verified by a real card landing in the channel.

Four things cost time and are worth not rediscovering:

1. **The generic HTTP trigger is premium.** `kind: "Http"` fails with `MissingAdequateQuotaPolicy`.
   `kind: "TeamsWebhook"` is standard-tier and is the one to use.
2. **The leading `@` on the expression is load-bearing.** The designer stored
   `triggerBody()?['attachments'][0]['content']` without it, which Power Automate treats as a literal
   string — the channel would have received the expression text instead of a card.
3. **Flows can be created but not updated** through the API in this tenant. Every update routes
   through Dataverse and demands `host.connectionReferenceName`, which neither the REST API nor the
   FlowAgent MCP would supply. Create a replacement rather than fighting an update.
4. **`triggerAuthenticationType: "Tenant"` rejects app-only tokens** with `MisMatchingOAuthClaims`.
   Entra issues the audience as `https://service.flow.microsoft.com` and the policy demands the
   trailing slash. `"Anonymous"` mints a self-signing URL instead, which is what is in use.

Because the trigger is `Anonymous`, **the URL is a bearer secret** — anyone holding it can post to the
channel. It lives only in `.env` and on the VPS. `graph/run-meeting-once.js` decides whether to attach
a token by looking for `sig=` in the URL, so switching the trigger to tenant auth later needs no code
change.

## Status

| # | Item | Status |
|---|---|---|
| 1 | Licence, environment, membership, roles | verified 18 Aug |
| 2 | Brent added to `bext_transcripts records` | done |
| 3 | Flow created and started | done — `bbe06a8c-…` |
| 4 | `TEAMS_MEETING_WEBHOOK_URL` in `.env` | done (296 chars, signed) |
| 5 | Card renders in the channel | **verified** — posted 07:26, attachment type `application/vnd.microsoft.card.adaptive` |
| 6 | Full end-to-end run from a transcript | not yet — needs the fetcher tunnel on `127.0.0.1:8080` |
| 7 | `MEETING_CODE` ported so n8n posts it too | not started |
