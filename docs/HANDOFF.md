# Handoff — 17 August 2026

Paste the "Start here" block into a new session. Everything else is reference.

---

## Start here

> Read `STRUCTURE.md`, then `docs/HANDOFF.md`, then `docs/meeting-workflow-v2.md`.
>
> We are building Brief B review area 3: a Teams meeting produces minutes, an actions register and
> a draft email with no manual work, so BEXT only reviews and sends (steps 9–10 of the client's
> ten-step process).
>
> The pipeline works end to end, driven by hand via `node graph/run-meeting-once.js`. The next job
> is porting it into the scheduled n8n workflow `BEXT — Meeting Intake`, which is deployed but
> inactive and still holds an older five-field version. Then the Excel actions register, transcript
> dedup, and a dashboard view.
>
> Load the `microsoft-teams` skill before any Teams UI work.

---

## Done — 19 August 2026: the daily report, Brent's meetings, and a health check

Four things were broken. All four were found by testing rather than by reading configuration, and
in three of them the configuration looked correct while the behaviour was not.

**The daily report failed SPF and went to spam.** It had sent successfully 409 times, so every
dashboard said healthy. The `bext` SPF record named none of the machines that send it: `+a` resolved
to the VPS, which never sends mail; `+mx` matched nothing because `bext` has no MX; and neither
listed IP was the sender. Repaired via the cPanel DNS API and verified by sending a real message and
reading the receiver's verdict — `spf=pass`, `dmarc=pass`, `compauth=pass`, `BCL:0`.

The real sending IP turned out to be **MailChannels** (23.83.x), not the cPanel host. Naming
`185.2.168.30` alone would still have failed; `include:relay.mailchannels.net` is what makes it pass.

> While fixing it I briefly published a broken record. `mass_edit_zone` stores `data` verbatim and
> ignores `data_encoding: 'base64'`, so the encoded value became the literal TXT record and the
> domain had no valid SPF for a few minutes. Send plain text. Each write also bumps the zone serial,
> so a batch must re-read it between edits.

**Brent's meetings could not be read.** `403 — 3003: User does not have access to lookup meeting`,
which reads exactly like a missing permission and is not: the application access policy was granted
per user rather than `-Global`. Two runs of `teams-access-policy.ps1` changed nothing because the
script set `$ErrorActionPreference = 'Stop'` and the already-present AppId threw, aborting it before
the grant. Fixed, granted tenant-wide, and both hosts now verify.

**`BEXT — Graph Health` had 7 errors and 0 successes** — the alarm was the broken thing, which is
why the report's spam problem went unnoticed for weeks. `column "status" is of type health_status
but expression is of type text`: the cast existed in the repo but had never been deployed.

**The dashboard showed the wrong recipients.** `reports.recipient` is written through
`queryReplacement`, which splits its value on commas, so a two-address list stored inconsistently —
one address on some days, both on others. Delivery was never affected; the SMTP node uses a direct
expression. Now stored semicolon-separated. Confirmed by probe that Brent does receive the report.

### Added

- `graph/health-check.js` — asserts outcomes, not configuration. `--record` appends failures to
  `docs/REGRESSIONS.md`. Deliberately passes on intentionally-inactive workflows and a missing local
  tunnel, because a monitor that cries wolf is how Graph Health's failures stayed invisible.
- `graph/verify-meeting-access.js` — separates a policy 403 from a missing permission, per host.
- `graph/check-mail-auth.js` — sends a real probe and reads the receiver's SPF/DKIM/DMARC verdict.
  A published record is not proof; this is.
- `graph/fix-mail-dns.js` — `--check` / `--apply` against the cPanel DNS API, scoped to `bext` only
  because the zone is shared with four unrelated domains.
- `docs/INFRASTRUCTURE.md` — the verified map, referenced from `CLAUDE.md` so it loads every session.

### Still open

1. **DKIM does not verify** — `dkim=fail (signature did not verify)`. DMARC passes on SPF alignment
   so it is not blocking delivery, but it should be fixed. Likely MailChannels altering the message
   in transit, or a key that no longer matches DNS.
2. `MEETING_CODE` still lacks multi-host discovery, the generated title and the real recipient list —
   they exist only in `graph/run-meeting-once.js`, so the scheduled workflow still polls one calendar.
3. Brent has not yet hosted a Teams meeting with transcription on, so the end-to-end path is proven
   only from the automation account's own meetings.

---

## Done — 18 August 2026: the channel announcement is live

`BEXT — Meeting Report`, Power Automate flow `bbe06a8c-b747-851e-40e7-f1be6157edbc`, Started, posting
Adaptive Cards into `bext_transcripts records` › **Bext Transcripts**. Verified by two live cards
rather than by a status code — the channel messages carry
`application/vnd.microsoft.card.adaptive` attachments.

- **Graph cannot post channel messages** and no permission exists for it. The flow is the answer.
- **The generic HTTP trigger is premium** (`MissingAdequateQuotaPolicy`). `kind: "TeamsWebhook"` is
  standard-tier and is what we use.
- **Flows can be created but not updated** through the API here. Updates route through Dataverse and
  demand `host.connectionReferenceName`, which neither the REST API nor FlowAgent supplies. Replace,
  do not patch — three attempts died on this.
- **`triggerAuthenticationType: "Tenant"` rejects app-only tokens** (`MisMatchingOAuthClaims`): Entra
  issues the audience without the trailing slash the policy demands. `"Anonymous"` is in use, so
  **the trigger URL is a bearer secret** and lives only in `.env`.
- **The leading `@` on the card expression is load-bearing.** Without it Power Automate stores a
  literal string and the channel receives expression text instead of a card. The designer omitted it.
- **PDF renditions**: Graph `?format=pdf` converts rendered documents. `.vtt` has no SharePoint
  preview handler, so the transcript is rewritten as readable speaker turns, filed as
  `Transcript.docx`, then converted. Card buttons prefer the PDF and fall back to the original.
  The minutes *template* will not convert — its `{#loop}` placeholders defeat Word's exporter.
- **Attendees matching a tenant account are @mentioned**; the rest stay plain text.

Tenant facts verified live, correcting stale notes below: the flow owner's Power Automate licence
passes, an environment exists, `Admin.bext-automation@` holds **Teams Administrator** and
**Cloud Application Administrator**, and Brent is now a member of the team, so the card has an
audience.

### Still to do

1. Port into `MEETING_CODE` so the scheduled n8n workflow posts the card too.
2. Apply migration `011` — needs the SSH tunnel to Postgres.
3. A real end-to-end run — needs the fetcher tunnel on `127.0.0.1:8080`.
4. Delete `Bext Transcripts/_pipeline-verification/` and the two verification cards.

---

## Working and verified

Verified by reading document contents, not by checking files exist.

- **Microsoft Graph** — app `BEXT Automation (Dev)`, client `b72d1df4-06ec-4390-937a-1293f34d31be`,
  tenant `9eb458d1-317d-4aae-a9a3-bb68e430d701`. Ten application permissions consented.
- **Four Teams gates**, all cleared, each independent and each found the hard way:
  1. Admin consent (Brent)
  2. Application access policy, granted `-Global`
  3. Tenant *Transcript API access → Microsoft Graph access* — a control Microsoft added late
     July 2026, off by default
  4. Transcription enabled on the meeting policy
- **Minutes template** — the client's worked example converted to a fillable template by
  `templates/build-minutes-template.py`. Five loops (`attendees`, `safety`, `projects`, `finance`,
  `actions`) plus six header fields. Live in SharePoint.
- **Pipeline** — `graph/run-meeting-once.js`: transcript → Gemini extraction → template fill via
  the fetcher's `/render-docx` → files into the channel folder and the BEXTHQ archive → unsent
  Outlook draft. Flags: `--dry`, `--file x.vtt`.
- **Extraction quality**, on check-in content: correct statuses from the template's own vocabulary,
  DNSP notes captured, owners attributed, the deliberately unowned action left `Unassigned`, the
  closed action closed, small talk dropped. On two content-free transcripts it correctly returned
  empty arrays rather than inventing rows.
- **Channel record** — `bext_transcripts records` / `Bext Transcripts`, site
  `/sites/bext_transcriptsrecords`, library `Documents`. One folder per meeting holding
  `Transcript.vtt`, `Minutes.docx`, `Summary.docx`.
- **Database** — migrations through `010`. `programs`, `participants`, `program_projects`,
  `actions`, `meeting_minutes`.
- **`BEXT — Graph Health`** — active, daily 06:00, writes `integration_health`, mails on failure.

## Next, in order

1. **Port the pipeline into `BEXT — Meeting Intake`.** `graph/run-meeting-once.js` is the working
   reference; `MEETING_CODE` in `n8n/build-workflows.js` is the older version to replace. Keep it
   inactive until one scheduled run has been watched.
2. ~~**Write `Minutes.docx` last**, and the channel announcement~~ — **done and live**. See the
   18 August section above. The card is built by `n8n/lib/meeting-card.js` and posted to
   `TEAMS_MEETING_WEBHOOK_URL`; the envelope is verified.
3. **Excel actions register** — schema exists, generation does not. Per-project numbering restarts
   at 1, matching the supplied file. Store `Open`/`Closed`, render `Done` in the Word table.
4. **Transcript dedup — unsolved.** Two Teams clients in one call produce near-duplicate lines
   ("rate cards" / "read cards"). The prefix match committed in `b2077d6` does *not* work; it needs
   real similarity matching. Do not assume it is handled.
5. **Dashboard report view** — meetings, links to documents, open actions across meetings. Reads
   `meeting_minutes` and `actions` directly.

## Open questions for the client

- **Attendee emails.** The template has an email column; a transcript gives names only. Either
  maintain `participants` per program or leave the column for review.
- **Scope** — RACV only at first, or every client.
- **Register** — one across all projects, or one per client. The supplied file mixes projects,
  which suggests one.

## Still with Brent

- `Transcription` on the meeting policy if it regresses — it produced output on only two of five
  attempts before settling.
- ~~**Teams Administrator** on `Admin.bext-automation@`~~ — **granted**, verified 18 Aug. The account
  holds Teams Administrator and Cloud Application Administrator. Brent has been added to
  `bext_transcripts records`, so the announcement card has a human audience.
  See `docs/BRENT-TEAMS-ADMIN.md` — his outstanding list is now empty.
- Xero credential; HubSpot `crm.objects.companies.read` scope (verified missing — companies
  returns 403); ProjectManager hourly rates (all 13 projects at 0, which blocks profitability and
  is the main purpose of the Xero integration).
- ~~Lapsed licence: `O365 Business Premium`~~ — **not a blocker**, verified 18 Aug against
  `subscribedSkus`. The expired SKU sits on `Brent@`, not on the report sender, and Brent also holds
  `BUSINESS_PREMIUM_AND_MICROSOFT_365_COPILOT_FOR_BUSINESS` (2 prepaid / 2 consumed). `MS_SENDER_UPN`
  is `Admin.bext-automation@`, which is licensed. Nothing to buy.

## Traps found the hard way

- The **meetings API rejects a UPN** and needs the user's object GUID, unlike mail and calendar.
- **SharePoint compound paths 400.** `/sites/host:/sites/name:/drive/root:/path` does not work;
  resolve the drive id first.
- **No application permission exists for posting channel messages.** Only `Channel.Create`,
  `ChannelMessage.Read.All`, `Teamwork.Migrate.All`. Hence the Power Automate flow.
- **teams-mcp is delegated** — tied to a live sign-in, so it cannot serve the unattended pipeline.
- **Teams web takes ~30s to boot** in the Edge profile; an empty body is not a failure.
- The **fetcher was never published on the host**, so the tunnel in `docs/05-runbook.md` could
  never have worked. Now on `127.0.0.1:8080`.
- `/docker/fetcher` on the VPS is a **symlink** to `/docker/bext/fetcher`, because the repo's
  compose build context does not match the deployed layout.

## Commands

```bash
node graph/run-meeting-once.js            # newest transcript, full run
node graph/run-meeting-once.js --dry      # extract only
node graph/verify.js                      # four Graph checks
node n8n/build-workflows.js               # build and deploy all workflows
python templates/build-minutes-template.py
```

The fetcher needs an SSH tunnel for local runs:
`ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 root@187.127.213.243 -N`
