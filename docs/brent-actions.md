# Action required — Microsoft 365 administrator

**For:** Brent Craig (`Brent@bextconsultancy.com.au`)
**Why:** the automated meeting-minutes workflow is built and tested, but cannot read Teams
transcripts until a Teams administrator authorises it. This is a one-time setup.
**Time:** about five minutes.

Everything else is done: the app registration exists, all ten Microsoft Graph permissions are
consented, the SharePoint folders are created, and the document generation is working. Reading
the calendar already succeeds. Only the transcript step is refused, with this exact error:

> `403 — No application access policy found for this app b72d1df4-06ec-4390-937a-1293f34d31be on the user`

Microsoft requires a second, separate authorisation for meeting transcripts. Consent alone is
deliberately not enough: a tenant-wide permission would otherwise let an application read every
meeting in the organisation, so Microsoft requires an administrator to name which users an
application may read. That is the step below.

---

## Option 1 — do it once yourself (recommended)

Nothing about any account changes. You run two commands, the workflow works from then on.

**1.** Open **PowerShell 7** on your PC. (Press Start, type `PowerShell 7`. If it is not
installed: https://aka.ms/powershell-release)

**2.** Install the Teams module — first time only, takes a minute or two:

```powershell
Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
```

**3.** Sign in. A browser window opens — sign in as **`Brent@bextconsultancy.com.au`**:

```powershell
Connect-MicrosoftTeams -AccountId Brent@bextconsultancy.com.au
```

**4.** Confirm you have admin rights before continuing. This should print the organisation
name, not an error:

```powershell
Get-CsTenant | Select-Object DisplayName
```

**5.** Create the policy:

```powershell
New-CsApplicationAccessPolicy -Identity BEXT-Automation-Policy -AppIds "b72d1df4-06ec-4390-937a-1293f34d31be" -Description "BEXT Automation transcript access"
```

**6.** Grant it to the automation account:

```powershell
Grant-CsApplicationAccessPolicy -PolicyName BEXT-Automation-Policy -Identity Admin.bext-automation@bextconsultancy.com.au
```

That is all. Allow up to 30 minutes to take effect, then tell Gabriel — the result is verified
from this end, so nothing further is needed from you.

**If step 4 returns "Access Denied":** the browser signed you in as a different account. Run
`Disconnect-MicrosoftTeams`, then repeat step 3 using
`Connect-MicrosoftTeams -UseDeviceAuthentication` — that prints a code to enter in a browser of
your choosing, so you control which account is used.

---

## Update, 12 August — two further steps

The policy above worked: meeting lookup now succeeds where it returned 403 before. Two things
surfaced behind it.

### A. Grant the policy tenant-wide

Meetings organised by anyone other than the automation account still fail with
`3003: User does not have access to lookup meeting`. The policy authorises the application only
against the users it is granted to, and in practice you organise the meetings. In the same
PowerShell window:

```powershell
Grant-CsApplicationAccessPolicy -PolicyName BEXT-Automation-Policy -Global
```

Returns silently on success. This replaces the per-user grant — do not run both.

### B. Turn on Transcript API access (tenant setting)

Microsoft added a tenant-wide control in late July 2026, enforced from 31 July, **off by
default**. It is independent of everything above: consent, the access policy and the
transcription toggle can all be correct and transcripts still return
`403 — Graph API access to transcripts is disabled for this tenant`.

1. https://admin.teams.microsoft.com/meetings/settings
2. **Meetings → Meeting settings → Transcript API access → Microsoft Graph access: On**
3. **Configure** beside it → **Include speaker attribution: On**

Step 3 matters: without speaker attribution the transcript has no names, so the minutes cannot
attribute decisions or assign action items to anyone.

Both take 30–60 minutes to propagate, occasionally longer. Refresh the page afterwards and
confirm the setting held — it can appear saved without sticking.

---

## Option 2 — delegate it, so this does not come back to you

Assign the **Teams Administrator** role to the automation account. Gabriel can then complete
this and any similar Teams task without involving you.

1. Open https://entra.microsoft.com and sign in as `Brent@bextconsultancy.com.au`
2. **Users** → search for and open **`Admin.bext-automation@bextconsultancy.com.au`**
3. **Assigned roles** → **Add assignments**
4. Select **Teams Administrator** → **Add**

Teams Administrator rather than Global Administrator on purpose: it is sufficient for meeting
and application policies, and does not give a service account control of the whole tenant.
Takes a few minutes to apply.

Either option resolves it. Option 1 is faster; option 2 avoids the next interruption.

---

## Separate issue — worth a look when convenient

Not related to the above, and not urgent, but it surfaced while checking the tenant:

| Subscription | Purchased | Assigned |
|---|---|---|
| Business Premium + Copilot | 2 | 2 |
| **O365 Business Premium** | **0** | **1** |

The second row shows one licence assigned from a subscription with no purchased units — the
usual cause is a subscription that has lapsed or been cancelled with the assignment still in
place. It is currently attached to `Admin.bext-automation@bextconsultancy.com.au`, which over
time can quietly degrade that account's mailbox and Teams access — and that mailbox sends the
05:00 daily report.

Worth checking at https://admin.microsoft.com → **Billing** → **Your products**.

Also note there are no spare licences in the tenant: both Business Premium licences are
assigned. If another licensed account is needed later, one has to be purchased.
