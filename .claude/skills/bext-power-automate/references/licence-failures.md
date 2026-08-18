# How licence and environment problems present

None of these produce an error that names the real cause. That is why the gate exists.

## The Workflows menu is missing

**Looks like:** the ⋯ menu on a Teams channel has no **Workflows** entry. Not an error — an
absence.

**Is:** the Workflows app is blocked in the Teams admin centre.

**Fix:** Brent, `docs/BRENT-TEAMS-ADMIN.md` item 1 — Teams apps → Manage apps → `Workflows` must
read **Allowed**, and the permission policy assigned to the flow creator must allow Microsoft apps.

Microsoft has also moved this entry point more than once. Before concluding it is blocked, try the
app rail: ⋯ → Workflows → + New flow → See more templates.

## A flow silently stops running

**Looks like:** the flow exists, is enabled, and simply produces nothing. No failed runs, because
no runs.

**Is:** the owning account's licence lapsed. A flow owned by an unlicensed account stops without
warning.

**Fix:** renew the base licence.

**Not the current state.** `Admin.bext-automation@` is licensed — `FLOW_O365_P1` on Business
Premium + Copilot, provisioned. The lapsed `O365 Business Premium` recorded in `docs/HANDOFF.md`
(0 purchased / 1 assigned) belongs to the **report sender mailbox**, and it threatens the 05:00
daily report, not the flow. Keep the two separate.

**Detect early:** the gate's licence check names the account it examined. Do not wait for a client
to notice the announcements stopped.

## `az` reports "not signed in" after a successful login

**Looks like:** an authentication failure.

**Is:** almost always the missing flag. FlowAgent maps the CLI's `No subscription found` to "not
signed in", and this tenant has no Azure subscription.

**Fix:**

```bash
az login --tenant 9eb458d1-317d-4aae-a9a3-bb68e430d701 --allow-no-subscriptions
```

## Empty environment list

**Looks like:** every flow tool returns nothing, with no error.

**Is:** the tenant has no Power Platform environment, or the signed-in account cannot see one.

**Fix:** tenant-level, and a client escalation. Nothing in the repo can work around it.

## The card posts but renders as raw JSON, or as nothing

**Looks like:** a payload bug in `n8n/lib/meeting-card.js`.

**Is:** the wrong template. *"Post a **message** to a channel when a webhook request is received"*
takes plain text; it will not render an Adaptive Card.

**Fix:** recreate with *"Post to a channel when a webhook request is received"*. Note that this
produces a new trigger URL — update `.env` and the VPS.

## The card posts but pieces are missing

**Looks like:** truncation.

**Is:** the 26 KB build ceiling doing its job. The builder sheds detail — decisions first, then
action rows — to stay under the ~28 KB Teams limit, because a card that fails to post says nothing
at all.

**Fix:** usually none needed. If the summary is being clipped hard, the extraction is producing
too much prose, and the prompt is the place to fix it.

## Posts appear from the wrong person

**Looks like:** a display bug.

**Is:** the flow was created under a personal sign-in. The creating account owns it permanently
and every post carries their name.

**Fix:** recreate as `Admin.bext-automation@`. New flow, new trigger URL, redistribute it. Check
`az account show` before creating anything to avoid this.

## Everything is blocked — what still moves

A NO-GO does not stop the engagement. Channel announcements can go through
`mcp__teams__send_channel_message` on the delegated path in the meantime, and step 9 of the
client's process is a human review anyway.

The remaining genuine client dependencies for the 25 August architecture deliverable are the
Workflows app being allowed, team membership for the flow owner, and — separately from Power
Automate — the lapsed licence on the report sender mailbox.
