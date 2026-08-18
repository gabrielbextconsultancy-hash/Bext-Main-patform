# Pipeline walkthrough

The six stages of `graph/run-meeting-once.js`, with the calls each makes. The n8n workflow
`BEXT — Meeting Intake` runs the same sequence unattended.

## 0. Token

```
POST https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/token
  client_id={MS_CLIENT_ID}&client_secret={MS_CLIENT_SECRET}
  &scope=https://graph.microsoft.com/.default&grant_type=client_credentials
```

Wrapped in `retry()` — four attempts by default. Every Graph call goes through a `graph()` helper
that reuses the token and normalises errors.

## 1. Transcript

```
GET /users/{MS_SENDER_UPN}?$select=id,displayName        → me.id  (the object GUID)
GET /users/{me.id}/calendar/events                        → find the meeting
GET /users/{me.id}/onlineMeetings?$filter=JoinWebUrl eq '{ev.onlineMeeting.joinUrl}'
GET /users/{me.id}/onlineMeetings/{meeting.id}/transcripts
GET {transcript.contentUrl}?$format=text/vtt              → the VTT body
```

**The UPN must be exchanged for the object GUID first.** The online meetings endpoint rejects a
UPN even though mail and calendar accept one. This is the single most common stage-1 failure.

The match is on `JoinWebUrl`, not subject or time — subjects repeat weekly and times shift.

An empty `transcripts` array is not automatically a bug. Check gates 3 and 4 in the
`microsoft-teams` skill before touching code.

## 2. Extraction

One call to Gemini `gemini-3.6-flash` with `PROMPT`, returning structured JSON:

```
{ program, meeting_no, date, time, venue,
  attendees[], summary, decisions[], actions[], projects[], safety[] }
```

`--dry` stops here. This is where prompt tuning happens: replay a saved transcript with
`--file x.vtt --dry` as often as needed.

The status vocabulary is the template's own — `On Track`, `Monitor`, `At Risk`, `On Hold`,
`Complete`. Unowned actions stay `Unassigned`.

## 3. Minutes document

```
GET /sites/{SITE}                                         → site.id
GET /sites/{site.id}/drives                               → the 'Documents' drive id
GET /drives/{drive}/root:/API Automation Folder/Templates/Minutes Template.docx:/content
POST http://127.0.0.1:8080/render-docx                    → the filled .docx
```

The template has five loops (`attendees`, `safety`, `projects`, `finance`, `actions`) plus six
header fields, built by `templates/build-minutes-template.py` from the client's worked example.

The fetcher binds to loopback on the VPS. Local runs need the SSH tunnel; without it stage 3
fails with a connection error and stages 4 to 6 never run.

## 4. Filing

Resolve both destinations, then write:

```
GET /sites/{CHANNEL_SITE}                                 → chSite.id
GET /sites/{chSite.id}/drives                             → chDrive
PUT /drives/{chDrive}/root:/{Bext Transcripts/{date} {subject}/…}:/content
PUT /drives/{drive}/root:/{API Automation Folder/…}:/content
```

Written to **both** the channel folder and the BEXTHQ archive. Order within each folder:
`Transcript.vtt`, `Summary.docx`, then **`Minutes.docx` last**.

Failures are collected into a `failures[]` array rather than thrown, so a partial run still
produces a draft — but stage 6 checks that array and refuses to announce an incomplete record.

## 5. Draft email

```
POST /users/{me.id}/messages
```

Creates an **unsent draft**. The pipeline never sends. Steps 9 and 10 of the client's ten-step
process are BEXT reviewing and sending — that boundary is the point of the whole engagement, so
do not "improve" this into a send.

## 6. Channel card

```js
const card = buildMeetingCard({ subject, program, meetingNo, date, time, venue,
  organiser, attendees, summary, decisions, actions, projects, safety,
  urls: { folder, minutes, summary, transcript } });

POST {TEAMS_MEETING_WEBHOOK_URL}   // Adaptive Card 1.4 envelope
```

Guards, in order:

1. `--print-card` writes the payload to `scratch/card.json` for inspection.
2. If `failures.length` — do not post. Say which files failed.
3. If `--no-post` — build, do not send.
4. If `TEAMS_MEETING_WEBHOOK_URL` is unset — skip, and say so.
5. Otherwise post, retrying **twice only**. A missing announcement is recoverable; a duplicate is
   not.

`r.ok` is the success test. **Power Automate returns `202 Accepted`.**

## Porting into n8n

`MEETING_CODE` in `n8n/build-workflows.js` still holds an older five-field version. Replacing it
with this sequence is the next job, and it is the reason `n8n/lib/meeting-card.js` is a pure
function with no transport — the Code node uses `this.helpers.httpRequest`, not `fetch`.

Keep `BEXT — Meeting Intake` inactive until one scheduled run has been watched end to end.
