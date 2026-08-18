# Traps in the unattended pipeline

Each of these was found the hard way. None produces an error message that points at its cause.

## The meetings API rejects a UPN

Mail and calendar accept `Admin.bext-automation@bextconsultancy.com.au`. Online meetings do not —
they need the **object GUID**:

```
GET /users/{upn}?$select=id     → me.id
GET /users/{me.id}/onlineMeetings…
```

The inconsistency is undocumented where you would look for it, and the failure reads as a
permissions problem.

## SharePoint compound paths return 400

`/sites/{host}:/sites/{name}:/drive/root:/{path}` does not work. Resolve the drive id first. See
`sharepoint-paths.md`.

## Power Automate answers 202, not 200

The webhook returns `202 Accepted`. Test `r.ok`, never `r.status === 200`. A `=== 200` check makes
every successful post look like a failure and invites a duplicate retry.

## No application permission can post a channel message

Only `Channel.Create`, `ChannelMessage.Read.All` and `Teamwork.Migrate.All` exist.
`ChannelMessage.Send` is delegated-only. This is a platform gap, not a consent gap — the
`TEAMS_MEETING_WEBHOOK_URL` flow exists precisely because of it. Do not go hunting for a
permission to tick.

## Empty transcripts are sometimes legitimate

Check in this order before suspecting the code:

1. Was the meeting actually transcribed?
2. Is the tenant control *Transcript API access → Microsoft Graph access* still on? Microsoft
   added it late July 2026 and it defaults to **off**.
3. Is transcription still enabled on the meeting policy? It produced output on only two of five
   attempts before settling, so intermittency here has precedent.

Gates 2 and 3 need a directory role the automation account does not hold. That makes it a client
escalation, not a fix.

## Near-duplicate transcript lines — unsolved

Two Teams clients in one call transcribe the same utterance twice with small differences ("rate
cards" versus "read cards"). Left in, the model sees every action twice.

**The prefix match committed in `b2077d6` does not work.** It needs real similarity matching —
normalised edit distance or token overlap over a sliding window, not a prefix comparison. Treat
this as open. Do not assume the pipeline handles it.

## The card builder is inlined into a template literal

`n8n/lib/meeting-card.js` is read and interpolated into a template string by
`n8n/build-workflows.js`. A backtick or a `${` anywhere in that file — **comments included** — is
evaluated at build time and silently corrupts the copy that reaches n8n.

Rules for that file: single quotes and string concatenation only. No `require`, no `fetch`, no
`process.env`. The same applies to `n8n/lib/ingest.js`.

The corruption is silent. The workflow deploys, then fails at runtime with a syntax error that
does not match the file on disk.

## Adaptive Cards 1.4, not 1.5

The `Table` element is 1.5 and renders inconsistently through the Power Automate post action.
Tables are hand-built from `ColumnSet`s. A `ColumnSet` does not wrap, so callers cap each chip row
at four columns.

The card builds to a **26 KB ceiling** and sheds detail to reach it — Teams rejects payloads
around 28 KB, and a card that fails to post tells the channel nothing at all.

## The fetcher is loopback-only

`/render-docx` binds to `127.0.0.1:8080` on the VPS. It was never published on the host, so the
tunnel described in `docs/05-runbook.md` could never have worked as written. Local runs need:

```bash
ssh -i ~/.ssh/pf-nfac-hostinger -L 8080:127.0.0.1:8080 root@187.127.213.243 -N
```

Also: `/docker/fetcher` on the VPS is a **symlink** to `/docker/bext/fetcher`, because the repo's
compose build context does not match the deployed layout.

## Drafts are drafts

Stage 5 creates an unsent draft and stops. BEXT reviewing and sending is steps 9 and 10 of the
client's ten-step process, and keeping that boundary is the point of the engagement. Do not
convert this to a send.
