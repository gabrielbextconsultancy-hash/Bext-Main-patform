# What the automation still needs from Brent

Checked against the live systems on 11 August 2026. Ordered by what blocks the most work,
not by effort. Items marked **verified** were tested against the actual API, not assumed.

---

## 1. Blocking now — the meeting workflow cannot run

**Teams application access policy.** Verified: transcript reads return
`403 — No application access policy found for this app`. Everything else in the meeting
pipeline is built and tested. Instructions in `docs/brent-actions.md`.

Two ways to clear it, either is fine:
- Brent runs two PowerShell commands once, or
- Brent assigns the **Teams Administrator** role to `Admin.bext-automation@`, after which
  Gabriel can do this and every future Teams task without involving him.

The second is worth doing regardless — see section 5.

---

## 2. Blocking the next workflows

### HubSpot scopes are incomplete — **verified**

The stored token reads contacts and deals but is refused on companies:

> `403 — This app hasn't been granted all required scopes to make this call.`

Any client-facing automation needs companies: filing a document under the right client,
matching a meeting to an engagement, drafting a client update. Brent (or whoever owns the
HubSpot private app) needs to add the CRM object scopes — at minimum
`crm.objects.companies.read`, and `crm.objects.companies.write` if the automation is to
create records. HubSpot → Settings → Integrations → Private Apps → the app → Scopes.

### Xero is not connected at all — **verified**

No Xero credential exists. Xero is one of the eleven platforms in the brief and the owner of
invoices and expenses in the architecture. It needs an app created at
https://developer.xero.com and connected to the BEXT organisation. Brent has to authorise
this — it is financial data and the connection is made by an organisation administrator.

### The company minutes template

Still outstanding. A generic stand-in is in place so the pipeline could be tested, but the
brief asks for minutes in the company template. Any Word document with the placeholder names
listed in `docs/sharepoint-ia.md` will drop straight in.

---

## 3. Blocking the 25 August architecture deliverables

These are decisions, not access. They cannot be answered from the systems.

- **Project hourly rates.** Verified: all 13 ProjectManager projects have `hourlyRate = 0`.
  Profitability cannot be computed, which is the main thing the Xero–ProjectManager
  integration would be for. Either the rates go in, or that integration is descoped and the
  final report should say so.
- **Real client and project names.** SharePoint still carries `Client 002 - XXX` and
  `Project XXX`. Automated filing has to resolve a destination folder; it cannot do that
  against a placeholder.
- **Where client minutes are finally filed** — centrally, or into the matching client gate
  folder under ProgramManagement. See `docs/sharepoint-ia.md` §Open decisions.
- **Naming convention** for generated documents. Proposed:
  `YYYY-MM-DD Client — Subject — Minutes v1.docx`.
- **Transcript retention** — kept indefinitely, or purged once minutes are approved.
- **LinkedIn.** The brief asks for content drafting and industry monitoring. LinkedIn's API
  is restricted and does not permit general feed scraping; this needs a decision on what is
  actually in scope before 25 August, because the honest answer may be "assisted drafting
  only, posting stays manual".

---

## 4. Governance — needed before anything sends

The brief is explicit that Brent reviews before issue, and the build follows that: follow-up
emails are created as **drafts**, never sent. Worth confirming that is the intended standing
rule, and deciding:

- Which mailbox client-facing drafts should appear in.
- Whether any category of email may ever send without review (recommendation: none, at least
  initially).
- Who receives failure alerts. Currently they go to `Admin.bext-automation@`, which nobody
  reads day to day.

---

## 5. Standing access — so this list stops growing

Every item above needed a separate approach to Brent. Two changes would remove most future
interruptions:

1. **Teams Administrator** on `Admin.bext-automation@` — covers meeting policies, application
   access policies, and the Teams side of anything later.
2. Agreement on who owns third-party credentials (HubSpot, Xero, WordPress, LinkedIn) and
   where they are stored. They currently arrive one at a time, which is why HubSpot's missing
   scope was only found when a call failed.

---

## 6. Not access, but Brent should see it

**A licence is assigned from a subscription with nothing purchased.** Verified:

| Subscription | Purchased | Assigned |
|---|---|---|
| Business Premium + Copilot | 2 | 2 |
| **O365 Business Premium** | **0** | **1** |

That assignment sits on `Admin.bext-automation@` — the mailbox that sends the 05:00 daily
report. A lapsed licence degrades mail and Teams access quietly rather than all at once.
Worth checking at https://admin.microsoft.com → Billing → Your products.

There are also **no spare licences**. If another licensed account is ever needed, one has to
be bought.
