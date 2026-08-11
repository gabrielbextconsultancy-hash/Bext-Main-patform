# Azure App Registration — BEXT Automation (Dev)

This is the credential that lets n8n act against Microsoft 365: Outlook mail, Teams
meetings, SharePoint and OneDrive files.

**You have to do this part in the browser.** It involves creating a credential and granting
tenant-wide consent — neither of which should be automated. It takes about ten minutes.

---

## 0. You need a directory first — verified blocker

Checked in the portal on 31 July 2026. Signing in to `entra.microsoft.com` with the
**personal** account `gabriel.bextconsultancy@gmail.com` reaches App registrations, but
**New registration is refused**:

> "The ability to create applications outside of a directory has been deprecated. You may
> get a new directory by joining the M365 Developer Program or signing up for Azure."

A personal Microsoft account has no Entra directory, and app registrations can no longer
exist outside one. The portal reports tenant `f8cdef31-a31e-4b4a-93e4-5f571e91255a`, which
is the placeholder shown for personal-account context — not a real directory.

| Route | Verdict |
|---|---|
| **M365 Developer Program** | Refused — requires a Visual Studio Professional or Enterprise *annual* subscription (~US$1,199/yr) |
| **Azure free signup** — https://azure.microsoft.com/free | **The viable path.** Free account that creates a real Entra directory. A card is required for identity verification; nothing is charged without an explicit upgrade |

Once a directory exists, everything below works, and the app registration and Graph API are
free permanently. Paid M365 licences remain a **separate, later** step — they buy the data
behind Graph (mailbox, SharePoint, Teams), not access to the API.

**Update 11 Aug 2026 — DONE and verified.** The registration exists on the
`bextconsultancy.com.au` tenant (`9eb458d1-317d-4aae-a9a3-bb68e430d701`), created 7 Aug via
the work account **`Admin.bext-automation@bextconsultancy.com.au`**: app **BEXT Automation
(Dev)**, client ID `b72d1df4-06ec-4390-937a-1293f34d31be`, secret current. `.env` holds all
four `MS_*` values. `node graph/verify.js` run 11 Aug — all 4 checks pass (token, User.Read.All,
Mail.Send, Sites.ReadWrite.All → 8 sites). Admin consent is in place. The Azure-free-signup
route above is obsolete. Steps below are kept for secret rotation only.

---

## 1. Register the application

1. Sign in to **https://entra.microsoft.com** with an account that has a real Entra
   directory — see step 0.
2. **Applications → App registrations → New registration**.
3. Fill in:
   - **Name**: `BEXT Automation (Dev)`
   - **Supported account types**: *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI**: leave blank — this app authenticates as itself, not as a signed-in user,
     so there is nothing to redirect back to.
4. **Register**.
5. From the **Overview** blade, copy these two now:

   | Field | Goes to |
   |---|---|
   | **Directory (tenant) ID** | `MS_TENANT_ID` |
   | **Application (client) ID** | `MS_CLIENT_ID` |

## 2. Create a client secret

1. **Certificates & secrets → Client secrets → New client secret**.
2. Description `n8n`, expiry **24 months**.
3. **Copy the `Value` column immediately.** It is shown once and never again — the `Secret ID`
   column is not the secret. If you miss it, delete the secret and make a new one.

   | Field | Goes to |
   |---|---|
   | **Value** | `MS_CLIENT_SECRET` |

4. Note the expiry date. Put a reminder in the calendar for a month before it — an expired
   secret silently stops the 05:00 report.

## 3. Add Graph permissions

**API permissions → Add a permission → Microsoft Graph → Application permissions.**

Application permissions, not Delegated: the workflows run overnight with no one signed in.

| Permission | Why it is needed |
|---|---|
| `Mail.Read` | Read mailbox content for the email automation review (Brief B.4) |
| `Mail.Send` | Send the 05:00 daily report (Brief A) and draft follow-ups |
| `Mail.ReadWrite` | Create drafts for review before sending, and file commercial email |
| `Calendars.ReadWrite` | Meeting preparation and follow-up scheduling (Brief B.3) |
| `Files.ReadWrite.All` | OneDrive filing and document automation (Brief B.5) |
| `Sites.ReadWrite.All` | SharePoint document libraries and folder structure (Brief B.5) |
| `OnlineMeetings.Read.All` | Discover Teams meetings for the meeting workflow (Brief B.3) |
| `OnlineMeetings.ReadWrite.All` | Meeting records and transcript access (Brief B.3) |
| `User.Read.All` | Resolve mailbox owners and attendees |

Add them all, then **Grant admin consent for \<your tenant\>** and confirm every row shows
a green *Granted* tick. Without this step every Graph call returns `403 Forbidden`, and the
error message does not say why.

> `Mail.Send` as an application permission lets the app send as **any** mailbox in the tenant.
> That is fine in a throwaway developer sandbox. When this moves to the client's production
> tenant, scope it down with an **application access policy** so it can only send as the one
> mailbox it needs. Noted in `docs/05-runbook.md` for handover.

## 4. Hand the values over

Paste the three values back and they go into `.env` (gitignored) and an n8n credential:

```
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_SENDER_UPN=      # the sandbox mailbox the report sends FROM, e.g. admin@yourtenant.onmicrosoft.com
```

## 5. Verification

Once the values are in, verification runs automatically:

1. Token request against `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
   with scope `https://graph.microsoft.com/.default` — proves the secret works.
2. `GET /users/{MS_SENDER_UPN}` — proves `User.Read.All` consent landed.
3. `POST /users/{MS_SENDER_UPN}/sendMail` — a test message to yourself, proving the daily
   report can actually be delivered.
4. `GET /sites?search=` — proves SharePoint access for Brief B.

Each result is written to `integration_health` so the dashboard shows Graph as up.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `AADSTS7000215: Invalid client secret` | The Secret ID was copied instead of the Value, or the secret expired |
| `403 Forbidden` on every call | Admin consent was never granted — step 3 |
| `ErrorAccessDenied` on sendMail only | The mailbox in `MS_SENDER_UPN` does not exist in the tenant |
| `401 Unauthorized` on the token request | Wrong tenant ID, or the app was registered in a different directory |
