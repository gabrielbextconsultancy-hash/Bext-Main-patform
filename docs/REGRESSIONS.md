# Regressions — every failure we have already paid for

One entry per diagnosed failure. Each has a matching assertion in `n8n/preflight.js`,
so it can only cost us once.

**The rule:** when you diagnose a failure, add the check in the *same change* as the fix.
A bug that took an hour to find should take a second to catch.

```bash
node n8n/preflight.js          # local + generated workflows
node n8n/preflight.js --vps    # also the deployed container
node n8n/preflight.js --json   # for an agent
```

Exit 0 clean, 1 on any regression. Read-only — safe to run any time.

---

## R001 — `URLSearchParams is not defined`

**Cost:** every `BEXT — Graph Health` run from 15 Aug onward, and every `BEXT — Meeting Intake`
run ever. Silent: the workflow deployed fine and failed at runtime.

**Symptom:** `FAIL token: URLSearchParams is not defined`, health never recorded, no minutes.

**Cause:** the n8n Code sandbox does not expose `URLSearchParams` as a global — the same way it
withholds `URL`. The token request is the first real statement, so the whole run died before
reading anything.

**Fix:** `const { URLSearchParams } = require('url');` at the top of `MEETING_CODE` and
`GRAPH_HEALTH_CODE`.

**Guard:** R001, R002.

---

## R003 — `column "status" is of type health_status but expression is of type text`

**Cost:** `BEXT — Graph Health` failed its insert nightly even when the checks themselves ran.

**Cause:** `integration_health.status` is a Postgres enum (`001_init.sql:156`).
`json_to_recordset(...) AS x(status text, ...)` yields `text`, and Postgres will not coerce it.

**Fix:** `x.status::health_status` in the insert.

**Guard:** R003.

---

## R005 — `module.exports` survived into the Code node

**Cost:** unknown but certain — `module` is not defined in the sandbox, so the statement throws
mid-file. It sat inside `BEXT — Meeting Intake` alongside R001.

**Cause:** two of the three strip regexes in `build-workflows.js` had lost their backslashes:

```js
.replace(/^module.exportss*=.*$/m, '')     // "exportss*" — matches nothing
.replace(/^module\.exports\s*=.*$/m, '')   // correct
```

`\s` became `ss`, so the pattern looked for `exportss` and silently stripped nothing. Only
`ingest.js` had the intact version, which is why Source Ingest alone was unaffected.

**Fix:** restore `\.` and `\s` in all three.

**Guard:** R005 — asserts each lib is embedded *and* that no `module.exports` line survives.

---

## R005b — a documented trap that is not real

`n8n/lib/meeting-card.js`'s header warns that a backtick or `${` anywhere in an inlined file
"would be evaluated at build time and silently corrupt the copy that reaches n8n."

**That is not what happens.** These files are interpolated as `${INGEST_SRC}` / `${CARD_SRC}`.
A template literal inserts the *value*; it does not re-evaluate it. Proof: `ingest.js` carries
backticks on lines 36 and 203, and the built Source Ingest node contains them intact and parses.

Only code written **directly inside** the template literal in `build-workflows.js` needs `\``
and `\${` escaping. Recorded here because the warning cost real time and would have kept costing it.

---

## R006 — meetings organised by anyone else were invisible

**Cost:** every meeting Brent booked, including the 18 Aug weekly and the 19 Aug test. Looked
like a transcription failure; was not.

**Cause:** discovery walked `/users/{MS_SENDER_UPN}/calendar/events` — one mailbox. **Transcripts
resolve under the meeting's organiser**, not its invitees.

**Fix:** discovery is now `getAllTranscripts` per mailbox in `MEETING_HOSTS`. It asks "what was
transcribed?" rather than "what was I invited to?", and still returns a meeting whose calendar
event has since been deleted or declined.

**Guard:** R006, R013.

---

## R007 — `getAllTranscripts` 400s without a function parameter

`meetingOrganizerUserId` is a **function** parameter, not a query one:

```
/users/{id}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='{id}')
```

Omit it and Graph answers `400` with a message that reads like a malformed URL.

**Guard:** R007.

---

## R008 — `$filter` on `getAllTranscripts` is accepted and ignored

`?$filter=createdDateTime ge ...` returns **200 with the full history**. No error, no warning.
Left unnoticed, every tick reprocesses everything.

**Fix:** filter client-side on `createdDateTime`.

**Guard:** R008.

---

## R009 — a regenerated `webhookId` moves the public URL

n8n mints a fresh `webhookId` per node unless one is set. A redeploy then silently moves
`/webhook/teams-inbound`, and the Power Automate flow calling it 404s against a URL that no
longer exists.

**Fix:** hardcode `webhookId`. Also assert `authentication: 'headerAuth'` — that endpoint is
publicly reachable through traefik, unlike the polling workflows.

**Guard:** R009.

---

## R014 — config that exists everywhere except the running container

**Cost:** the longest detour of 19 Aug. `MEETING_HOSTS` was in the local `.env`, in the repo's
`infra/docker-compose.yml`, and in the built workflow — and **absent from the VPS**. The deployed
`docker-compose.yml` and `/docker/bext/.env` are separate copies; editing the repo changes
neither.

`docker compose up -d n8n` reported `Running` rather than `Recreated`, because from compose's
point of view nothing had changed. That looks like success.

**Fix:** patch `/docker/bext/.env` and `/docker/bext/docker-compose.yml` on the VPS, validate with
`docker compose config -q`, then `up -d n8n`.

**Guard:** R014 (`--vps`) — asserts the *running container* sees it, not the file.

---

## Notes that are not yet checks

- **`BEXT — Meeting Intake` executions did not appear** after activation. Recreating the container
  resets the schedule timer, so allow a full interval before concluding anything.
- **Ad-hoc 1:1 calls produce no reachable transcript.** Graph's transcript APIs cover scheduled
  meetings only; a call's transcript lives with the Teams recap. The OneDrive artefact named
  `…-Meeting Transcript.mp4` is H.264 video, not text. Use a calendar invite, not the call button.
- **`Source Ingest` had no recent executions** and `Article Analysis` errored on 17 Aug — which is
  why Brent had no industry report on the morning of 19 Aug. Not yet diagnosed.
