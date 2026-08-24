# Self-healing — what watches the workflows, and what it is allowed to do

Every failure in `REGRESSIONS.md` was found by a person looking. Several were
found days late: R001 killed every `BEXT — Graph Health` run from 15 August and
every `BEXT — Meeting Intake` run ever, and the workflows reported themselves
healthy the whole time. R024 is worse — every workflow read ACTIVE while the
scheduler had been dead for fifteen hours.

The thesis of this document is the rule already at the top of `REGRESSIONS.md`:
*a bug that took an hour to find should take a second to catch.* That rule is
currently executed by hand. This makes it run at 03:00.

Four rings. Each is cheap, and each covers a failure the ring above it cannot see.

---

## Ring 0 — Detect

`uptime-kuma`, container `bext-kuma`, in the `bext` compose project. Publishes no
ports; the Premier Fitness traefik routes it on the shared network, the same way
it routes n8n and the dashboard.

Two kinds of monitor:

| Kind | Answers | Catches |
|---|---|---|
| HTTP | is it up | n8n down, dashboard down, fetcher not listening on 8080 |
| **Push** | **did it actually run** | **R024, a report that silently never sent** |

The push monitors are the point. Each scheduled workflow ends in a `Heartbeat`
node that pings a Kuma push URL; Kuma alarms when the ping does **not** arrive
inside the window. No HTTP check can see a workflow that is up, active, and not
running — which is the failure we have actually had.

Three properties of the heartbeat that are load-bearing, all asserted by
preflight **R028**:

- **It is an `httpRequest` node, not a Code node.** The Kuma URL is plain http on
  the internal docker network and the Code sandbox allows only
  `crypto,url,https,dns` (R022). Using a real node avoids widening that list.
- **`onError: continueRegularOutput`.** A monitor that can fail the workflow it
  monitors is worse than no monitor.
- **It is anchored on a node that runs on *every* cycle.** Graph Health is the
  sharp case: its chain is `Record health` → `Only when broken` (IF) → `Alert by
  email`. Anchoring on the terminal node would ping only when Graph is *broken* —
  the monitor exactly inverted. It anchors on `Record health`.

Anchors live in `HEARTBEATS` in `n8n/build-workflows.js`. A scheduled workflow
with no entry is a **build error**, not a warning: shipping one unmonitored is
how the 05:00 report became invisible, and the fix is to make it impossible
rather than to remember.

Kuma cannot tell you the host is gone, because it is on the host. Total-host loss
is Hostinger's own monitoring.

## Ring 1 — Diagnose

`n8n/lib/heal-rules.js` is `REGRESSIONS.md` as data: a regex per known failure,
carrying the **same id** as its preflight check and its section in the document.
One fact, three views. Preflight **R026** asserts the ids resolve, and caught a
real drift the first time it ran — a rule citing `R002` when the section is
`R002b`.

Ids numbered `R1xx` are the healer's own operational classes (a flapping trigger,
a transient 5xx) and have no regression entry by design.

It reads **failed executions only**. `EXECUTIONS_DATA_SAVE_ON_ERROR` is `all`, so
that list is complete for failures — and completely blind to a workflow that ran
clean and produced nothing. Do not try to infer an outage from an empty execution
list: that is R015, and the R024 comment records it being walked into twice.
Absence is ring 0's job.

## Ring 2 — Remediate

Six actions, all reversible, all logged. Nothing else.

```
retry_execution · reactivate_workflow · redeploy_workflow
restart_container · refresh_graph_token · flag_source_browser
```

Everything else escalates. Note which failures are *not* on that list: R001,
R003, R005, R007, R017, R020, R021, R022 are all code defects whose fix is a
commit. Those rules exist so the Teams post can **name** the failure and quote
the fix — recognising a failure and being allowed to fix it are different
permissions.

### The guards

- **Written before acted.** The `incidents` row lands with outcome `attempted`
  before the action runs, so an action that kills the healer still leaves
  evidence it was tried.
- **One execution, one attempt.** R016 is the precedent: a permanently broken
  meeting that retried forever.
- **Rate cap**, six actions per rolling hour in the script, one per pass in the
  workflow. Past that the healer is making things worse by hammering them.
- **Container allowlist, two independent gates.** The name must match
  `^bext-[a-z0-9-]+$` *and* be in `RESTARTABLE`. The prefix test alone would pass
  `bext-n8n`; the set alone would pass a typo that happened to be in the set.
  Preflight **R025** asserts both gates still exist and that the three exclusions
  are still excluded:

  | Excluded | Because |
  |---|---|
  | `bext-n8n` | restarting it kills the healer mid-run |
  | `bext-postgres` | it holds the record of why we restarted it |
  | `bext-ollama` | slow to warm — a restart looks like a fix and is a quiet outage |

  `n8n-n8n-1` (Premier Fitness) fails both gates. So does `bext-fetcher; docker
  stop n8n-n8n-1`.

### Why there are two runners

`BEXT — Self Heal` (every 15 min) does the half n8n can do to itself: classify,
log, retry an execution, reactivate a workflow, post the rest to Teams.

It **cannot** restart a container, push workflow JSON from the repo, or mint a
token — those need `child_process` and docker. The obvious way to grant that is
to mount `/var/run/docker.sock` into `bext-n8n`. **Refused.** That socket is root
on a host that also runs Premier Fitness; an escape from our container reaches
their stack. CLAUDE.md rule 1 is not only about which commands we type.

So `n8n/self-heal.js` does the host-level actions, under an operator's SSH key,
with the allowlist above. Same rules file, same incident table, same ids.

```bash
node n8n/self-heal.js --dry-run
```

Without a Postgres tunnel it refuses to act at all — it will not take an action
it cannot record.

## Ring 2.5 — Validate (the healer checks its own work)

An action recorded as done is not the same as an action that worked. Every remediation
is written `attempted`, never `healed`. On the next cycle the healer re-reads its own
open incidents and asks the live API whether the thing actually recovered — for the two
workflow actions (retry, reactivate) that means the workflow produced a **successful run
after** the incident. Recovered → `healed`. Still failing past a 2-hour ceiling →
`failed`, and it escalates *that* to Teams: a fix that did not hold is news.

This is the Cole Medin pattern (the agent validates its own output) and it is not
decorative — the two sandbox faults that shipped green this build (`$env.N8N_URL`
unset, then `fetch`/`http` unavailable) were caught **only** by watching a real run.
A healer that trusts its own actions would have reported success while healing nothing.

Two anti-flood guards live alongside it, because a monitor that cries wolf gets ignored:

- **Execution dedup** — a failure already recorded in the last 6 hours is never
  re-detected or re-escalated. Without this the same failure posts every 15 minutes.
- **Per-workflow escalation** — a persistently broken workflow throws a fresh execution
  id every cycle. The repeat is still *recorded* (the dashboard should show the
  frequency) but not re-posted to Teams after the first time.

The escalation itself was also fixed here: the Teams node now reads the healer's rows
directly, not the Postgres node's row-count output — which is why escalations had been
silently posting nothing.

## Ring 3 — Learn

An unclassified failure posts to Teams with the signature and an empty diagnosis.
A human diagnoses it once, and then — **in the same change as the fix**, per the
rule at the top of `REGRESSIONS.md`:

1. a section in `docs/REGRESSIONS.md`
2. a check in `n8n/preflight.js`
3. a rule in `n8n/lib/heal-rules.js`

Ring 2's coverage grows every time this happens. That is the "learns over time"
property, and it is deliberately a growing rules table rather than an open-ended
agent loop: auditable, diffable, and explainable to the client.

Adding a rule **cannot**, by itself, widen what the healer may do. `AUTO_ACTIONS`
is a separate list, and R025 fails the build if a rule names an action that is not
on it.

## Seeing it — the Grafana dashboard

`BEXT — Self-Healing` (Grafana, reads the `incidents` table through a read-only Postgres
role, `db/migrations/025`) shows the numbers the references insist you measure: heal
success rate, MTTR from detection to validated heal, open/unresolved count, incidents per
day by outcome, and the top failure classes by rule id. If the success rate sinks or the
open count climbs, the healer is losing — visibly, instead of in a table nobody reads.

## Validation — `BEXT — Contract Test`

Nightly at 02:00, three hours before the report, so a failure is still fixable
before the client sees anything.

`preflight.js` asserts everything readable from the repo. The contract test
asserts what only the running container can see — which is exactly where the
worst failures have lived:

- **R014** — config present in `.env`, in the repo compose, everywhere except the
  running container. `MEETING_HOSTS` was empty inside n8n for days.
- **R022** — a `require()` the sandbox blocks. Fine locally, dead at runtime.
- **R001 / R002b** — a Code node that parses on a laptop and throws in the
  sandbox, because `URL` and `URLSearchParams` are withheld as globals.
- every scheduled workflow still carries its `Heartbeat`.

## Monitors — the whole BEXT estate

Create these in the Kuma UI after first-run setup. Every endpoint below was
confirmed answering 200 on 24 Aug 2026. Point every monitor's notification at
the **Teams "Daily report" webhook**, so an alarm lands where the daily card
already lands rather than in a second place nobody watches.

> Kuma itself is at **https://bext-kuma.srv1866850.hstgr.cloud** — same zone as n8n, no DNS
> record needed (Hostinger wildcards `*.srv1866850.hstgr.cloud`). It is an ops tool, so it
> lives beside n8n rather than on the client-facing `dev-environment.site`.

### Public — HTTPS (certificate expiry is automatic on these)

| Monitor | URL | Every |
|---|---|---|
| n8n | `https://bext-n8n.srv1866850.hstgr.cloud/healthz` | 60s |
| Dashboard | `https://bext.dev-environment.site` | 60s |
| Proposal deck | `https://bext.dev-environment.site/proposal` | 300s |

The proposal deck is client-facing and unauthenticated. It is monitored
separately from the dashboard root because a routing change can 404 one without
touching the other, and the client is the one who would find out.

### Internal — Kuma sits on `bext_internal`, so it reaches these by service name

| Monitor | Target | Every |
|---|---|---|
| fetcher | `http://fetcher:8080/health` | 60s |
| scrapling | `http://scrapling:8090/health` | 60s |
| api | `http://api:8090/health` | 60s |
| qdrant | `http://qdrant:6333/healthz` | 300s |
| ollama | `http://ollama:11434/api/tags` | 300s |
| postgres | TCP `postgres:5432` | 60s |

The fetcher matters more than its size suggests: `INFRASTRUCTURE.md` records
that when it is down, document rendering fails with a connection error that
reads exactly like a code bug. Naming it here turns an hour of debugging into a
red tile.

### DNS — mail

`health-check.js` exists partly because the daily report failed SPF for weeks
while reporting "up" the whole time: the workflow ran, the mail did not arrive.
These monitors watch the records themselves, continuously.

| Monitor | Record | Expect | Every |
|---|---|---|---|
| SPF | TXT `bextconsultancy.com.au` | contains `v=spf1` | 1h |
| DMARC | TXT `_dmarc.bextconsultancy.com.au` | contains `v=DMARC1` | 1h |
| DKIM | TXT `<selector>._domainkey.bextconsultancy.com.au` | contains `v=DKIM1` | 1h |

### Push — the deadmen

Type **Push**. The window is the workflow's cadence plus one missed run: long
enough that a single blip does not cry wolf, short enough that a stopped
scheduler is caught the same day. Copy each token into the matching
`KUMA_PUSH_*` in `.env` **and** `/docker/bext/.env`, then redeploy.

| Monitor | Workflow cadence | Window | Env key |
|---|---|---|---|
| Source Ingest | hourly | 5400s (90m) | `KUMA_PUSH_SOURCE_INGEST` |
| Article Analysis | 30 min | 2700s (45m) | `KUMA_PUSH_ARTICLE_ANALYSIS` |
| Meeting Intake | 15 min | 1500s (25m) | `KUMA_PUSH_MEETING_INTAKE` |
| Self Heal | 15 min | 1500s (25m) | `KUMA_PUSH_SELF_HEAL` |
| Daily Report | 05:00 AEST | 93600s (26h) | `KUMA_PUSH_DAILY_REPORT` |
| Daily News Card | 05:20 AEST | 93600s (26h) | `KUMA_PUSH_DAILY_NEWS_CARD` |
| Graph Health | 06:00 AEST | 93600s (26h) | `KUMA_PUSH_GRAPH_HEALTH` |
| Contract Test | 02:00 AEST | 93600s (26h) | `KUMA_PUSH_CONTRACT_TEST` |

**`BEXT — Newsletter Intake` has no push monitor, deliberately.** It is IMAP
triggered, not scheduled, so there is no cadence for it to be dead against — a
quiet mailbox is not an outage. Giving it a deadman would produce a red tile
every quiet weekend, and the fastest way to make monitoring useless is to make
it cry wolf.

Until a token exists its `KUMA_PUSH_*` is blank and the `Heartbeat` node is a
harmless no-op: it carries `onError: continueRegularOutput`, so a blank token
cannot fail the workflow it is supposed to be watching.

### What is deliberately NOT monitored

The Premier Fitness stack (`/docker/n8n`) and `/opt/nfac` share this host. They
are not BEXT's to watch, and putting another client's endpoints in a
BEXT-operated monitor is a client-data boundary we do not cross.

Kuma also cannot report that the host itself is gone, because it is on the host.
That gap belongs to Hostinger's own monitoring.

## Running it

```bash
node n8n/preflight.js
```

```bash
node n8n/self-heal.js --dry-run
```

Deploy order matters once: the migration must be applied before the workflow
runs, or every incident insert fails and the healer is the broken thing.

```bash
psql -f db/migrations/024_incidents_and_heal_rules.sql
```

```bash
node n8n/build-workflows.js
```
