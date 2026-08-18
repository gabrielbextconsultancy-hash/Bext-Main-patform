---
name: bext-teams-messaging
description: Sends, reads and searches Microsoft Teams messages and files for BEXT Consultancy through the delegated `teams` MCP server signed in as Admin.bext-automation@bextconsultancy.com.au. Use when asked to post or reply to a Teams channel or chat, announce a completed meeting record in a channel, upload a file to a channel, search Teams messages or mentions, list BEXT teams, channels or members, or when mcp__teams__auth_status reports the server is not authenticated.
---

# BEXT Teams messaging (delegated)

The interactive path. Everything here acts **as `Admin.bext-automation@bextconsultancy.com.au`**,
so anything posted carries that account's name.

This is the only path that can post a Teams message today. App-only Graph cannot, and the Power
Automate route is gated on a licence. Until that gate clears, channel announcements go through
here — which is acceptable because the pipeline's step 9 is a human review step anyway.

**Never reference this skill from an n8n workflow.** The token is tied to a live sign-in. A
scheduled workflow that depends on it will work in testing and fail silently in production. That
direction belongs to `bext-n8n-teams-bridge`.

## Before anything else

```
mcp__teams__auth_status
```

If it returns `❌ Not authenticated`, stop and ask the user to run:

```bash
npx -y @floriscornel/teams-mcp@0.9.0 authenticate
```

This is a device-code sign-in. **The agent must never perform it** — the user completes it in a
browser. Once done, confirm the identity is the automation account and not a personal one:

```
mcp__teams__get_current_user
```

## Posting rules

1. **Get explicit go-ahead before any send, reply, update or delete.** Posting to a client-visible
   Teams channel is outward-facing and not easily undone. Show the exact body first.
2. **Resolve ids; never guess from display names.** `list_teams` → `list_channels` → use the ids.
   Names are not unique and are not stable.
3. **Escape `&`, `<`, `>` and `"`** in anything interpolated into an HTML body. A document title
   containing an ampersand will mangle the message.
4. **Respect the ~28 KB cap.** Post a summary plus a link. Never paste full minutes.
5. **A 403 is usually membership**, not consent. The automation account holds no directory roles,
   which is fine for posting — but it must be a *member* of the team.

## Common tasks

### Find the records channel

```
mcp__teams__list_teams                     → find "bext_transcripts records", take its id
mcp__teams__list_channels(teamId)          → find "Bext Transcripts", take its id
```

Cache both ids for the session. They do not change.

### Announce a filed meeting record

Post after `Minutes.docx` is written — it is written last precisely so the announcement never
points at an incomplete folder.

```
mcp__teams__send_channel_message(
  teamId, channelId,
  message: "<b>Minutes filed — {subject}, {date}</b><br>
            <a href=\"{folderUrl}\">Open the record</a><br>
            {n} actions, {m} open."
)
```

Then verify it landed:

```
mcp__teams__get_channel_messages(teamId, channelId, limit: 1)
```

### Search history

`search_messages` takes KQL. Useful when reconstructing a decision:

```
mcp__teams__search_messages(query: "actions register AND RACV")
mcp__teams__get_my_mentions()
```

### Upload a file

`send_file_to_channel` posts a file into the channel's Files tab. For the meeting record, prefer
filing to SharePoint via `bext-graph-pipeline` and linking to it — that keeps one copy, in the
place the client's process expects.

## Tool catalogue

26 tools, grouped in `references/tool-catalogue.md`. Coverage in one line: messages, chats,
files, search, users and reactions. **Not covered:** creating teams, creating channels, online
meetings, adaptive cards, tabs, apps, webhooks, or anything to do with Power Automate.

If a task needs one of those, it is not this skill:
- flows and Teams Workflows → `bext-power-automate`
- unattended transcript and document work → `bext-graph-pipeline`

## Related

- `microsoft-teams` — path selection, tenant facts, Graph pitfalls
- `bext-n8n-teams-bridge` — the unattended route to a channel post

## References

- `references/tool-catalogue.md` — all 26 tools by group, with the arguments that matter
- `references/posting-rules.md` — escaping, size limits, confirmation, failure modes
