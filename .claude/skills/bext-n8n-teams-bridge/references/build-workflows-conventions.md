# `n8n/build-workflows.js` conventions

One file, ~1260 lines, holding all five BEXT workflows. The repo is the source of truth; anything
edited in the n8n UI is overwritten on the next build.

## Structure

```
config            B, H, DRY, PG_CRED, SMTP_CRED, TAG
INGEST_SRC        n8n/lib/ingest.js read from disk, module.exports stripped
Workflow 1        INGEST_CODE  + sourceIngestWorkflow()
Workflow 2        ANALYSIS_PROMPT + articleAnalysisWorkflow()
Workflow 3        REPORT_SECTIONS / REPORT_SELECT + dailyReportWorkflow()
Workflow 4        GRAPH_HEALTH_CODE + graphHealthWorkflow()
Workflow 5        MINUTES_PROMPT + MEETING_CODE + meetingIntakeWorkflow()
deploy(wf)        write JSON → PUT/POST → tag
main              deploy each, in order, behind credential guards
```

Each `*Workflow()` is a plain function returning `{ name, nodes, connections, settings }`.
Code-node bodies are template strings assigned to a `*_CODE` const above the function.

## Running it

```bash
node n8n/build-workflows.js --dry    # write n8n/workflows/*.json, deploy nothing
node n8n/build-workflows.js          # build and deploy
```

Always `--dry` first and read the diff.

Guards: exits if `N8N_PG_CREDENTIAL_ID` is unset; skips the report, health and meeting workflows
if `N8N_SMTP_CREDENTIAL_ID` is unset. A "missing" workflow is usually a missing credential id, not
a bug.

## `deploy(wf)`

1. Writes `n8n/workflows/<name slugified>.json` — non-word runs become `-`, leading and trailing
   dashes trimmed.
2. Lists workflows and matches **by name**.
3. PUT if found, POST if not.
4. PUTs the `BEXT Consultancy` tag. Folders are an enterprise feature (`feat:folders` is rejected
   on Community); tags are the grouping mechanism.

**Renaming a workflow orphans its JSON file and creates a second workflow in n8n**, because the
match is by name and the filename derives from it. Rename deliberately: delete the old file and
the old workflow in the same change.

## Naming

`BEXT — ...` with an **em dash**, not a hyphen. The tag is applied automatically. Both are hard
project rules.

## The inlining trap

`INGEST_SRC` is read from `n8n/lib/ingest.js` and interpolated into a template literal.
`n8n/lib/meeting-card.js` is treated the same way when the meeting port lands.

A backtick or a `${` anywhere in those files — **including in comments** — is evaluated at build
time and silently corrupts the copy that reaches n8n.

Rules for any file inlined this way:

- single quotes and string concatenation only
- no `require`, no `fetch`, no `process.env`
- no template literals, even in examples inside comments

The failure is silent. The workflow deploys cleanly and then throws a runtime syntax error that
does not match the file on disk.

## Inside a Code node

| Instead of | Use |
|---|---|
| `process.env.X` | `$env.X` |
| `fetch(...)` | `this.helpers.httpRequest({...})` |
| `require('crypto')` | works, but pull `URL` off `require('url')` explicitly — the sandbox does not expose the WHATWG global |

`this.helpers.httpRequest` returns a parsed body, not a `Response`. There is no `.json()` and no
`.ok`. Check status via the options it accepts, or let it throw.

## Adding a workflow

1. Write `FOO_CODE` and `fooWorkflow()` next to the others.
2. Add `await deploy(fooWorkflow())` in the main block, behind whichever credential guard it needs.
3. `node n8n/build-workflows.js --dry`, read the JSON.
4. Deploy, then `git add n8n/workflows && git commit`.

New workflows that touch a live client channel should be deployed **inactive** and watched for one
scheduled run before activation — the pattern `BEXT — Meeting Intake` already follows.

## Existing workflows

| Name | Schedule | State |
|---|---|---|
| `BEXT Daily News — 1 Source Ingest` | hourly | active |
| `BEXT Daily News — 3 Article Analysis` | 30 min | active |
| `BEXT Daily News — 5 Daily Report` | 05:00 `Australia/Melbourne` | active |
| `BEXT — Graph Health` | 06:00 | active |
| `BEXT — Meeting Intake` | 15 min | **inactive**, holds an older five-field `MEETING_CODE` |

The report cron is `Australia/Melbourne`, not UTC. Hardcoding UTC+10 makes it drift an hour when
DST starts.
