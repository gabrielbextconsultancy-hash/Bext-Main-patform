# Flow recipes

Both BEXT flows in full. Create them with FlowAgent; keep `docs/TEAMS-WEBHOOK-SETUP.md` as the
manual fallback and as the definition of what correct looks like.

Sign in as `Admin.bext-automation@bextconsultancy.com.au` before creating either. **Whoever signs
in owns the flow permanently.** Confirm with `az account show`.

---

## `BEXT — Channel Post Bridge` (outbound)

Announces a filed meeting record in the Teams channel. This is what
`TEAMS_MEETING_WEBHOOK_URL` points at.

**Build it with `graph/create-channel-flow.js`, not by hand.** That script already carries the
ids discovered from the tenant's existing SharePoint→Teams flow:

```
environment  Default-9eb458d1-317d-4aae-a9a3-bb68e430d701
owner        Admin.bext-automation@bextconsultancy.com.au
connection   shared-teams-1381069787544875a2bbda2eda56a5f4
team         36840697-dbe5-4294-994d-7a043eef51ca      (bext_transcripts records)
channel      19:R7FciH4QRVZU7_7EVUg3CH_zCmSIHOoVxrRAM_nFeBA1@thread.tacv2  (Bext Transcripts)
```

It writes `flows/BEXT-Channel-Post-Bridge.json` and stores the trigger URL into `.env` under
`TEAMS_MEETING_WEBHOOK_URL`. The manual equivalent below is the fallback and the specification.

**Template (manual route):** *"Post to a channel when a webhook request is received"*

**Not** *"Post a **message** to a channel when a webhook request is received"*. The message
variant takes plain text (`{"text": "…"}`) and renders our Adaptive Card as nothing, or as raw
JSON. The word that matters is **card** versus **message**.

Microsoft rewords these template names periodically. If neither matches exactly, pick the one
whose description mentions posting an *adaptive card*, and record which name you saw.

| | |
|---|---|
| Trigger | When a Teams webhook request is received |
| Team | `bext_transcripts records` |
| Channel | the announcements channel |
| Action | Post the received card |
| Returns | An HTTPS POST URL |

**The URL is a secret.** It carries its own signature in the query string — anyone holding it can
post into that channel without signing in. It goes into `.env` and onto the VPS, never into git
and never into a workflow file.

Copy it *before* dismissing the creation dialog. Retrieving it later is possible but fiddly.

### Callers — already written

- `graph/run-meeting-once.js` stage 6, guarded on a clean run
- `n8n/lib/meeting-card.js` builds the Adaptive Card 1.4 payload
- `MEETING_CODE` in `n8n/build-workflows.js` — **not yet**; this is part of the port

Nothing further is needed on the sending side.

### Verifying it

```bash
node graph/run-meeting-once.js --file scratch/sample.vtt --print-card
```

Inspect `scratch/card.json`, then run without `--print-card` and check the channel. Expect
`202 Accepted` — not `200`.

---

## `BEXT — Transcript Arrived` (inbound)

Real-time replacement for the 15-minute poll. **Keep the schedule trigger as the licence-free
fallback** — do not remove it when this lands.

| | |
|---|---|
| Trigger | When a file is created |
| Site | BEXTHQ |
| Folder | `API Automation Folder/Meeting Transcripts/Inbox/` |
| Action | HTTP POST the driveItem id to the n8n webhook |

Target: `https://bext-n8n.srv1866850.hstgr.cloud/webhook/teams-inbound`, with the shared-secret
header the n8n webhook credential expects. See `bext-n8n-teams-bridge` for the contract.

This is the folder-watch entry point `docs/meeting-workflow-v2.md` §1 calls for.

### Optional, once proven

A Teams **message action** Workflow — "Send to BEXT" on the ⋯ menu of any message — posting to the
same webhook. Useful for pulling an ad-hoc decision into the record. Do not build it before the
file trigger is stable.

---

## Exporting and committing

Every flow definition goes to `flows/*.json`, committed. The portal is not the source of truth.

Redact before committing:

- the trigger URL, including its signature query string
- any shared secret
- connection ids, if they embed a tenant-specific identifier

Replace each with `<redacted>` and note in the file where the real value lives (`.env` key name).

## Lifecycle

| Task | Approach |
|---|---|
| Change behaviour | Edit → publish → re-export to `flows/` → commit |
| Pause | **Disable**, do not delete |
| Investigate a failure | Run history → the failed action → its inputs and outputs |
| Suspected connection problem | Check connection health first; a broken connection presents as a logic error |

**Never delete the outbound flow.** Deleting invalidates `TEAMS_MEETING_WEBHOOK_URL`, and
recreating produces a *different* URL that must then be redistributed to `.env` and the VPS.
Disabling costs nothing and is reversible.
