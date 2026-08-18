# teams-mcp tool catalogue

Server key `teams`, package `@floriscornel/teams-mcp@0.9.0`, pinned in `.mcp.json`.
All tools are prefixed `mcp__teams__`.

## Authentication and identity

| Tool | Use |
|---|---|
| `auth_status` | First call of any Teams session. Returns authenticated or not. |
| `get_current_user` | Confirms *which* account is signed in. Check this is `Admin.bext-automation@`. |

## Users

| Tool | Use |
|---|---|
| `search_users` | Find a person by name or partial address. |
| `get_user` | Full profile from an id or UPN. |
| `search_users_for_mentions` | Resolve a name to the mention payload a message body needs. |

## Teams and channels

| Tool | Use |
|---|---|
| `list_teams` | Teams the signed-in account is a **member** of. A missing team means a membership gap, not a permission gap. |
| `list_channels` | Channels within a team id. |
| `list_team_members` | Membership of a team. |

## Channel messages

| Tool | Use |
|---|---|
| `get_channel_messages` | History, newest first. Take `limit` seriously — channels are long. |
| `get_channel_message_replies` | The thread under one message. |
| `send_channel_message` | **Write.** Needs explicit user go-ahead. |
| `reply_to_channel_message` | **Write.** Threaded reply. |
| `update_channel_message` | **Write.** Edits in place; the edit is visible to members. |
| `delete_channel_message` | **Write.** Prefer editing to a correction note over deleting. |
| `set_channel_message_reaction` / `unset_channel_message_reaction` | Reactions. |
| `send_file_to_channel` | Uploads to the channel's Files tab. |

## Chats

| Tool | Use |
|---|---|
| `list_chats` | The account's chats. |
| `get_chat_messages` | History of one chat. |
| `send_chat_message` | **Write.** |
| `create_chat` | **Write.** Starts a new chat with named participants. |
| `update_chat_message` / `delete_chat_message` | **Write.** |
| `set_chat_message_reaction` / `unset_chat_message_reaction` | Reactions. |
| `send_file_to_chat` | Uploads into a chat. |

## Content and search

| Tool | Use |
|---|---|
| `search_messages` | KQL across messages the account can see. |
| `get_my_mentions` | Where the account was @-mentioned. |
| `download_message_hosted_content` | Inline images and hosted content from a channel message. |
| `download_chat_hosted_content` | The same, for chats. |

## Not available here

Creating teams. Creating channels. Online meetings. Adaptive cards — bodies are markdown
sanitised to HTML, so a card payload will not render. Tabs, installed apps, webhooks. Anything
Power Automate.

For those, see `bext-power-automate` (flows, and cards posted by a flow) or accept the gap.

## Write-tool safety

None of the write tools are in the `.claude/settings.json` allowlist, deliberately. Each send,
edit or delete prompts. That is the intended friction — these post to a client-visible channel.
