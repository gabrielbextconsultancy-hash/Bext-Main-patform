# Webhook contract

Two webhooks, opposite directions, different trust models.

---

## Outbound — n8n → Power Automate → Teams

**Endpoint:** `TEAMS_MEETING_WEBHOOK_URL` (from `.env`; `$env.TEAMS_MEETING_WEBHOOK_URL` inside a
Code node).

**Method:** POST, `Content-Type: application/json`.

**Body:** the Adaptive Card 1.4 envelope returned by `buildMeetingCard(m)`.

```js
const card = buildMeetingCard({
  subject, program, meetingNo, date, time, venue, organiser,
  attendees,          // [{ name }] or [string]
  summary, decisions, // string, [string]
  actions,            // [{ title, owner, due, status, closed }]
  projects, safety,   // [{ status }]
  urls: { folder, minutes, summary, transcript },  // channel copies, not archive
});
```

**Auth:** the URL *is* the credential. It carries its own signature in the query string. There is
no header, no token, no second factor. Anyone holding it can post into that channel.

Consequences:
- `.env` and the VPS only. Never git, never a workflow JSON file, never a log line.
- If it leaks, the fix is recreating the flow — which produces a **different** URL that must be
  redistributed.

**Success is `202 Accepted`.** Test `r.ok`.

### Guards before posting

In order, as implemented in `run-meeting-once.js` stage 6:

1. Any file failed to land → **do not post**. A missing announcement is recoverable; one that
   points at an incomplete record is not.
2. `--no-post` → build the card, do not send.
3. `TEAMS_MEETING_WEBHOOK_URL` unset → skip, and say so plainly.
4. Otherwise post, retrying **twice only**, then give up without failing the run.

The retry budget is deliberately small. A duplicate announcement in a client channel is worse than
a missing one.

### Size

The builder targets a **26 KB** ceiling against a ~28 KB Teams limit, shedding decisions first,
then action rows. A card that fails to post tells the channel nothing at all.

---

## Inbound — Power Automate → n8n

**Endpoint:** `https://bext-n8n.srv1866850.hstgr.cloud/webhook/teams-inbound`

**n8n node:**

```js
{
  name: 'Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  webhookId: '<a fixed uuid, hardcoded>',
  parameters: {
    httpMethod: 'POST',
    path: 'teams-inbound',
    authentication: 'headerAuth',
    responseMode: 'onReceived',
  },
  credentials: { httpHeaderAuth: { id: process.env.N8N_WEBHOOK_CREDENTIAL_ID, name: 'BEXT Webhook Auth' } },
}
```

**`webhookId` must be hardcoded.** n8n generates one per node; letting it regenerate changes the
production URL on every redeploy and silently breaks the flow calling it.

**Auth:** header auth against the `BEXT Webhook Auth` credential. Unlike the outbound direction,
this endpoint is publicly reachable, so it needs a real secret. The credential lives in n8n's
credential store; its id goes in `.env` as `N8N_WEBHOOK_CREDENTIAL_ID`, mirroring the existing
`N8N_PG_CREDENTIAL_ID` pattern.

**Body:** from `BEXT — Transcript Arrived`.

```json
{
  "source": "sharepoint-inbox",
  "driveId": "…",
  "itemId": "…",
  "name": "Weekly check-in.vtt",
  "webUrl": "https://…",
  "createdDateTime": "2026-08-17T04:12:00Z"
}
```

Pass the **driveItem id**, not the file body. The workflow re-fetches with app-only credentials —
which keeps the payload small and means the flow never needs permission to read content.

**Response:** 200 on accept, 403 on a bad or missing header. A 403 must produce **no execution**.

### Fallback

The existing 15-minute schedule trigger stays. Inbound is gated on a Power Automate licence; the
poll is not. Running both is safe as long as the workflow deduplicates on `meeting_id` — which
`MEETING_CODE` already does via the `done` set.

---

## Testing

| Check | How | Expect |
|---|---|---|
| Outbound payload | `node graph/run-meeting-once.js --file x.vtt --print-card` | `scratch/card.json`, under 26 KB |
| Outbound live | same without `--print-card` | `202`, card visible in the channel |
| Inbound accept | drop a `.vtt` in `Inbox/` | flow `Succeeded`; `n8n_executions` shows a matching success |
| Inbound reject | POST with a wrong header token | `403`, **no execution created** |

---

## What not to do

- **Do not call `mcp__teams__*` from a workflow.** Delegated tokens do not survive unattended use.
  It will pass a manual test and fail in production.
- Do not put either URL, or the header token, in a workflow JSON file. Those are committed.
- Do not widen the outbound retry budget.
- Do not remove the schedule trigger when inbound lands.
