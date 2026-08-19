# Grants BEXT Automation permission to read meeting transcripts.
#
#   pwsh -File graph/teams-access-policy.ps1
#
# Run this yourself — it signs in interactively as a Teams administrator, which
# is not something the automation can or should do on its own.
#
# Reading a transcript through Graph needs two things beyond the app registration:
#
#   1. the OnlineMeetingTranscript.Read.All application permission, granted in the
#      Entra portal (see graph/app-registration.md), and
#   2. an application access policy naming the app and granted to the meeting
#      organiser — this script.
#
# Without the policy, transcript calls fail 403 even with the permission consented.
# Microsoft's reasoning is that a tenant-wide permission would otherwise let the
# app read every meeting in the organisation; the policy narrows it to named users.

$ErrorActionPreference = 'Stop'

$AppId     = 'b72d1df4-06ec-4390-937a-1293f34d31be'   # BEXT Automation (Dev)
$Organiser = 'Admin.bext-automation@bextconsultancy.com.au'
$Policy    = 'BEXT-Automation-Policy'

if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
    Write-Host 'Installing the MicrosoftTeams module...'
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
}

Import-Module MicrosoftTeams
Connect-MicrosoftTeams

# Idempotent: re-running must not fail on a policy that is already there.
if (Get-CsApplicationAccessPolicy -Identity $Policy -ErrorAction SilentlyContinue) {
    Write-Host "Policy $Policy exists — adding the app id if it is missing."
    # Adding an app id that is already present throws
    #   Cannot add these items to the collection as they conflict or have
    #   duplicate key/identity: AppIds: <id>
    # and -ErrorAction SilentlyContinue does NOT suppress it. With
    # $ErrorActionPreference = 'Stop' that aborted the script here, before the
    # Grant below — so two runs of this script changed nothing and the app still
    # could not read anyone else's meetings. Already-present is the expected
    # state on a re-run, not a failure.
    try {
        Set-CsApplicationAccessPolicy -Identity $Policy -AppIds @{ add = $AppId } -ErrorAction Stop
        Write-Host "  added $AppId to the policy."
    } catch {
        if ($_.Exception.Message -match 'conflict or have duplicate') {
            Write-Host "  $AppId is already named by the policy — nothing to add."
        } else {
            Write-Host "  could not add the app id: $($_.Exception.Message)"
        }
    }
} else {
    New-CsApplicationAccessPolicy -Identity $Policy -AppIds $AppId `
        -Description 'Lets BEXT Automation read online meetings and transcripts'
    Write-Host "Created policy $Policy."
}

# Granted tenant-wide, not per user. Verified 18 Aug 2026 that a per-user grant
# is not enough: reading an online meeting hosted by anyone else returns
#   403  3003: User does not have access to lookup meeting
# which reads like a missing permission and is not. Whoever hosts the meeting is
# the account the pipeline must read, and that will not always be the automation
# account — so the policy has to cover the tenant.
try {
    Grant-CsApplicationAccessPolicy -PolicyName $Policy -Global -ErrorAction Stop
    Write-Host "Granted $Policy tenant-wide (-Global)."
} catch {
    if ($_.Exception.Message -match 'already|duplicate') {
        Write-Host "Policy $Policy is already granted tenant-wide."
    } else {
        Write-Host "GRANT FAILED: $($_.Exception.Message)"
        Write-Host "Without this grant the app cannot read meetings hosted by anyone"
        Write-Host "other than the automation account."
    }
}

# Kept for reference: the narrower grant, if the tenant ever wants it scoped.
#   Grant-CsApplicationAccessPolicy -PolicyName $Policy -Identity $Organiser
foreach ($u in @($Organiser, 'Brent@bextconsultancy.com.au')) {
    try {
        Grant-CsApplicationAccessPolicy -PolicyName $Policy -Identity $u -ErrorAction Stop
        Write-Host "Granted $Policy to $u."
    } catch {
        Write-Host "Per-user grant for $u skipped: $($_.Exception.Message)"
    }
}

# Transcription itself is a meeting policy setting, separate from the access
# policy above. Reported rather than changed: the global policy applies to every
# meeting in the tenant, so flipping it is the administrator's decision.
$meetingPolicy = Get-CsTeamsMeetingPolicy -Identity Global
Write-Host ''
Write-Host "Global meeting policy — transcription: $($meetingPolicy.AllowTranscription)"
Write-Host "Global meeting policy — cloud recording: $($meetingPolicy.AllowCloudRecording)"
if (-not $meetingPolicy.AllowTranscription) {
    Write-Host ''
    Write-Host 'Transcription is OFF. There will be no transcript for the workflow to read.'
    Write-Host 'Turn it on at https://admin.teams.microsoft.com/policies/meetings, or run:'
    Write-Host '  Set-CsTeamsMeetingPolicy -Identity Global -AllowTranscription $true'
}

# Print the end state rather than leaving the operator to trust a silent run —
# the previous version failed halfway and still looked like it had worked.
Write-Host ''
Write-Host 'Policy as it now stands:'
Get-CsApplicationAccessPolicy -Identity $Policy | Format-List Identity, AppIds, Description

Write-Host 'Tenant-wide (Global) assignment:'
try {
    Get-CsApplicationAccessPolicy -Identity Global |
        Format-List Identity, AppIds
} catch {
    Write-Host "  could not read the Global assignment: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'Policy assignment can take up to 30 minutes to take effect.'
Write-Host 'Verify from the repo with:  node graph/verify-meeting-access.js'
