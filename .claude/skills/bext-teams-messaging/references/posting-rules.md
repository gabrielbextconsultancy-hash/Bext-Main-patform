# Posting rules

Anything sent from here appears in a client-visible channel under the automation account's name.
Treat every write as outward-facing.

## Confirm before sending

Show the user the resolved team, the resolved channel and the exact body. Wait for a clear yes.
Approval for one message does not carry to the next.

This applies to `send_channel_message`, `reply_to_channel_message`, `update_channel_message`,
`delete_channel_message`, `send_chat_message`, `create_chat`, `send_file_to_channel` and
`send_file_to_chat`.

## Escaping

Message bodies are markdown sanitised into HTML. Escape interpolated values:

```js
const esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
```

The realistic failure here is a meeting subject or document title containing `&` — the message
truncates or mangles at that point rather than erroring.

## Size

Roughly **28 KB** per message. Minutes exceed it.

The pattern that works: a short summary, the counts that matter, and a link to the filed record.

```
<b>Minutes filed — Weekly check-in, 14 August 2026</b><br>
<a href="https://…/Bext%20Transcripts/2026-08-14%20Weekly%20check-in">Open the record</a><br>
7 actions, 3 open. Safety: On Track. Finance: Monitor.
```

If a long body is genuinely required, chunk it and post sequential replies in a thread rather
than one oversized message — but prefer the link.

## Ordering

Post **after** `Minutes.docx` is written. The pipeline writes it last on purpose, so an
announcement never points at a folder holding only a transcript.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `❌ Not authenticated` | No cached token, or it expired | User re-runs `authenticate`. Never the agent. |
| Signed in as the wrong account | A personal sign-in cached first | User runs `logout`, then `authenticate` as `Admin.bext-automation@`. |
| `403` on send | The account is not a member of the team | Membership, not consent. Escalate to Brent. |
| `404` on a team that exists | Same — not permitted to see it | Do not report the team as missing. |
| Message renders as literal HTML | Body sent with the wrong content type | Send markdown, or valid escaped HTML. |
| Card does not render | Adaptive cards are not supported on this path | Post a link, or use a flow (`bext-power-automate`). |
| `429` | Throttled | Honour `Retry-After` with jitter, bounded retries. |

## What not to do

- Do not call these tools from an n8n workflow. Delegated tokens do not survive unattended use.
- Do not paste document contents into a channel.
- Do not delete a message to fix a typo — edit it, or post a correction. Deletions are visible as
  removals and read worse than a correction.
- Do not guess team or channel ids from names.
