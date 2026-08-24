---
name: bext-observability
description: Operate the BEXT monitoring stack — Uptime Kuma, Prometheus and Grafana on the Hostinger VPS. Use when asked to add, edit or check a monitor; read whether a workflow or endpoint is up; get or rotate a Kuma push token; query Prometheus; open or build a Grafana dashboard; deploy or restart bext-kuma / bext-prometheus / bext-grafana / bext-node-exporter; or diagnose why a monitor is red or a scrape target is down. Also use when the user mentions uptime kuma, prometheus, grafana, /metrics, push monitor, deadman, or "is the report actually sending".
---

# BEXT observability — Kuma · Prometheus · Grafana

Three layers, one job: know a BEXT thing broke before the client does. Sits on top
of `docs/SELF-HEALING.md` (the healer reacts; this is what notices).

## The endpoints

| Thing | URL | Auth |
|---|---|---|
| Uptime Kuma | https://bext-kuma.srv1866850.hstgr.cloud | UI login; API key for `/metrics` |
| Grafana | https://bext-grafana.srv1866850.hstgr.cloud | Grafana login |
| Prometheus | **internal only** — no public URL | none (never expose it) |

All three are on the `srv1866850.hstgr.cloud` host zone (Hostinger wildcard, no DNS
record needed), same as n8n — they are ops tools, not client-facing like the
dashboard on `dev-environment.site`. Publish **no ports**; traefik (owned by the
Premier Fitness `n8n` project) routes them on the shared `n8n_default` network.

## The one thing to get right: two auth planes

Kuma has **two** credentials and they do different jobs. Confusing them wastes an hour.

- **`KUMA_API_KEY`** (in `.env`) unlocks the **read-only `/metrics`** endpoint and
  nothing else. Prometheus scrapes with it. You can read status with it. You
  **cannot** create or edit a monitor with it.
- **`KUMA_USER` / `KUMA_PASS`** (the admin login, in `.env`) drive the **Socket.io**
  interface, which is the *only* way to create or edit monitors. There is no REST
  monitor API — `/api/monitor` returning 200 is just the SPA serving its HTML.

## Reading status (needs only the API key — works today)

```bash
curl -s -u ":$KUMA_API_KEY" https://bext-kuma.srv1866850.hstgr.cloud/metrics \
  | grep -E 'monitor_status|monitor_cert_days_remaining'
```

Or query Prometheus from inside (it has no public URL):

```bash
ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243 \
  'docker exec bext-prometheus wget -qO- "http://localhost:9090/api/v1/query?query=monitor_status"'
```

`monitor_status`: 1 up · 0 down · 2 pending · 3 maintenance. A **push** monitor
flat at 0 is a workflow that stopped running — the R024 failure, made visible.

## Managing monitors (needs the admin login)

`n8n/kuma-setup.js` is idempotent — matches on name, creates only what's missing,
never edits or deletes. The monitor set lives in that file and mirrors
`docs/SELF-HEALING.md` § Monitors.

```bash
node n8n/kuma-setup.js            # list current + show plan, no writes
node n8n/kuma-setup.js --apply    # create the missing monitors
node n8n/kuma-setup.js --tokens   # print KUMA_PUSH_* lines for the push monitors
```

After `--apply`, paste the push tokens into `.env` **and** `/docker/bext/.env`, then
`node n8n/build-workflows.js` so each workflow's `Heartbeat` node points at a real
token. Until then the tokens are blank and the heartbeat no-ops harmlessly
(`onError: continueRegularOutput`).

Push-token windows and the full monitor list: `references/monitor-set.md`.

## Prometheus

Config: `infra/prometheus/prometheus.yml`. Scrapes exactly two things — Kuma
`/metrics` (via `password_file`, never an inline key — preflight R029) and
`node-exporter` (host memory/CPU/disk). **No cAdvisor**: it reads the host docker
socket and would surface Premier Fitness's containers into BEXT's Grafana. Host
aggregate only. 30-day / 2 GB retention.

## Grafana

Datasource and the "BEXT — Overview" dashboard are provisioned from
`infra/grafana/` — a fresh volume comes up already wired. Edit the dashboard JSON
in the repo, not only in the UI (repo is source of truth).

The headline panel is **host memory available %** — the metric that predicted every
outage on this box (ollama once ate the RAM and took SSH and both n8n instances
down). Below ~10% is the danger zone.

## Deploying / changing the stack

Compose is `infra/docker-compose.yml`. Bring up **only** changed services by name —
a bare `up -d` recreates the 6 GB ollama on an 8 GB host shared with two clients:

```bash
docker compose -p bext up -d prometheus grafana node-exporter uptime-kuma
```

The repeatable deploy from a laptop: `infra/deploy-self-healing.sh` (Kuma + env).
Full stack details and the memory budget: `references/deploy-and-limits.md`.

## Hard rules (from CLAUDE.md, they apply here)

- **Never touch `/docker/n8n`** (Premier Fitness) or `/opt/nfac`. Every `docker`
  command is `-p bext` with named services.
- Secrets stay in `.env` / `/docker/bext/.env`, both gitignored. The Kuma key lives
  in `infra/prometheus/kuma_key` (gitignored, written on deploy). Preflight R027/R029
  fail the build if a token or key reaches a committed file.
- Memory is the constraint. Every service here carries a `deploy.resources.limits`.
  A monitor must never be the cause of the outage it watches for.
