# Meeting workflow — design against the real templates

Supersedes the meeting section of the 11 August plan. Written after reading the actual
`Minutes Template.docx` and `Project Actions Register (Template).xlsx` supplied on 13 August,
which changed three things materially.

## The target

BEXT's involvement begins at **step 9**. Steps 1–8 run unattended:

| Step | Who | Notes |
|---|---|---|
| 1–2 | Client | Meeting held and transcribed in the *client's* tenant, transcript lands in *their* SharePoint |
| 3–4 | Client / BEXT | BEXT granted read-only access; transcript copied into BEXT's environment |
| 5–8 | **Automation** | Extract, populate minutes, update the actions register, draft the email |
| **9** | **BEXT** | Review — first human involvement |
| **10** | **BEXT** | Send |

The client's own description has steps 5–8 done by hand with Copilot, document by document.
Doing them through the API instead is what makes step 9 the first touch rather than the fifth.

## What changed from the 11 August build

### 1. The trigger is a folder, not a calendar

The built workflow polls BEXT's own calendar and pulls transcripts from BEXT's tenant. The
RACV pattern is the opposite: the **client** hosts the meeting, so nothing appears in BEXT's
calendar and BEXT's Graph token has no access to the client's tenant.

**Decision — watch a SharePoint folder.** Transcripts arrive in
`BEXTHQ/API Automation Folder/Meeting Transcripts/Inbox/`, whether dropped by hand, synced from
a client library, or forwarded. The workflow processes any new `.vtt` or `.docx` transcript
found there.

Reasons: it works for every client without needing permissions in their tenant — which most
clients will not grant; it matches steps 3–4 as written; and it degrades gracefully, since a
transcript that arrives by email or download still works.

Calendar polling is kept for meetings BEXT hosts itself. Same downstream pipeline, second
entry point.

### 2. The minutes template is a worked example, not a fillable template

Seven tables, each an outer single-cell table wrapping an inner grid:

| # | Table | Fill |
|---|---|---|
| 1 | Program header | Fields: program, date, time, venue, meeting number, minutes by |
| 2 | Attendees | Loop: name, initials, company, email, apology flag |
| 3 | Safety | Loop: item, detail, owner, due, status |
| 4 | Project Status | Loop: project, phase, status, this week's update, next action, owner, due — plus a DNSP/network line inside the update |
| 5 | Finance & Other Business | Loop: same shape as Safety |
| 6 | Action Register | Loop: mirrors the Excel register |
| 7 | Next Meeting | Single line |

Conversion replaces each example data row with one `{#loop}…{/loop}` row, preserving all
formatting, borders and the status-colour key. The header block becomes named placeholders.
The result is uploaded to `Templates/` and the source is kept in `templates/` for reference.

**Status vocabulary is fixed by the template** — On Track, Monitor, At Risk, On Hold, Complete.
The extraction prompt must return exactly these, not invent its own.

### 3. The Actions Register is cross-meeting state

Columns: Project · Action # · Action Title · Detail · Owner · Company · Date Allocated · Due ·
Actual Completion · Status · Status Comments.

It is a living register, not an output. Each run must compare the transcript against existing
open actions, update status and dates where discussed, mark completions, and append new
actions with the next number *per project* (numbering restarts per project — `RACV_Noosa BESS`
and `RACV_Cobram BESS` both begin at 1).

**Decision — Postgres is master, the .xlsx is generated.** Matching actions across meetings
needs queryable state and a history of what changed when. A spreadsheet rewritten by an
automation while someone has it open in Excel will eventually be corrupted, and there would be
no way to tell an automation edit from a human one. The generated file keeps the supplied
column order and formatting exactly, so nothing changes for the reader.

Matching is by project plus fuzzy title, surfaced for review rather than applied silently —
an action wrongly marked complete is worse than a duplicate.

## Build sequence

1. `templates/build-minutes-template.js` — convert the source .docx to a fillable template, upload it.
2. Migration `010` — `actions` table (project, number, title, detail, owner, company,
   allocated, due, completed, status, comments, source meeting) with per-project numbering.
3. Extraction prompt rewritten to the real structure — the seven sections, the fixed status
   vocabulary, and the DNSP/network convention.
4. `POST /render-xlsx` on the fetcher, matching the existing `/render-docx`.
5. Folder-watch entry point, plus the existing calendar path.
6. Draft email covering: summary, key points, decisions, new actions, outstanding critical
   actions, attachment references — per step 8.

## Open questions

- **Attendee emails.** The template carries an email per attendee; a transcript gives names
  only. Either a per-client attendee list is maintained, or the field is left for review.
- **Which client meetings are in scope** — RACV only at first, or every client from the start.
- **Where the register lives** — one register per client, or one across all projects. The
  supplied file mixes projects, suggesting one.
