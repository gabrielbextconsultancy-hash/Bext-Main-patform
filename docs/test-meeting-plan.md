# Test meeting — what to run, and what should come out

The permissions work is finished and verified. What has never been tested is the part that
matters: whether a real transcript produces minutes worth reviewing. That needs one recorded
meeting. This is the plan for it.

**Who:** Gabriel and Brent, about 15 minutes.
**When:** any time. Nothing else is waiting on it.

---

## Why a test meeting rather than a sample file

An invented transcript would test the plumbing and nothing else. The questions that decide
whether this is usable are all about real speech: whether Teams attributes speakers correctly
when two people talk over each other, whether the model can tell a decision from someone
thinking aloud, whether it catches an owner named three sentences after the task, and whether
it correctly leaves out the small talk. None of that can be assessed against text written to
be easy.

---

## Running it

**1.** Brent starts a Teams meeting and invites Gabriel — a real invitation, not "Meet now",
so it lands on the calendar the way a client meeting would.

**2.** Turn transcription on: **More (···) → Record and transcribe → Start transcription**.
Confirm the banner appears for both participants before speaking.

**3.** Talk for **8–10 minutes**, following the shape of a real weekly check-in rather than
reading a script. Cover, roughly in this order:

- **Safety** — one item, ongoing, with an owner.
- **Three or four projects**, each with a phase, a status, what happened this week, and what
  happens next. Use the real vocabulary: On Track, Monitor, At Risk. Mention a DNSP or network
  point on at least one — Energex, Powercor, SP AusNet.
- **Two or three new actions**, each with an owner and a due date said out loud.
- **One existing action closed** — "that one's done now".
- **One decision**, stated as a decision.
- **One thing deliberately vague** — an action with no owner named, or a date left as "in a
  couple of weeks". This is the most useful minute of the meeting: it shows whether the model
  invents an owner or correctly marks it Unassigned.
- **A minute of genuine small talk** somewhere in the middle. It should not appear in the
  minutes at all.

**4.** Stop transcription, end the meeting, wait about five minutes for Teams to publish.

**5.** Tell Gabriel. Nothing else is needed from Brent.

---

## What happens then

The workflow is **not** switched on. This first run is driven by hand, step by step, so each
output can be looked at before anything files itself. Expect to see, in order:

| # | Output | What it proves |
|---|---|---|
| 1 | The raw `.vtt` transcript | Teams published it, and speaker names are attached |
| 2 | Extracted JSON | Attendees, projects, decisions, actions with owners and dates |
| 3 | Filled minutes `.docx` | The template populates correctly with real content |
| 4 | Actions register rows | New actions numbered per project; the closed one marked |
| 5 | Draft email | Summary, decisions, new actions — sitting in drafts, unsent |

Each is shown before the next runs. If step 2 is poor, steps 3–5 are not worth looking at, and
the fix is the prompt rather than the plumbing.

## What "good" looks like

- Every speaker appears as an attendee, once, under one name.
- Project statuses use only the template's words: On Track, Monitor, At Risk, On Hold, Complete.
- Every action stated has an owner and a due date, or is honestly marked Unassigned.
- The closed action is closed, not duplicated as a new one.
- Small talk is absent.
- Nothing is invented. An empty section is a correct answer.

## What would count as a real problem

- Speaker names missing from the transcript — means speaker attribution did not apply, and the
  Teams setting needs revisiting.
- An owner assigned to the deliberately vague action — the model guessing rather than
  reporting, which is the failure mode that matters most, because it is the one a reviewer is
  least likely to catch.
- The closed action appearing as a new one — matching is not working, and the register would
  accumulate duplicates every week.

Any of those is a prompt or matching problem, fixed and re-run against the same transcript. No
further meeting is needed — the transcript is kept and can be replayed as often as required.

---

## Where the build actually is

| Piece | State |
|---|---|
| Permissions, consent, access policy, transcript API | Done, verified |
| SharePoint folders | Done |
| Graph health monitoring | Deployed, active |
| Minutes template converted to fillable | Done, renders clean |
| Program register schema | Done, applied |
| Document rendering service | Done, tested on the VPS |
| `BEXT — Meeting Intake` workflow | **Built, deployed, deliberately inactive** |
| Extraction tuned to the real template | **Next — needs this transcript** |
| Excel register generation | Next |
| SharePoint folder trigger | Next |

The workflow exists end to end and runs on a fifteen-minute schedule when switched on. It is
off because it files documents and creates drafts, and switching it on before watching it work
once would mean finding any fault through cluttered folders and stray drafts instead of on
screen.

It was also written against the interim template, before the real one arrived. The extraction
now has to fill seven sections rather than five fields, and carry project rows forward between
weeks. That rewrite is the next piece of work, and this transcript is what it should be tuned
against — tuning it against invented text would only teach it to handle invented text.
