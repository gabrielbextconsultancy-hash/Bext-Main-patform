---
name: bext-graph-pipeline
description: Runs and extends BEXT's unattended Microsoft Graph app-only pipeline — meeting intake, Teams transcript download, Gemini extraction, minutes template fill, SharePoint filing, Outlook drafts and the channel card. Use when working on graph/run-meeting-once.js, graph/verify.js, graph/provision-sharepoint.js, n8n/lib/meeting-card.js, the BEXT — Meeting Intake or BEXT — Graph Health workflows, the Minutes Template or the bext_transcripts records channel folders, or when an unattended Graph call returns 401, 403 or an empty transcripts list.
---

# The unattended Graph pipeline

App-only client credentials. No signed-in user, no interactive token. This is the path everything
scheduled runs on.

`graph/run-meeting-once.js` is the working reference implementation — six numbered stages, each
printed, so a bad result at stage 2 stops you wasting time on stages 3 to 6. The n8n workflow
`BEXT — Meeting Intake` runs the same sequence on a schedule with nobody watching.

## Run it

```bash
node graph/run-meeting-once.js              # newest transcript, full run
node graph/run-meeting-once.js --dry        # extract only, file nothing
node graph/run-meeting-once.js --file x.vtt # replay a transcript from disk
node graph/run-meeting-once.js --no-post    # file everything, skip the channel card
node graph/run-meeting-once.js --print-card # write the card payload to scratch/card.json
```

Local runs need the fetcher tunnel — `/render-docx` lives on the VPS loopback:

```bash
ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 root@187.127.213.243 -N
```

`--file` plus `--dry` is the tuning loop: replay one transcript as often as the prompt changes,
without holding another meeting.

## The six stages

| # | Stage | What happens |
|---|---|---|
| 1 | Transcript | `/users/{upn}?$select=id` → **object GUID** → `/users/{id}/calendar/events` → match `onlineMeetings?$filter=JoinWebUrl eq '…'` → `/transcripts` → fetch `?$format=text/vtt` |
| 2 | Extraction | Gemini `gemini-3.6-flash` against `PROMPT`, returning structured JSON |
| 3 | Minutes document | Pull `API Automation Folder/Templates/Minutes Template.docx` from BEXTHQ → POST to `http://127.0.0.1:8080/render-docx` |
| 4 | Filing | Resolve site → drives → `Documents` → `PUT /drives/{id}/root:/{path}:/content`, into **both** the channel folder and the BEXTHQ archive |
| 5 | Draft email | `POST /users/{id}/messages` — an **unsent draft**, never sent |
| 6 | Channel card | `buildMeetingCard(...)` → POST the Adaptive Card to `TEAMS_MEETING_WEBHOOK_URL` |

### Ordering that matters

**`Minutes.docx` is written last, in both locations.** The channel card announces a complete
record; writing minutes last means an announcement never points at a folder holding only a
transcript. Do not reorder stage 4.

**Stage 6 is gated on a clean run.** If any file failed to land, the card is not posted. A missing
announcement is recoverable; a duplicate or a lying one is not. The post retries once and then
gives up rather than failing the run.

**Power Automate answers `202 Accepted`, not `200`.** Check `r.ok`, not `r.status === 200`.

## Sites and paths

| | |
|---|---|
| Archive | `bextconsultancy.sharepoint.com:/sites/BEXTHQ`, base `API Automation Folder` |
| Channel record | `bextconsultancy.sharepoint.com:/sites/bext_transcriptsrecords`, base `Bext Transcripts` |
| Folder per meeting | `{date} {subject}`, holding `Transcript.vtt`, `Minutes.docx`, `Summary.docx` |

Resolve the drive id before addressing a path. Compound paths return 400 — see
`references/traps.md`.

## Extraction

`PROMPT` in `run-meeting-once.js` is the contract. It uses the **template's own status
vocabulary** — `On Track`, `Monitor`, `At Risk`, `On Hold`, `Complete` — and leaves an unowned
action as `Unassigned` rather than guessing an owner.

Verified behaviour on real content: correct statuses, DNSP notes captured, owners attributed, the
deliberately unowned action left unassigned, the closed action closed, small talk dropped. On two
content-free transcripts it returned empty arrays rather than inventing rows. Preserve that — a
prompt change that starts inventing rows is a regression even if it reads better.

## The card builder

`n8n/lib/meeting-card.js` is a **pure function**: it returns the webhook envelope and posts
nothing. Transport is the caller's job, because `run-meeting-once.js` uses `fetch` and the n8n
Code node uses `this.helpers.httpRequest`.

Two constraints on that file, both easy to break:

- **It is inlined into a template literal by `n8n/build-workflows.js`.** A backtick or a `${` 
  anywhere in it — comments included — is evaluated at build time and silently corrupts the copy
  that reaches n8n. Single quotes and string concatenation only. No `require`, no `fetch`, no
  `process.env`.
- **Adaptive Cards 1.4, not 1.5.** The `Table` element is 1.5 and renders inconsistently through
  the Power Automate post action, so tables are hand-built from `ColumnSet`s. The card is built to
  a 26 KB ceiling and sheds detail to reach it, because a card that fails to post says nothing at
  all.

## Known state

- `BEXT — Graph Health` — active, daily 06:00, writes `integration_health`, mails on failure.
- `BEXT — Meeting Intake` — **deployed but inactive**, and still holds an older five-field
  `MEETING_CODE`. Porting `run-meeting-once.js` into it is the next job. Keep it inactive until one
  scheduled run has been watched.
- **Transcript dedup is unsolved.** Two Teams clients in one call produce near-duplicate lines
  ("rate cards" / "read cards"). The prefix match in `b2077d6` does not work; it needs real
  similarity matching. Do not assume it is handled.
- **Excel actions register** — schema exists, generation does not.

## Related

- `microsoft-teams` — path selection, tenant facts, Graph pitfalls
- `bext-n8n-teams-bridge` — the webhook contract and `build-workflows.js` conventions
- `bext-power-automate` — creating the announcement flow that owns `TEAMS_MEETING_WEBHOOK_URL`

## References

- `references/pipeline-walkthrough.md` — the six stages in detail, with the calls
- `references/sharepoint-paths.md` — sites, drives, folder layout, resolution order
- `references/traps.md` — object GUIDs, compound paths, `202`, empty transcripts
