# The discovery gate

`graph/discover-power-platform.js` — read-only, app-only, no new Graph permission. Run it before
any Power Automate work.

```bash
node graph/discover-power-platform.js
```

It exists because a flow created into a tenant with no environment or no licence fails late, in a
place that looks like a code problem.

## What it checks

### 1. Licence

```
GET /users/{owner}/licenseDetails
```

Looks for a service plan matching `FLOW_O365_*`, `POWERAUTOMATE*`, `FLOW_P*` or `DYN365_*` with
`provisioningStatus: Success`.

**As of 17 August 2026 this passes.** `Admin.bext-automation@` holds:

```
FLOW_O365_P1        (BUSINESS_PREMIUM_AND_MICROSOFT_365_COPILOT_FOR_BUSINESS)  Success
DYN365_CDS_O365_P3  (BUSINESS_PREMIUM_AND_MICROSOFT_365_COPILOT_FOR_BUSINESS)  Success
FLOW_P2_VIRAL       (FLOW_FREE)                                                Success
DYN365_CDS_VIRAL    (FLOW_FREE)                                                Success
```

**Do not confuse this with the lapsed licence in `docs/HANDOFF.md`.** That one is
`O365 Business Premium` at 0 purchased / 1 assigned, attached to the **report sender mailbox** —
a different account, and a real problem for the 05:00 report, but not a blocker for Power
Automate. The flow owner is licensed.

A flow owned by an unlicensed account stops running **without warning**. That is the failure mode
this check exists to catch early, and it is why the check names the account it examined.

### 2. Environment

```bash
az rest --method get \
  --url "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments?api-version=2020-10-01" \
  --resource "https://api.bap.microsoft.com/"
```

Two details that both cost time:

- **`--resource` is required.** `az` cannot derive an audience from a non-ARM host and will send
  no `Authorization` header at all, which comes back as `MissingAuthorizationHeaderAndClientCertificate`
  — a message that reads like a tenant problem rather than a missing flag.
- **Use the user-scoped collection, not `/scopes/admin/`.** The admin variant needs a Power
  Platform Administrator role and returns an **empty list** rather than a 403 without it. That
  reads as "this tenant has no environments" and is wrong. What matters is what the flow *owner*
  can build in.

**As of 17 August 2026 this passes:**

```
Brent Craig (default) — Default (default)
id  Default-9eb458d1-317d-4aae-a9a3-bb68e430d701
region  australia / australiaeast
```

That id is what `PA_DEFAULT_ENVIRONMENT` in `.mcp.json` is set to.

Needs `az login --allow-no-subscriptions`. On this machine that has already happened —
`az account show` reports `Admin.bext-automation@bextconsultancy.com.au` on the BEXT tenant as a
tenant-level account with no subscription.

### 3. Membership

```
mcp__teams__list_teams
```

Must include `bext_transcripts records`. If it does not, the automation account is not a member,
and the flow will fail to post regardless of which auth path is used.

This uses the delegated path, so it also confirms `teams` MCP is signed in.

## Reading the output

One GO/NO-GO line at the end.

| Result | Meaning | Next |
|---|---|---|
| **GO** | Licence provisioned and ≥1 environment | Confirm membership on the delegated path, then build |
| **NO-GO: licence** | The owner's licence lacks a provisioned Power Automate plan | Brent. `docs/BRENT-TEAMS-ADMIN.md` item 2. Meanwhile use the delegated post fallback. |
| **NO-GO: az not signed in** | The user has not run `az login` | The **user** runs it. Not the agent. This is the current state. |
| **NO-GO: environment** | No Power Platform environment on the tenant | Tenant-level. Escalate. |

Exit code is 0 for GO and 1 for NO-GO, so the script can gate another script.

Check 3 (membership) reports rather than tests — app-only cannot see what the *flow owner* can
see, and the script cannot reach the delegated MCP server. It tells you to run
`mcp__teams__list_teams` and what to expect.

## What a NO-GO does not block

Plenty. Do not let the gate stall the rest of the work:

- The whole app-only pipeline — transcripts, extraction, minutes, filing, drafts
- Porting `run-meeting-once.js` into `MEETING_CODE`
- The n8n inbound webhook and its credential
- The Excel actions register, transcript dedup, the dashboard view
- **Channel announcements**, via `mcp__teams__send_channel_message` on the delegated path

That last one matters: the pipeline never has to block on Power Automate. Step 9 of the client's
process is a human review anyway, so an interim delegated post is a legitimate stopgap, not a
compromise.

## Premium is not the issue

The flow uses only the **standard Microsoft Teams connector**, which the seeded Microsoft 365
plan covers. No premium Power Automate seat is required. If a licence conversation starts, keep it
on renewing the lapsed base licence — a premium seat would be spending money on the wrong problem.
