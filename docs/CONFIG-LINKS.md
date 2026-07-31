# Configuration links

Every URL you need, in the order to work through them. Each row says exactly what to
bring back so it can be wired in.

Paste values into the root `.env` (already gitignored) or send them over and they go in.

---

## Already running — nothing to configure

| Service | URL | Login |
|---|---|---|
| BEXT n8n | https://bext-n8n.srv1866850.hstgr.cloud | you create it — step 1 below |
| BEXT n8n MCP endpoint | https://bext-n8n.srv1866850.hstgr.cloud/mcp-server/http | Bearer token = n8n API key |
| Dashboard (local) | http://localhost:3000 | none |
| Hostinger VPS panel | https://hpanel.hostinger.com/vps/1866850 | your Hostinger account |
| Premier Fitness n8n | https://n8n.srv1866850.hstgr.cloud | **different client — leave alone** |

PostgreSQL and Qdrant are already running on the VPS behind loopback. Nothing to sign
up for, no account, no cost. They are reached through an SSH tunnel or from inside the
Docker network.

---

## 1. n8n owner account — blocks everything

| Step | Link |
|---|---|
| Create owner account | https://bext-n8n.srv1866850.hstgr.cloud/setup |
| Then: create API key | https://bext-n8n.srv1866850.hstgr.cloud/settings/api |

**Bring back:** the API key (starts `n8n_api_...`).

---

## 2. Microsoft 365 Developer Sandbox — confirm what you have

| What | Link |
|---|---|
| Developer program dashboard | https://developer.microsoft.com/microsoft-365/profile |
| Admin centre (users, mailboxes) | https://admin.microsoft.com |
| Outlook web (test the mailbox) | https://outlook.office.com/mail/ |
| SharePoint admin | https://admin.microsoft.com/sharepoint |

**Bring back:** the tenant's primary domain (`something.onmicrosoft.com`) and the mailbox
the 05:00 report should send **from**.

---

## 3. Azure App Registration — blocks all Microsoft work

Full click-path: **[graph/app-registration.md](../graph/app-registration.md)**

| Step | Link |
|---|---|
| Entra admin centre | https://entra.microsoft.com |
| App registrations — go straight here | https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade |
| New registration | https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade |
| Graph permissions reference | https://learn.microsoft.com/graph/permissions-reference |

Nine **Application** permissions (not Delegated):

```
Mail.Read  Mail.Send  Mail.ReadWrite  Calendars.ReadWrite
Files.ReadWrite.All  Sites.ReadWrite.All
OnlineMeetings.Read.All  OnlineMeetings.ReadWrite.All  User.Read.All
```

Then **Grant admin consent** — green tick on every row, or every call returns 403.

**Bring back:** `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (the *Value* column,
shown once), `MS_SENDER_UPN`.

Verify with `node graph/verify.js`.

---

## 4. Gemini API key — blocks article summarisation

| Route | Link |
|---|---|
| Fast — AI Studio | https://aistudio.google.com/apikey |
| Billed — Google Cloud console | https://console.cloud.google.com/apis/credentials |
| Enable the API on a billed project | https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com |

The free tier rate-limits hard once all 67 active sources are ingesting hourly. Say the
word and the `bg-gcloud` skill provisions a properly billed key instead.

**Bring back:** `GEMINI_API_KEY`.

---

## 5. Supabase — optional, and probably not needed

You mentioned setting up a Supabase account separately. Worth being straight about where
it fits: **the application database already exists** — PostgreSQL 16 on the VPS, schema
applied, 68 sources and 34 deliverables seeded. `PLAN 1 First task.pdf` specifies
self-hosted PostgreSQL and Qdrant, and Brief B explicitly asks to avoid third-party
platforms. Adding Supabase would mean two databases and a harder client handover.

If you want it anyway — for a hosted dashboard, auth, or storage:

| What | Link |
|---|---|
| Dashboard | https://supabase.com/dashboard |
| New project | https://supabase.com/dashboard/new |
| API keys — Settings → API | https://supabase.com/dashboard/project/_/settings/api |
| Connection string — Settings → Database | https://supabase.com/dashboard/project/_/settings/database |

**Bring back if you go ahead:** `SUPABASE_URL`, `SUPABASE_PROJECT_REF`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — and say what you want it to hold, so
the same data does not end up in two places.

---

## 6. Power BI — Brief B only, not urgent

| What | Link |
|---|---|
| Power BI Desktop (free download) | https://powerbi.microsoft.com/desktop/ |
| Power BI service | https://app.powerbi.com |

Desktop is enough for development. **Pro** is only needed if the client wants dashboards
shared through the cloud — the brief flags that as optional.

---

## 7. Client business platforms — Brief B, production phase

Not needed yet. Listed so the client knows what to prepare when Brief B moves from design
to build.

| Platform | Where the credential comes from |
|---|---|
| HubSpot | https://app.hubspot.com — Settings → Integrations → Private Apps |
| Xero | https://developer.xero.com/app/manage — OAuth 2.0 app |
| ProjectManager | https://app.projectmanager.com — Account → API |
| WordPress | the site's own admin → Users → Application Passwords |
| LinkedIn | https://www.linkedin.com/developers/apps |

---

## Priority

| Order | Item | Blocks |
|---|---|---|
| 1 | n8n API key | every workflow |
| 2 | Azure app registration | all Microsoft work, report delivery |
| 3 | Gemini key | summarisation and ranking |
| 4 | SharePoint test site | Brief B only |
| 5 | Power BI Desktop | Brief B only |
| — | Supabase | nothing — optional |
