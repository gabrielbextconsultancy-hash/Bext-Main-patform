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

Since 24 Aug the rule has a third limb. A diagnosed failure now gets:

  1. a section here,
  2. a check in `n8n/preflight.js`,
  3. a rule in `n8n/lib/heal-rules.js` — the same failure as a runtime matcher,
     so the healer recognises at 03:00 what you recognise instantly.

Use the SAME id in all three. Preflight R026 fails the build if a heal rule cites
a section that is not here — it caught exactly that on its first run.

Adding a rule does not grant the healer a new power: `AUTO_ACTIONS` is a separate
list and R025 fails the build if a rule names an action that is not on it. A rule
whose fix is a code change gets `action: 'escalate'` and a `hint`, which is what
the Teams post quotes. See `docs/SELF-HEALING.md`.

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

---

## R015 — a node that emits nothing stops the workflow dead

**Cost:** the workflow could never bootstrap. `meeting_minutes` starts empty, so the exclusion
query returned zero rows, and **an n8n node that emits no items does not run the nodes after it**.
The run "succeeded" having done nothing — invisible, because `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`
means only failures are recorded.

That combination is what made "0 executions" read as "never ran" for most of a day. It had been
running all along.

**Fix:** `alwaysOutputData: true` on the lookup node.

**Guard:** R015.

---

## R016 — a failed row retired the meeting permanently

**Cost:** the first failure was final. The exclusion list matched *any* row within three days,
including `failed` ones — so a row landed, the next tick treated the meeting as done, and it was
never attempted again. Observed live: execution 1881 discovered nothing, because two failed rows
excluded both meetings.

**Fix:** `WHERE status <> 'failed'`. A permanently broken meeting now retries every fifteen
minutes — noisy, but visible. Silent retirement was the worse failure.

**Guard:** R016.

---

## R017 — an object spread silently dropped the auth header

**Cost:** most of a day, and two wrong diagnoses.

```js
headers: headers,   // { Authorization: 'Bearer …' }
...opts,            // ← opts.headers REPLACES it
```

The draft creation passes `headers: { 'Content-Type': 'application/json' }`, so the spread
overwrote the merged headers and the token vanished. Graph correctly answered **401**.

Every GET passes no headers and kept working; only the POST failed. That asymmetry is what made it
look like a Microsoft permissions problem. It was not: the same call made directly returned
**201 Created**, and licensing, consent and the application access policy were all verified good.

**Fix:** spread `opts` first, apply `headers` last.

**Guard:** R017.

### What actually cost the time

Not the bug — the diagnosis. Eight outbound calls plus a dozen `graph()` calls all reported
`Request failed with status code 401`, naming neither endpoint nor body. Two fixes were written
against the wrong suspect on that evidence, and both were dead code (`fetch` is not a global in the
Code sandbox, so those branches never executed).

The fix that mattered was labelling every call — `graph POST /users/…/messages -> 401: <body>` —
which named it on the first run afterwards. **When a failure cannot say where it came from, make it
say so before attempting another fix.**

---

## R018 — a recurring series reports the series start, not the instance

**Symptom:** the 18 August weekly filed itself as `2026-07-28` — three weeks out — so the folder
name and the minutes date were both wrong.

**Cause:** `GET /onlineMeetings/{id}` on a recurring series returns the **series** start date.

**Fix:** take the date from the transcript's `createdDateTime` (written minutes after the instance
ends) and the time of day from the meeting, which a weekly series does hold correctly. A one-off
meeting lands on the same date either way, so it applies unconditionally.

---

## R019 — backfilled cards posted in reverse

**Symptom:** after a multi-meeting catch-up run, the newest meeting was not the newest message in
the channel.

**Cause:** `getAllTranscripts` returns newest first, and candidates were processed in that order —
so the oldest meeting posted last.

**Fix:** sort candidates by `createdDateTime` ascending before processing, so cards land in the
order the meetings happened.

---

## R020 — a binary response parsed as JSON

`json: true` on the render call turned the returned .docx into
`{"type":"Buffer","data":[80,75,3,4,...]}`. `Buffer.from()` on that object does
not throw — it yields the **text** of the envelope.

**Fix:** `json: false` for binary responses (the request body then needs
stringifying by hand, because `json: true` was doing both jobs), plus a `toBuf()`
normaliser on every binary body.

**Guard:** R020.

---

## R021 — a Buffer body handed to the HTTP helper

**Cost:** every `.docx` the pipeline ever wrote. Word opened them as *"unreadable
content"*, which read as a broken template or a SharePoint permissions problem.

A Buffer is an object, and the helper `JSON.stringify()`s an object body **even
with `json: false`** — so the file written to SharePoint was the text of a Buffer
envelope rather than the document. It uploaded fine and stored fine; only Word
disagreed.

What identified it: `Summary.docx` and `Transcript.docx` were corrupt too, and
those never touch the renderer — while the two files written by
`graph/run-meeting-once.js` were intact throughout, because that path uses plain
`fetch`. The common factor was the upload, not the download.

**Fix:** uploads use `https.request`, which writes bytes verbatim. Plus a guard
that refuses to upload a `.docx` whose first four bytes are not `504b0304`, so
this fails loudly instead of silently producing a file nobody can open.

**Guard:** R021.

**Recovery:** the real document was recoverable from inside the envelope. 19 files
across five meetings, in both the channel and the archive, were repaired in place
— same item ids, so every existing card link kept working.

---

## R022 — a require() the sandbox does not allow

The fix for R021 used `require('https')`, and the container was set to
`NODE_FUNCTION_ALLOW_BUILTIN=crypto,url`. Every meeting then failed at runtime
with `Module 'https' is disallowed [line 1128]` — deployed cleanly, broke only
when it ran, and was visible on the dashboard rather than in any check.

**Fix:** `crypto,url,https`, in the repo compose **and** on the VPS.

**Guard:** R022 — cross-references every `require()` in a generated Code node
against the allowed list.

### The pattern worth remembering

Three of these — R020, R021, R022 — were introduced *while fixing* the one before
it. Each fix was correct in isolation and wrong in the running environment. The
check that caught the last one was the dashboard, which is the argument for
building the monitoring view early rather than last.

---

## R023 — the client was emailed the same minutes every 15 minutes

**Cost:** eight identical emails to Brent between 02:31 and 04:15 on 22 Aug, for
one meeting. Client-visible, and not recallable.

**Cause:** two windows that must agree, and did not.

```
discovery window   MEETING_LOOKBACK_HOURS = 168   (7 days)
exclusion window   created_at > now() - '3 days'
```

Widening discovery to 7 days without widening the exclusion list left a gap.
A meeting older than 3 days but newer than 7 was still discovered, no longer
counted as done, and so was reprocessed on every tick — refiling documents,
reposting the card, and re-sending the minutes. It stayed invisible until
sending was switched on; before that it silently rewrote the same files.

**Fix, in three layers:**

1. exclusion window widened to **90 days**, far beyond any plausible discovery
   window, so widening the lookback again cannot reopen the gap
2. a **duplicate-send guard**: every meeting with a `sent_at` is loaded and the
   send is skipped, whatever the windows say. Window arithmetic can be wrong
   again; "never send the same minutes twice" must not depend on it
3. `sent_at = COALESCE(EXCLUDED.sent_at, meeting_minutes.sent_at)` — a later
   reprocess writes null, and overwriting would have cleared the very record
   layer 2 reads, re-arming the loop

**Guard:** R023 — asserts exclusion ≥ discovery, that the dedupe set exists, and
that `sent_at` cannot be cleared.

### The lesson

Two windows that must agree, changed one at a time. The first change was
requested and correct; the second was implied and never made. A derived value or
an assertion at the point of change would have caught it — and R023 is now that
assertion.

Also worth noting: this was only visible because sending was enabled. The same
loop had been refiling documents and reposting cards for days without anyone
noticing. **Idempotence deserves a check even when the side effects are invisible.**

---

## R022b — a require() the sandbox blocks, found before it ran

R022 flagged `require('dns')` in `BEXT — Daily Report`'s deliverability node
against an allow-list of `crypto,url,https`. That node would have failed at
runtime with `Module 'dns' is disallowed`, exactly as the `https` upload did.

Caught by the check rather than by a failed report. `NODE_FUNCTION_ALLOW_BUILTIN`
is now `crypto,url,https,dns` in the repo compose and on the VPS, and the R022
default mirrors it.

---

## R002b — a symbol required but never bound

**Cost:** every upload in `BEXT — Meeting Intake` threw `ReferenceError: URL is not
defined`. `put()` catches upload errors into `failures` so a bad write does not cost
the draft, so nothing surfaced — until the folder lookup 404'd on a folder that
nothing had created. The recorded error described a missing folder; the fault was
an unbound symbol three steps earlier.

**Cause:** `putBinary` calls `new URL(...)`, and the file had
`const { URLSearchParams } = require('url')`. The sandbox withholds `URL` as a
global, so requiring the module is not enough — the symbol has to be destructured.

**Fix:** `const { URLSearchParams, URL } = require('url')`.

**Guard:** R002, rewritten. The old version asserted that `require('url')` appeared
somewhere in the node, which passed while `URL` was still unbound. It now parses
the destructuring list and checks each symbol actually used.

The rewritten check immediately found the same latent fault in two other
workflows — `BEXT — Daily Report` (`Fetch article images`) and
`BEXT — Newsletter Intake` (`Read the newsletter`) — both using `new URL()` with no
`require('url')` at all. Both fixed before they ran.

### Two lessons

**A check that passes for the wrong reason is worse than no check.** R002 had been
green for days over code that would throw on first execution.

**Swallowing an error to protect a later step hides the cause of that step's
failure.** `put()` collecting failures is right — a bad write should not cost the
draft — but the filing stage now raises those collected failures before anything
downstream can produce a more visible, less true error.

---

## R030 — a recurring meeting is many meetings, but one meetingId

**Cost:** the 25 August weekly. It would have cost every weekly after it, and the
RACV program check-in is weekly — so this was on track to silently lose the
engagement's entire minute trail while reporting success throughout.

**Symptom:** Brent held a meeting, Teams published the transcript, and nothing
happened. No row, no folder, no card, no email. `BEXT — Meeting Intake` ran on
schedule and every run returned `success`.

**Cause:** a recurring Teams series reuses **one `meetingId` for every
occurrence**. Discovery excluded any transcript whose `meetingId` was already in
`meeting_minutes`, so the moment occurrence 1 was minuted the whole series was
retired.

Byte-for-byte identical across two different meetings a week apart:

```
18 Aug 03:16Z  meetingId MSoy…OTk6bWVldGluZ19OMlptTXpRelpUUXRNbVk0…QHRocmVhZC52Mg
25 Aug 03:01Z  meetingId MSoy…OTk6bWVldGluZ19OMlptTXpRelpUUXRNbVk0…QHRocmVhZC52Mg
```

The transcript ids differ, and carry the occurrence timestamp:

```
…-1787022989-TranscriptV2      18 Aug
…-1787626860-TranscriptV2      25 Aug
```

**Why nothing went red.** A skipped candidate is not an error. The workflow did
exactly what it was told, quickly, and reported success. Uptime Kuma saw a
heartbeat, the readiness probe saw a healthy pipeline, and the dashboard showed
the last good meeting from six days earlier. Every signal we had was green.

This is the third time in this project that **"success" has meant "did nothing"**
— R015 (a node emitting no items skips everything downstream) and R024
(`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` leaves successes invisible) are the same
shape. A pipeline that can legitimately do nothing cannot use "it ran" as
evidence that it worked.

**Fix:** migration `013_transcript_id.sql` makes `transcript_id` the identity —
unique per occurrence, partial-unique index for the dropped-file path that has no
Graph id — and demotes the `meeting_id` unique index to a plain one, so it now
*groups* a series rather than forbidding it. Discovery excludes on `t.id`, the
send guard keys on `cand.transcriptId`, and the upsert conflicts on
`(transcript_id) WHERE transcript_id IS NOT NULL`.

Existing rows were backfilled by `graph/backfill-transcript-ids.js`, which maps
each row to the **oldest** transcript sharing its `meetingId` — the occurrence
that actually wrote the row. Getting that wrong would have re-minuted and
re-emailed the 18 Aug weekly to the client.

**Guard:** R030 — asserts the key at all four sites (discovery exclusion, send
guard, both halves of the exclusion query, and the `ON CONFLICT` target). Any one
of them drifting back to `meeting_id` reopens this.

**Not a bug, checked:** the folder name is `{date} {subject}`, so a series
produces `25 Aug Weekly Meeting`, `01 Sep Weekly Meeting` — distinct. No change
needed there.
