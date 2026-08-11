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
    Set-CsApplicationAccessPolicy -Identity $Policy -AppIds @{ add = $AppId } -ErrorAction SilentlyContinue
} else {
    New-CsApplicationAccessPolicy -Identity $Policy -AppIds $AppId `
        -Description 'Lets BEXT Automation read online meetings and transcripts'
    Write-Host "Created policy $Policy."
}

Grant-CsApplicationAccessPolicy -PolicyName $Policy -Identity $Organiser
Write-Host "Granted $Policy to $Organiser."

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

Write-Host ''
Write-Host 'Policy assignment can take up to 30 minutes to take effect.'
