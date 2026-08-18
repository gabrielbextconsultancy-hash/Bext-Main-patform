# Teams admin — verified state and what is actually needed

**Verified live against the tenant on 18 August 2026** using `az` signed in as
`Admin.bext-automation@bextconsultancy.com.au`, plus `node graph/discover-power-platform.js`.

Short version: **the Teams announcement needs nothing from Brent.** Four things this document
previously asked for turned out to be already done. One new item did appear, and it is the one that
decides whether anyone actually sees the announcements.

---

## Already satisfied — do not re-request

| # | Item | Verified state |
|---|---|---|
| 1 | Power Automate licence on the flow owner | **Pass.** `FLOW_O365_P1` and `DYN365_CDS_O365_P3` (Business Premium + Copilot) plus `FLOW_P2_VIRAL`, all `Success` |
| 2 | Power Platform environment | **Pass.** `Brent Craig (default)` |
| 3 | Team membership | **Pass.** `Admin.bext-automation@` is **owner and member** of `bext_transcripts records` |
| 4 | Teams Administrator role | **Pass — already assigned.** `docs/HANDOFF.md` still says the account holds no directory roles; that is stale |
| 5 | Teams connector working | **Pass.** A live flow, *"When Documents files are created send a message in Bext Transcripts"*, already posts to the channel through connection `shared-teams-1381069787…` |

Because connection `shared_teams` already exists, creating the announcement flow triggers **no consent
prompt and grants no new permission**. It reuses what is there.

### The licence confusion, settled

`docs/HANDOFF.md` records `O365 Business Premium` at **0 purchased / 1 assigned**. That is real, but it
is attached to the **report-sender mailbox** — a different account. It threatens the 05:00 daily report.
It does **not** affect Power Automate, and the flow owner is properly licensed.

Premium Power Automate is also not required: the flow uses only the **standard** Teams connector.

---

## 1. The one thing that actually needs doing — 2 minutes · blocks anyone seeing the announcements

**`Admin.bext-automation@bextconsultancy.com.au` is currently the only member of the team
`bext_transcripts records`.**

The flow will post correctly, and nobody will read it. The card, the minutes, the transcript and the
summary all land in a team with an audience of one service account.

Add the real people — Brent, and whoever reviews minutes at steps 9–10:

- Teams client → team **bext_transcripts records** → **⋯ → Manage team → Members → Add member**
- or Teams admin centre → **Teams → Manage teams** → `bext_transcripts records` → **Members → Add**
  · <https://admin.teams.microsoft.com/teams/manage>

Only one channel exists in that team — **Bext Transcripts** — and that is where the card posts.

## 2. The "lapsed licence" — nothing to buy. Verified 18 Aug 2026

Earlier notes, including `docs/HANDOFF.md`, said `O365 Business Premium` was lapsed on the mailbox
that sends the 05:00 report, and treated it as a blocker. Reading `subscribedSkus` directly shows
otherwise.

| SKU | Prepaid | Consumed | Held by |
|---|---|---|---|
| `BUSINESS_PREMIUM_AND_MICROSOFT_365_COPILOT_FOR_BUSINESS` | 2 | 2 | `Admin.bext-automation@`, `Brent@` |
| `O365_BUSINESS_PREMIUM` | **0** (1 in grace) | 1 | `Brent@` only |
| `FLOW_FREE` | 10000 | 2 | both |

Two corrections fall out of that:

- The expired SKU is on **Brent's own account**, not on a report-sender mailbox. `MS_SENDER_UPN` is
  `Admin.bext-automation@`, which holds the healthy Business Premium + Copilot licence.
- Brent **also** holds that healthy licence. The expired one is a redundant duplicate, so nothing is
  actually unlicensed and the 05:00 report is not at risk.

**Do not buy anything.** Optionally clear the warning banner by removing the dead assignment:
<https://admin.microsoft.com/#/users> → **Brent Craig** → **Licenses and apps** → untick
**Office 365 Business Premium** → **Save**.

> ⚠️ Untick only the expired `Office 365 Business Premium`. Leave **Microsoft 365 Business Premium
> with Copilot** ticked — that is the licence carrying the mailbox. Removing a user's only licence
> starts the clock on mailbox deletion.

Equally fine to leave both alone and let the dead SKU fall off by itself.

## 3. App consent rights, so MCP and future integrations stop needing Brent — 2 minutes

This is the same shape of ask as the Teams Administrator role, and the same payoff.

**Verified 18 Aug 2026:** the tenant *does* allow ordinary users to consent to apps
(`ManagePermissionGrantsForSelf.microsoft-user-default-recommended` and
`…-allow-consent-apps` are assigned). So a third-party app asking only for **low-risk** delegated
permissions self-consents with no admin involvement.

The catch: the delegated scopes Teams automation actually needs — `ChannelMessage.Send`,
`Chat.ReadWrite`, `Team.ReadBasic.All` — are **not** classified low risk. They surface the
*"Need admin approval"* wall. And **Teams Administrator does not grant app-consent rights** — that
needs Global Administrator, Privileged Role Administrator, **Cloud Application Administrator** or
Application Administrator.

Two ways to clear it. The second is better.

**Either** — Brent grants admin consent per app, each time one is added:
<https://entra.microsoft.com> → **Enterprise applications** → the app → **Permissions** →
**Grant admin consent**.

**Or** — assign **Cloud Application Administrator** to
`Admin.bext-automation@bextconsultancy.com.au`, once:
<https://entra.microsoft.com> → **Roles and administrators** → **Cloud Application Administrator** →
**Add assignments**.

That role consents applications and nothing else — it cannot read mail, files, or the directory, and
cannot assign other roles. It removes an escalation from every future integration rather than one.

### What this unblocks, and what it does not

| Capability | Path | Needs consent? |
|---|---|---|
| Post the meeting card to the channel | Power Automate flow | **No** — already working |
| Read/search Teams messages, ad-hoc posting from the agent | `teams` MCP (delegated) | Yes |
| Everything app-only: transcripts, SharePoint, mail, calendar | Graph app-only | No — consented |

**The announcement does not depend on this.** Posting cards runs through Power Automate, unattended.
The `teams` MCP server is delegated — tied to a live sign-in — so it could never have driven the
pipeline anyway. It is a convenience for interactive work, not a blocker.

Worth recording, because it explains why the flow exists: the Azure CLI session carries **12
delegated scopes**, and the only Teams-relevant one is `Group.ReadWrite.All`. It can read teams and
channels. It **cannot** post a channel message. There is no route to an unattended channel post that
does not go through Power Automate.

### The Agent Tools registry is a different thing

<https://admin.microsoft.com> → **Agents → Tools → Registry** governs which MCP servers *Copilot
agents inside Microsoft 365* may use, with Block/Unblock and BYO registration. It has no bearing on
MCP servers running locally in Claude Code. Relevant only if the client later wants central
governance of them.

---

## 4. Leave the four Teams gates alone — nothing to do unless something regresses

Transcripts only reach the pipeline when all four hold. Each is independent and each was found the hard
way, so one flipping back silently stops the engagement.

| # | Gate | Where |
|---|---|---|
| 1 | Admin consent on **BEXT Automation (Dev)** | <https://entra.microsoft.com> → App registrations → API permissions |
| 2 | Application access policy granted **`-Global`** | PowerShell — `graph/teams-access-policy.ps1` |
| 3 | Tenant **Transcript API access → Microsoft Graph access** | <https://admin.teams.microsoft.com> |
| 4 | **Transcription** on the meeting policy | <https://admin.teams.microsoft.com/policies/meeting> |

Gate 4 has regressed once already — it produced output on only two of five attempts before settling.
A note if any of these changes would save a day of diagnosis.

---

## Not possible, so please do not go looking for it

**No Microsoft Graph application permission can post a channel message.** Only `Channel.Create`,
`ChannelMessage.Read.All` and `Teamwork.Migrate.All` (import-only) exist. `ChannelMessage.Send` is
delegated-only and needs a signed-in human, which a 15-minute unattended schedule does not have.

That is why the announcement goes through a Power Automate flow. It is a design constraint, not a
missing tick box, and asking for a permission that does not exist wastes an escalation.

---

## Optional — who the post appears to come from

Cards arrive as **Flow bot**, not "BEXT Automation". Changing that needs an Azure Bot registration, a
Teams app package, and **custom apps allowed** org-wide
(<https://admin.teams.microsoft.com/policies/manage-apps>). Materially more work than the flow, and only
worth it if the client objects to the branding.

---

## Status

| # | Item | Status |
|---|---|---|
| 1 | Real people added to `bext_transcripts records` | **waiting on Brent** — nobody sees the card until this is done |
| 2 | Lapsed `O365 Business Premium` | **not a blocker** — verified 18 Aug. Redundant duplicate on Brent's account; nothing to buy |
| 3 | Cloud Application Administrator on `Admin.bext-automation@` | **waiting on Brent** — optional; unblocks MCP and future app consent |
| 4 | Four Teams gates | all on, verified 17 Aug |
| — | Power Automate licence, environment, membership, Teams Admin role | verified 18 Aug — nothing needed |
| — | Custom Teams app for branding | not requested |
