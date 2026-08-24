# Deploy, memory budget, and the auth key file

## Containers and their caps (8 GB host, two other clients)

| Container | Image | Mem cap | Exposure |
|---|---|---|---|
| bext-kuma | louislam/uptime-kuma:1 | 256m | traefik (public) |
| bext-prometheus | prom/prometheus | 512m | internal only |
| bext-node-exporter | prom/node-exporter | 96m | internal only |
| bext-grafana | grafana/grafana | 384m | traefik (public) |

~1.25 GB of new caps. Verified free after deploy: ~5.7 GB. Ollama already carries a
6 GB cap because memory pressure once took SSH and both n8n instances down — the
monitoring stack must never be the thing that causes the outage it watches for.

## The Kuma key file

Prometheus authenticates to Kuma's `/metrics` with `password_file:
/etc/prometheus/kuma_key`. That file is:

- **gitignored** (`infra/prometheus/kuma_key`), written on deploy from `KUMA_API_KEY`
  in `/docker/bext/.env`,
- `chmod 600`, `chown 65534:65534` (Prometheus runs as `nobody`).

Never put the key in `prometheus.yml`. Preflight **R029** fails the build if a
`uk1_...` key or a literal Grafana password appears in any committed `infra/` file.

## Deploying a change

From a laptop with `.env` holding `VPS_HOST` / `VPS_SSH_KEY`:

1. Edit `infra/docker-compose.yml` or the `infra/prometheus` / `infra/grafana` configs.
2. `node n8n/preflight.js` — must be green (R027, R029 guard the secrets).
3. Ship the changed files and bring up **only** the affected services:

```bash
scp -i ~/.ssh/pf-nfac-hostinger infra/docker-compose.yml root@187.127.213.243:/docker/bext/docker-compose.yml
scp -i ~/.ssh/pf-nfac-hostinger -r infra/prometheus infra/grafana root@187.127.213.243:/docker/bext/
ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243 \
  'cd /docker/bext && docker compose -p bext up -d prometheus grafana'
```

Prometheus supports config hot-reload (it runs with `--web.enable-lifecycle`):

```bash
docker exec bext-prometheus wget -qO- --post-data= http://localhost:9090/-/reload
```

## Grafana first login

Deployed with `GF_SECURITY_ADMIN_PASSWORD` blank, so it starts on `admin` / `admin`
and **forces a password change at first login**. Because it is on a public URL, do
that immediately, or set `GF_SECURITY_ADMIN_PASSWORD` in `/docker/bext/.env` and
`docker compose -p bext up -d grafana` before anyone reaches it.

## Backups

Both deploy scripts copy `.env` and `docker-compose.yml` to timestamped `.bak-*`
files on the VPS before changing anything. To roll back, restore the pair and bring
the services back up.
