# Observability — Kuma, Prometheus, Grafana

The monitoring stack for the BEXT engagement. This file is the map; the operating
detail lives in the `bext-observability` skill (`.claude/skills/bext-observability/`)
and the monitor set is in `docs/SELF-HEALING.md` § Monitors.

## What runs where

| Container | Role | URL | Mem |
|---|---|---|---|
| `bext-kuma` | Uptime monitoring + push deadmen | https://bext-kuma.srv1866850.hstgr.cloud | 256m |
| `bext-prometheus` | Scrapes Kuma `/metrics` + host metrics | internal only | 512m |
| `bext-node-exporter` | Host memory / CPU / disk | internal only | 96m |
| `bext-grafana` | Dashboards over Prometheus | https://bext-grafana.srv1866850.hstgr.cloud | 384m |

All in docker project `bext` on the Hostinger VPS. On the `srv1866850.hstgr.cloud`
host zone (Hostinger wildcard — no DNS record) like n8n, because they are ops tools,
not client-facing like the dashboard on `dev-environment.site`.

## The layers, and why each exists

1. **Kuma** answers "is it up" (HTTP/TCP/DNS) and — the part that matters — "did the
   workflow actually run" (push deadmen). A workflow can be active and not running;
   only the deadman sees that (the R024 failure).
2. **Prometheus** turns Kuma's instantaneous `/metrics` into history, and adds host
   memory/CPU/disk from node-exporter. Deliberately narrow: Kuma + host aggregate,
   no cAdvisor, because per-container metrics would expose Premier Fitness's
   containers into BEXT's Grafana.
3. **Grafana** makes it legible. The "BEXT — Overview" dashboard leads with host
   **memory available %** — the metric that predicted every outage on this shared box.

Two Grafana datasources, two dashboards beyond the ops overview:
Prometheus feeds **BEXT — Overview**; a read-only Postgres role (`grafana_ro`,
db/migrations/025) feeds **BEXT — Self-Healing** (heal success rate, MTTR, incidents by
outcome) and the GitHub datasource feeds **BEXT — GitHub**.

## Two auth planes on Kuma (the thing people get wrong)

- `KUMA_API_KEY` → read-only `/metrics` only. Prometheus uses it; it cannot create
  monitors.
- `KUMA_USER` / `KUMA_PASS` → the Socket.io admin interface, the only way to
  create/edit monitors. `n8n/kuma-setup.js` drives it.

## First-time setup

1. `bash infra/deploy-self-healing.sh` — Kuma + n8n env (done 24 Aug 2026).
2. Ship the Prometheus/Grafana configs + compose, write `infra/prometheus/kuma_key`
   from `KUMA_API_KEY`, `docker compose -p bext up -d prometheus grafana node-exporter`
   (done 24 Aug 2026).
3. Create the Kuma admin account in the UI; put `KUMA_USER`/`KUMA_PASS` in `.env`.
4. `node n8n/kuma-setup.js --apply` then `--tokens`; paste push tokens into `.env`
   and `/docker/bext/.env`; `node n8n/build-workflows.js`.
5. Log into Grafana and change the admin password immediately (starts admin/admin).

Full operating instructions: the `bext-observability` skill.
