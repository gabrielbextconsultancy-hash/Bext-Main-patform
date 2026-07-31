# Runbook

## Hosts

| Service | URL | Notes |
|---|---|---|
| BEXT n8n | https://bext-n8n.srv1866850.hstgr.cloud | compose project `bext` |
| BEXT n8n MCP | https://bext-n8n.srv1866850.hstgr.cloud/mcp-server/http | needs `Authorization: Bearer <n8n API key>` |
| Dashboard (local) | http://localhost:3000 | needs the SSH tunnel open |
| **Premier Fitness n8n** | https://n8n.srv1866850.hstgr.cloud | **different client — do not touch** |

Both instances share VPS `1866850` (`187.127.213.243`) and the traefik that the Premier
Fitness compose project owns. The subdomains resolve through the wildcard
`*.srv1866850.hstgr.cloud` record, so new hostnames need no DNS work.

## SSH

```bash
ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243
```

## Database

Postgres binds to loopback on the VPS. Local access goes through a tunnel:

```bash
ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 root@187.127.213.243 -N
```

Leave that running in its own terminal, then:

```bash
psql "postgresql://bext@127.0.0.1:5433/bext"
```

Two databases on the one server, deliberately separate: `bext` (application data,
managed by `db/migrations/`) and `n8n` (workflow metadata, managed by n8n itself).
Migrations never touch `n8n`.

### Applying a migration

```bash
scp -i ~/.ssh/pf-nfac-hostinger db/migrations/00N_x.sql root@187.127.213.243:/tmp/
ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243 \
  'docker exec -i bext-postgres psql -U bext -d bext -v ON_ERROR_STOP=1 < /tmp/00N_x.sql'
```

Migrations are append-only. Never edit one that has been applied.

### Reseeding sources

After editing `sources/registry.yaml` (with the tunnel open):

```bash
node db/seed-sources.js
```

Idempotent upsert on `slug`. Runtime columns — `last_fetch_at`, `last_status`,
`consecutive_failures` — are never overwritten.

## Docker stack

```bash
ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243
cd /docker/bext
docker compose -p bext ps
docker compose -p bext logs -f n8n
docker compose -p bext restart n8n
```

`docker compose -p bext down` stops only BEXT. Never run compose commands from
`/docker/n8n` — that is the other client's stack, and it owns traefik and ports 80/443
for both.

### The traefik arrangement

The BEXT n8n container joins the `n8n_default` network as an external network and
carries `traefik.*` labels with router name `bext-n8n`. Traefik watches the shared
Docker socket, sees the labels, and issues a Let's Encrypt certificate over the TLS
challenge. If routing ever breaks, check in this order: container is on `n8n_default`,
the router name does not collide with `n8n`, and `traefik.docker.network` is set.

## Dashboard

```bash
cd dashboard
npm run dev        # http://localhost:3000 — requires the SSH tunnel
npm run build
```

`dashboard/.env.local` carries the `PG_*` values. It is generated from the root `.env`:

```bash
grep -E '^PG_' ../.env > .env.local
```

Every page reads Postgres directly through a server component. With the tunnel closed
the pages render a "database unreachable" panel rather than erroring.

## Workflows

Generated and deployed from the repo, never hand-edited in the UI:

```bash
node n8n/build-workflows.js         # build, deploy, write JSON to n8n/workflows/
node n8n/build-workflows.js --dry   # build and write JSON only
```

The parser in `n8n/lib/ingest.js` is inlined into the Code node at build time, so the
implementation tested by `node n8n/dry-run.js` is the one that runs in production.

Grouping is by **tag**, not folder: `feat:folders` requires an enterprise licence and is
rejected on Community Edition. Every workflow is named `BEXT — ...` and carries the
`BEXT Consultancy` tag, which the build script applies.

The public API has no manual-run endpoint (`POST /workflows/{id}/run` returns 405), so a
schedule-triggered workflow can only be tried from the UI's **Execute workflow** button
or by waiting for its next tick.

## n8n instance MCP

n8n exposes an instance-level MCP endpoint at `/mcp-server/http`, authenticated with an
n8n API key. Registering it gives direct tool access to workflows on that instance.

```bash
claude mcp add --scope user --transport http n8n-bext \
  https://bext-n8n.srv1866850.hstgr.cloud/mcp-server/http \
  --header "Authorization: Bearer <BEXT n8n API key>"
```

Use the **`bext-n8n`** hostname. The bare `n8n.srv1866850.hstgr.cloud` endpoint is the
Premier Fitness instance; pointing BEXT tooling at it would create this client's
workflows inside another client's n8n.

The existing `n8n-pf` MCP server stays as it is — it belongs to Premier Fitness.

## Backups

- **`N8N_ENCRYPTION_KEY`** in `.env` is irreplaceable. Every stored n8n credential is
  encrypted with it; losing it means re-entering every credential by hand.
- Hostinger takes VPS snapshots. Docker volumes `bext_pgdata`, `bext_qdrant` and
  `bext_n8n` hold all state.
- Workflow JSON lives in `n8n/workflows/` in this repo, which is the actual source of
  truth — the n8n UI is not.

## Production handover (post 8 Sep 2026)

Per `PLAN 1 First task.pdf` the client owns production. At handover:

1. Client provisions their own VPS, or this one transfers to their Hostinger account.
2. Client creates their own Azure App Registration in their production tenant, and the
   `Mail.Send` application permission gets scoped down with an application access policy
   so it can only send as the one mailbox it needs — the dev sandbox does not bother.
3. Client supplies their own AI subscription (OpenAI, Claude, or Azure OpenAI).
4. Reverse proxy, SSL and the automation subdomain move to the client's domain.
