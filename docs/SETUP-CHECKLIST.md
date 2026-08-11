# Setup checklist — what you do manually

Everything else is automated. These are the items that need a human in a browser: account
creation, credential issuance, and consent. Work top to bottom; each one unblocks the next.

Paste values back as you get them and they go straight into `.env` and the n8n credential store.

---

## 1. n8n owner account — 2 minutes · **blocks everything**

The BEXT n8n instance is deployed and waiting on its setup screen.

1. Open **https://bext-n8n.srv1866850.hstgr.cloud**
2. Create the owner account (email + password).
3. **Settings → n8n API → Create an API key**. Label it `claude-code`, no expiry.

**Send me:** the API key.

Then, in the workflow list sidebar, create a folder named exactly **`BEXT Consultancy`**.
Every workflow lives in it. (I can do this once I have the API key — your call.)

---

## 2. Microsoft 365 Developer Sandbox — check what you already have

You said the sandbox exists. Confirm these, because the workflows depend on them:

| Item | How to check | Needed for |
|---|---|---|
| Tenant domain | `https://entra.microsoft.com` → Overview → *Primary domain*, ends `.onmicrosoft.com` | Everything |
| Global Admin rights on your account | You can see **App registrations** and the **Grant admin consent** button is not greyed out | Step 3 |
| A working mailbox | Send yourself a mail from Outlook Web in the tenant | Daily report delivery |
| Sample data package | Sandbox setup offers "Instant sandbox" with sample users and content — confirm you took it | Brief B testing |

**Send me:** the tenant's primary domain and the mailbox address the 05:00 report should send **from**.

---

## 3. Azure App Registration — ✅ DONE (verified 11 Aug 2026)

App **BEXT Automation (Dev)** exists on the `bextconsultancy.com.au` tenant, secret current,
admin consent granted, all `graph/verify.js` checks pass. Steps below kept for secret rotation.

Full click-path with screenshots-worth of detail: **[graph/app-registration.md](../graph/app-registration.md)**

Short version — at `https://entra.microsoft.com`:

1. **App registrations → New registration** → name `BEXT Automation (Dev)`, *Single tenant*,
   no redirect URI.
2. **Certificates & secrets → New client secret** → 24 months → copy the **Value** column
   immediately (it is shown once).
3. **API permissions → Add → Microsoft Graph → Application permissions** → add all nine:

   ```
   Mail.Read   Mail.Send   Mail.ReadWrite   Calendars.ReadWrite
   Files.ReadWrite.All   Sites.ReadWrite.All
   OnlineMeetings.Read.All   OnlineMeetings.ReadWrite.All   User.Read.All
   ```

4. **Grant admin consent** — every row must show a green tick. Skipping this makes every call
   return 403 with an unhelpful message.

**Send me:**

```
MS_TENANT_ID=        # Overview → Directory (tenant) ID
MS_CLIENT_ID=        # Overview → Application (client) ID
MS_CLIENT_SECRET=    # the secret's Value column, not the Secret ID
MS_SENDER_UPN=       # mailbox the report sends from
```

I verify all four with `node graph/verify.js` — token, user lookup, test send, SharePoint
access — and write the result to `integration_health`.

---

## 4. Gemini API key — 3 minutes · blocks article summarisation

Article summarising and ranking. Two routes:

- **Fast**: `https://aistudio.google.com/apikey` → Create API key. Free tier is enough for
  development.
- **Better**: say the word and I provision a properly billed key through the `bg-gcloud` skill.
  The free tier rate-limits hard once 68 sources are all ingesting, which will bite around
  the 18 Aug deadline.

**Send me:** `GEMINI_API_KEY`.

---

## 5. SharePoint test structure — 15 minutes · blocks Brief B, not Brief A

Only needed for the Business Structure engagement (25 Aug / 8 Sep milestones), so this can wait.

In the sandbox tenant create a site named `BEXT` with document libraries mirroring how the
business actually files work — proposals, reports, client deliverables, templates,
capability statements, meeting notes. Rough is fine; it is test scaffolding for the document
management and knowledge base design.

**Send me:** the site URL.

---

## 6. Power BI Desktop — 10 minutes · blocks Brief B dashboards only

Free download: `https://powerbi.microsoft.com/desktop/`. Local install, no service wiring,
no license needed for development. Power BI **Pro** is only required if the client later wants
dashboards shared through the cloud — flagged in the brief as optional.

---

## 7. Two things to confirm from the brief

Both are ambiguities in the source document, not blockers — I have made a call on each and
will proceed unless you say otherwise:

1. **Renewables Now** — the brief's hyperlink points at the *Latin America* region page
   (`renewablesnow.com/regions/latin-america/`). That looks unintended for an Australian
   energy brief. Assuming it should be the global or Australia feed.
2. **Australian Hydrogen Council** — the brief names it but supplies no link, and
   `h2council.com.au` redirects to `aidc.org.au`, which is already covered by the Australian
   Alliance for Energy Productivity entry. Assuming AHC content now flows through AIDC.

---

## Status

| # | Item | Status |
|---|---|---|
| 1 | n8n owner account + API key | **waiting on you** |
| 2 | M365 sandbox details | **waiting on you** |
| 3 | Azure App Registration | done — verified 11 Aug |
| 4 | Gemini API key | **waiting on you** |
| 5 | SharePoint test structure | later — Brief B |
| 6 | Power BI Desktop | later — Brief B |
| — | VPS, n8n, Postgres, Qdrant, TLS | done |
| — | Database schema + plan seeded | done |
| — | Source registry, 68 sources | done |
