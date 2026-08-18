# The three authentication paths

Each path exists because the other two cannot do its job. None of them is a fallback for another.

---

## Path 1 — Graph app-only (client credentials)

**Credential:** `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` in `.env` (gitignored).

**Token request:**

```
POST https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={MS_CLIENT_ID}
client_secret={MS_CLIENT_SECRET}
scope=https://graph.microsoft.com/.default
grant_type=client_credentials
```

**Used by:** `graph/verify.js`, `graph/run-meeting-once.js`, `graph/provision-sharepoint.js`,
`graph/make-interim-template.js`, and the `BEXT — Meeting Intake` and `BEXT — Graph Health`
workflows (where the same recipe is inlined into `MEETING_CODE` / `GRAPH_HEALTH_CODE` by
`n8n/build-workflows.js`).

**Can:** read meeting transcripts, read and write SharePoint drives, send and draft mail, read
users, create channels.

**Cannot:** post a channel message. There is no application permission for it — only
`Channel.Create`, `ChannelMessage.Read.All` and `Teamwork.Migrate.All` exist. Route posting
through Power Automate (`bext-n8n-teams-bridge`) or the delegated path.

**Fails as:** `401` with an expired or rotated secret; `403` when a gate has regressed; an empty
`transcripts` array when gate 3 or 4 is off.

---

## Path 2 — teams-mcp, delegated device code

**Credential:** an interactive device-code sign-in, cached at `~/.teams-mcp-token-cache.json`
with metadata in `~/.msgraph-mcp-auth.json`. No app registration is involved — the package uses
the Microsoft Graph Command Line Tools public client.

**Identity:** `Admin.bext-automation@bextconsultancy.com.au`.

**The user runs this. The agent must never perform a sign-in.**

```bash
npx -y @floriscornel/teams-mcp@0.9.0 authenticate
```

Then confirm:

```
mcp__teams__auth_status
mcp__teams__get_current_user
```

**Can:** post and reply to channels and chats, read message history, upload files, search
messages by KQL, list teams, channels and members, react to messages.

**Cannot:** run unattended — the token is tied to a live sign-in and will eventually need
refreshing interactively. **Never reference this path from an n8n workflow.** It also cannot
create teams, channels, meetings, adaptive cards or webhooks.

**Access depends on membership, not directory roles.** `Admin.bext-automation@` holding no
directory roles does not block posting; not being a member of `bext_transcripts records` does.

**Fails as:** `❌ Not authenticated` from `auth_status` when the token is absent or expired;
`403` on a team the account has not joined; `AADSTS65004` if tenant user consent is disabled, in
which case Brent must consent the Graph CLI client once.

---

## Path 3 — `az login` → FlowAgent MCP

**Credential:** the Azure CLI's token cache. FlowAgent shells out to
`az account get-access-token` for audience `https://service.flow.microsoft.com`, and uses an
inlined MSAL public client for `https://api.powerplatform.com` when managing connections.

**The user runs this.**

```bash
az login --tenant 9eb458d1-317d-4aae-a9a3-bb68e430d701 --allow-no-subscriptions
```

`--allow-no-subscriptions` is required, not cosmetic. FlowAgent maps the CLI's
`No subscription found` error to "not signed in", so a plain `az login` against a
subscription-less tenant reports a misleading authentication failure.

**Can:** list, get, create, edit, copy, publish, disable and delete Power Automate cloud flows;
read run history; diagnose failed runs; manage connections; work with desktop (RPA) flows.

**Cannot:** do anything without a Power Platform environment and a Power Automate licence. Run
the discovery gate first — see `bext-power-automate`.

**Fails as:** "not signed in" (usually the missing `--allow-no-subscriptions`); an empty
environment list when the tenant has no Power Platform environment; licence errors on create or
publish when the Flow service plan is not provisioned.

---

## Quick decision table

| Task | Path |
|---|---|
| Read a meeting transcript on a schedule | 1 |
| File a document into SharePoint on a schedule | 1 |
| Draft an email for review | 1 |
| Post the meeting record to the channel, from a workflow | 3 (flow called by 1) |
| Post to a channel right now, in a session | 2 |
| Search Teams history for a decision | 2 |
| Upload a file to a channel in a session | 2 |
| Create or edit a Teams Workflow | 3 |
| Check whether a flow run failed and why | 3 |
