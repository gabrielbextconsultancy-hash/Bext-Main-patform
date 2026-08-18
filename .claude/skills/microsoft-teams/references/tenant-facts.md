# BEXT tenant reference

Identifiers only. Secrets live in `.env` and the n8n credential store, never here.

## Tenant and app

| Item | Value |
|---|---|
| Tenant id | `9eb458d1-317d-4aae-a9a3-bb68e430d701` |
| Domain | `bextconsultancy.com.au` |
| App registration | `BEXT Automation (Dev)` |
| Client id | `b72d1df4-06ec-4390-937a-1293f34d31be` |
| Client secret | `MS_CLIENT_SECRET` in `.env` |
| Application access policy | `BEXT-Automation-Policy`, granted `-Global` |

## Accounts

| Account | Role | Notes |
|---|---|---|
| `Admin.bext-automation@bextconsultancy.com.au` | automation service account | **No directory roles.** Teams Administrator is an open item with Brent. Signs in for the delegated teams-mcp path. |
| `MS_SENDER_UPN` (in `.env`) | sends the 05:00 daily report | Its `O365 Business Premium` licence shows 0 purchased / 1 assigned — lapsed, and an open client item. |

## Teams and SharePoint

| Item | Value |
|---|---|
| Records team | `bext_transcripts records` |
| Records channel | `Bext Transcripts` |
| Records site | `/sites/bext_transcriptsrecords` |
| Records library | `Documents` |
| Archive site | `bextconsultancy.sharepoint.com:/sites/BEXTHQ` |

One folder per meeting, named `{date} {subject}`, holding `Transcript.vtt`, `Minutes.docx` and
`Summary.docx`. `Minutes.docx` is written **last** so a channel announcement never points at a
half-filed record.

## Application permissions

Ten permissions are consented on the app registration. The authoritative list, with the reason
each one is needed and a troubleshooting table, is `graph/app-registration.md`. The ones that
matter most often:

- `User.Read.All` — user lookup, licence details
- `Mail.Send`, `Mail.ReadWrite` — the daily report and the meeting draft
- `Sites.ReadWrite.All` — SharePoint filing
- `OnlineMeetingTranscript.Read.All` — meeting transcripts
- `Channel.Create`, `ChannelMessage.Read.All`, `Teamwork.Migrate.All` — the Teams read surface

**There is no application permission for sending a channel message.** Do not go looking for one.

## The four gates

Recorded in full in the parent `SKILL.md`. Summary: admin consent, application access policy
granted `-Global`, the tenant *Transcript API access → Microsoft Graph access* control (added
late July 2026, off by default), and transcription enabled on the meeting policy. All four are
cleared; all four can regress; re-granting any of them needs a directory role the automation
account does not have.

## Related infrastructure

| Item | Value |
|---|---|
| n8n | `https://bext-n8n.srv1866850.hstgr.cloud`, docker project `bext` at `/docker/bext` |
| Dashboard | `https://bext.dev-environment.site` |
| Fetcher (`/render-docx`) | `127.0.0.1:8080` on the VPS; local runs need an SSH tunnel |
| Workflow naming | `BEXT — ...`, tagged `BEXT Consultancy` |

Never touch docker project `n8n` at `/docker/n8n`, or the `n8n-pf` / `hostinger-pf` /
`supabase-pf` MCP servers. That is a different client on the same VPS.
