# Infrastructure — where everything actually lives

**Read this before touching hosting, mail, DNS or Microsoft 365.** Every fact here was
verified against the live systems, not copied from a ticket. Where something is counter-intuitive
the reason is given, because the reason is what stops it being "fixed" back to broken.

---

## Hostinger VPS — the application

```
host          187.127.213.243   (srv1866850)
compose        /docker/bext     project name: bext
containers     bext-n8n · bext-postgres · bext-qdrant · bext-fetcher · bext-dashboard
               bext-scrapling · bext-api · bext-ollama · bext-kuma
ssh            ssh -i ~/.ssh/pf-nfac-hostinger root@187.127.213.243
```

> **Never touch `/docker/n8n`.** That is Premier Fitness, a different client, on the same host.
> The container is `n8n-n8n-1`; ours is `bext-n8n`. The `n8n-pf`, `hostinger-pf` and `supabase-pf`
> MCP servers are PF-scoped and must not be used for BEXT.

Postgres and Qdrant bind loopback only. From a laptop everything goes through a tunnel:

```bash
ssh -i ~/.ssh/pf-nfac-hostinger -L 5433:127.0.0.1:5432 -L 8080:127.0.0.1:8080 root@187.127.213.243 -N
```

**Postgres is 5433 locally and 5432 remotely** — `PG_PORT=5433` in `.env` is correct and is not a typo.
Port 5432 on a dev laptop is usually some other Postgres; connecting there silently reads the wrong
database. The fetcher on 8080 must be up or document rendering fails with a connection error that
looks like a code bug.

Public: dashboard `https://bext.dev-environment.site` · n8n `https://bext-n8n.srv1866850.hstgr.cloud`.
Monitoring: `bext-kuma` on `https://bext-kuma.srv1866850.hstgr.cloud` (the hstgr.cloud wildcard, same zone as
n8n — no DNS record needed; it is an ops tool, not client-facing like the dashboard). Publishes no ports — traefik routes it,
same as n8n and the dashboard.

**Three containers must never be restarted by the healer**, and `n8n/self-heal.js` refuses them:
`bext-n8n` (restarting it kills the healer mid-run), `bext-postgres` (it holds the incident log that
says why), `bext-ollama` (slow to warm, so a restart looks like a fix and is a quiet outage).
Preflight R025 fails the build if any of them reaches the allowlist. See `docs/SELF-HEALING.md`.

Memory is the constraint that bites here: 8 GB, two clients. Ollama already carries a 6g ceiling
because memory pressure once took SSH and BOTH n8n instances down. Kuma is capped at 256m for the
same reason — the monitor must never cause the outage it is watching for.
The dashboard reads Postgres directly from server components, so **new data appears without a deploy**.

---

## iFastNet cPanel — mail and DNS

```
cPanel        https://cpanel.dev-environment.site:2083
user          devenvir
auth          CPANEL_TOKEN in .env   ->  Authorization: cpanel devenvir:<token>
server        sv70
zone          dev-environment.site   authoritative at ns1070/ns2070.ifastnet.com
```

Three things that cost hours:

1. **`bext.dev-environment.site` is not its own zone.** `DNS::parse_zone` on it returns *"You do not
   control a DNS zone named …"*. Its records live in the parent zone under the name `bext`.
2. **`parse_zone` returns records as `dname_b64` / `record_type` / `data_b64`.** Reading `text_b64`
   finds nothing and makes the zone look empty of TXT records.
3. **`mass_edit_zone` stores `data` verbatim.** `data_encoding: 'base64'` is *not* honoured — passing
   an encoded value publishes the base64 string as the literal record. This briefly took SPF down on
   19 Aug 2026. Send plain text.

Each write bumps the zone serial, and the API rejects a stale one, so **re-read the serial between
edits** rather than reusing it across a batch.

The zone is shared with unrelated domains — `billing-agent`, `content.engine`, `billsense`,
`neuralyx.ai`. Scope every edit; a careless mass edit breaks someone else's mail.

`cpanel-cli` on PATH handles **email accounts and forwarders only** — it has no DNS verbs.

### Inbound mail needs two things, not one

Fixed 22 Aug 2026 after nothing had ever been delivered to
`reports@bext.dev-environment.site`. Outbound was unaffected throughout, so the
daily report kept arriving and the fault stayed invisible for weeks.

1. **The MX must point at the mail host.** `bext` had `MX → itself`, and its A
   record is `187.127.213.243` — the Hostinger VPS, which runs no mail server.
   Mail is on iFastNet at `185.2.168.30` with the parent domain.
2. **Exim must treat the domain as local.** Correcting DNS is not sufficient.
   With a subdomain on `mxcheck: auto`, Exim decides once and keeps that answer;
   decided while the MX pointed at a remote host, it holds `alwaysaccept: 0` and
   replies `550 Relay not permitted - domain is not a local domain` — while
   cPanel simultaneously lists the domain as a mail domain and reports
   `detected: local`. That contradiction is the signature of this fault.

Both are repaired by `node graph/fix-mail-mx.js --apply`.

**Never conclude a mailbox works from an IMAP login.** A successful login with
messages present proves only that the mailbox can be *read*; it says nothing
about whether anything can reach it. That is exactly how this was missed. Prove
delivery with `node graph/verify-inbound-mail.js`, which sends from outside the
hosting account and waits to read the message back.
Use `graph/fix-mail-dns.js`.

### Mail

```
SMTP          mail.dev-environment.site:465 (implicit TLS)
sender        reports@bext.dev-environment.site
actual path   outbound relays through MailChannels — observed sending IP 23.83.217.10
DKIM          default._domainkey.bext   (published; signature does NOT verify — open issue)
```

**The report is not sent from the VPS.** `+a` in the old SPF resolved to `bext.dev-environment.site`
= 187.127.213.243, the VPS, which never sends mail — that was the bug. And the sending IP is
MailChannels, not the cPanel host, so `include:relay.mailchannels.net` is load-bearing: naming
`185.2.168.30` alone still fails.

Verified state after the 19 Aug fix, from a real message read back through Graph:

```
spf=pass (sender IP is 23.83.217.10)   dmarc=pass   compauth=pass   dkim=fail (open issue)
```

DMARC passes on SPF alignment, so the DKIM failure is not blocking delivery.

---

## Microsoft 365

```
tenant        9eb458d1-317d-4aae-a9a3-bb68e430d701   bextconsultancy.com.au
app           BEXT Automation (Dev)   client b72d1df4-06ec-4390-937a-1293f34d31be
automation    Admin.bext-automation@bextconsultancy.com.au
roles         Teams Administrator · Cloud Application Administrator
team          bext_transcripts records   36840697-dbe5-4294-994d-7a043eef51ca
channel       Bext Transcripts   19:R7FciH4QRVZU7_7EVUg3CH_zCmSIHOoVxrRAM_nFeBA1@thread.tacv2
flow          BEXT — Meeting Report   bbe06a8c-b747-851e-40e7-f1be6157edbc
environment   Default-9eb458d1-317d-4aae-a9a3-bb68e430d701
```

**No application permission exists for posting a channel message.** Graph offers only
`Channel.Create`, `ChannelMessage.Read.All` and `Teamwork.Migrate.All` as application permissions;
`ChannelMessage.Send` is delegated-only. That is why the announcement goes through a Power Automate
flow. Do not go looking for a permission to tick.

**What this tenant has actually granted is narrower than that paragraph implies.** The ten roles on
the token, read from the `roles` claim on 23 Aug 2026:

```
Calendars.ReadWrite          Mail.Read        OnlineMeetings.Read.All
Files.ReadWrite.All          Mail.ReadWrite   OnlineMeetings.ReadWrite.All
OnlineMeetingTranscript.Read.All              Sites.ReadWrite.All
Mail.Send                    User.Read.All
```

`Channel.Create` is **not** among them, and neither is `Group.Read.All` — so the app cannot create a
channel, and `GET /groups` returns `403 Authorization_RequestDenied`, which is why team discovery has
to work from a known team id rather than by listing. Creating a channel is a manual step for the
tenant admin, or a new consent.

Read the roles from the token rather than trusting this file:
`node graph/consent.js` — or decode the `roles` claim of any app-only token.

**The application access policy must be `-Global`.** Granted per user it covers only that user, and
every other host returns `403 — 3003: User does not have access to lookup meeting`, which reads
exactly like a missing permission. `graph/teams-access-policy.ps1` grants it tenant-wide.
Propagation takes up to 30 minutes.

Four transcript gates, all independent, two off by default: admin consent · the application access
policy · tenant *Transcript API access → Microsoft Graph access* · **Transcription** on the meeting
policy.

---

## Commands worth knowing

| Command | What it answers |
|---|---|
| `node graph/health-check.js` | Is everything working right now? Asserts outcomes, not config |
| `node graph/health-check.js --record` | Same, and appends failures to `docs/REGRESSIONS.md` |
| `node graph/verify-meeting-access.js` | Can we read each host's meetings? Separates 403-policy from missing permission |
| `node graph/check-mail-auth.js` | Sends a real probe and reads the receiver's SPF/DKIM/DMARC verdict |
| `node graph/fix-mail-dns.js` | Shows the SPF/DMARC diff; `--apply` writes it |
| `node graph/discover-power-platform.js` | Power Automate licence + environment GO/NO-GO |
| `pwsh -File graph/teams-access-policy.ps1` | Grants the Teams policy `-Global`. Interactive sign-in |

Two n8n behaviours that will waste an afternoon otherwise:

- **A redeploy resets a schedule trigger's countdown.** Deploy three times in fifteen minutes and it
  never fires.
- **A workflow activated through the public API is not registered until n8n restarts.**
  `BEXT — Meeting Intake` sat `active: true` with zero executions until `docker compose -p bext
  restart n8n`. Check `workflow_statistics`, not the `active` flag.

Successful executions are **not** stored (`EXECUTIONS_DATA_SAVE_ON_SUCCESS: none`), so an empty
executions list proves nothing. Failures are stored. The database row is the real signal.
