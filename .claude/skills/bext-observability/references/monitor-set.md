# The BEXT monitor set

Defined in `n8n/kuma-setup.js` (the `MONITORS` array), mirrored here and in
`docs/SELF-HEALING.md`. Keep the three in step.

## HTTP — public (TLS expiry watched automatically)

| Monitor | URL | Interval |
|---|---|---|
| n8n | https://bext-n8n.srv1866850.hstgr.cloud/healthz | 60s |
| dashboard | https://bext.dev-environment.site | 60s |
| proposal deck | https://bext.dev-environment.site/proposal | 300s |

The proposal deck is monitored separately from the dashboard root — it is
client-facing and unauthenticated, and a routing change can 404 one without the other.

## HTTP / TCP — internal (Kuma is on `bext_internal`, service names resolve)

| Monitor | Target | Interval |
|---|---|---|
| fetcher | http://fetcher:8080/health | 60s |
| scrapling | http://scrapling:8090/health | 60s |
| api | http://api:8090/health | 60s |
| qdrant | http://qdrant:6333/healthz | 300s |
| ollama | http://ollama:11434/api/tags | 300s |
| postgres | TCP postgres:5432 | 60s |

## DNS — mail (the daily report failed SPF for weeks while reporting "up")

| Monitor | Record | Interval |
|---|---|---|
| mail SPF | TXT bextconsultancy.com.au | 1h |
| mail DMARC | TXT _dmarc.bextconsultancy.com.au | 1h |

DKIM has a selector-specific name; add it in the UI once the selector is confirmed.

## Push — the deadmen (window = workflow cadence + one missed run)

| Monitor | Cadence | Window | `.env` key |
|---|---|---|---|
| wf source-ingest | hourly | 5400s | `KUMA_PUSH_SOURCE_INGEST` |
| wf article-analysis | 30 min | 2700s | `KUMA_PUSH_ARTICLE_ANALYSIS` |
| wf meeting-intake | 15 min | 1500s | `KUMA_PUSH_MEETING_INTAKE` |
| wf self-heal | 15 min | 1500s | `KUMA_PUSH_SELF_HEAL` |
| wf daily-report | 05:00 | 93600s | `KUMA_PUSH_DAILY_REPORT` |
| wf daily-news-card | 05:20 | 93600s | `KUMA_PUSH_DAILY_NEWS_CARD` |
| wf graph-health | 06:00 | 93600s | `KUMA_PUSH_GRAPH_HEALTH` |
| wf contract-test | 02:00 | 93600s | `KUMA_PUSH_CONTRACT_TEST` |

**Newsletter Intake has no push monitor by design** — it is IMAP-triggered, not
scheduled, so there is no cadence for it to be dead against. A deadman on it would
go red every quiet weekend, and a monitor that cries wolf is worse than none.

## Not monitored, deliberately

- **Premier Fitness (`/docker/n8n`) and `/opt/nfac`** — another client's endpoints
  do not belong in a BEXT-operated monitor.
- **Total host loss** — Kuma is on the host, so it cannot report the host being gone.
  That belongs to Hostinger's own monitoring.
