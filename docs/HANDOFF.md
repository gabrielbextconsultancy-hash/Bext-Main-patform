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
2. **Write `Minutes.docx` last** so the Power Automate channel post announces a complete record.
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
- **Teams Administrator** on `Admin.bext-automation@`, which would have avoided four of the five
  escalations on 17 August. The account currently holds no directory roles.
- Xero credential; HubSpot `crm.objects.companies.read` scope (verified missing — companies
  returns 403); ProjectManager hourly rates (all 13 projects at 0, which blocks profitability and
  is the main purpose of the Xero integration).
- Lapsed licence: `O365 Business Premium` shows 0 purchased, 1 assigned, attached to the mailbox
  that sends the 05:00 report.

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
