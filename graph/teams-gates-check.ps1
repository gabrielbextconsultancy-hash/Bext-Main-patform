# Reports the four Teams gates, read-only. Changes nothing.
#
#   pwsh -File graph/teams-gates-check.ps1
#
# Transcripts only reach the pipeline when all four of these hold. They are
# independent, two of them are off by default, and one has already regressed once —
# so "it worked last week" is not evidence. Run this when a transcript fails to
# appear, before touching any code.
#
# Since 18 Aug 2026 Admin.bext-automation@ holds the Teams Administrator role, so
# this no longer needs Brent. It still signs in interactively: a Teams admin session
# is not something the automation should hold unattended.

$ErrorActionPreference = 'Stop'

$AppId     = 'b72d1df4-06ec-4390-937a-1293f34d31be'   # BEXT Automation (Dev)
$Organiser = 'Admin.bext-automation@bextconsultancy.com.au'
$Policy    = 'BEXT-Automation-Policy'

if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
    Write-Host 'Installing the MicrosoftTeams module...'
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
}
Import-Module MicrosoftTeams
Connect-MicrosoftTeams | Out-Null

$fail = @()

# ── Gate 2 — application access policy ───────────────────────────────────────
# Gate 1 (admin consent) lives in Entra and is checked by graph/verify.js.
Write-Host ''
Write-Host '[2] APPLICATION ACCESS POLICY'
$p = Get-CsApplicationAccessPolicy -Identity $Policy -ErrorAction SilentlyContinue
if (-not $p) {
    Write-Host "  FAIL  policy $Policy does not exist"
    $fail += 'access policy missing — run graph/teams-access-policy.ps1'
} elseif ($p.AppIds -notcontains $AppId) {
    Write-Host "  FAIL  $Policy exists but does not name $AppId"
    $fail += 'access policy does not name the app'
} else {
    Write-Host "  ok    $Policy names the app"
    $granted = Get-CsUserPolicyAssignment -Identity $Organiser -PolicyType ApplicationAccessPolicy -ErrorAction SilentlyContinue
    if ($granted) { Write-Host "  ok    granted to $Organiser" }
    else { Write-Host "  warn  could not confirm the grant to $Organiser (a -Global grant does not show per-user)" }
}

# ── Gate 4 — transcription on the meeting policy ─────────────────────────────
Write-Host ''
Write-Host '[4] MEETING POLICY'
$mp = Get-CsTeamsMeetingPolicy -Identity Global
Write-Host "  transcription  : $($mp.AllowTranscription)"
Write-Host "  cloud recording: $($mp.AllowCloudRecording)"
if (-not $mp.AllowTranscription) {
    Write-Host '  FAIL  transcription is OFF — there will be no transcript to read'
    Write-Host '        Set-CsTeamsMeetingPolicy -Identity Global -AllowTranscription $true'
    $fail += 'transcription off on the global meeting policy'
} else {
    Write-Host '  ok    transcription is on'
}

# ── Gate 3 — tenant transcript API access ────────────────────────────────────
# No cmdlet exposes this. Microsoft added the control late July 2026 and it is off
# by default, which is exactly why it cost a day to find.
Write-Host ''
Write-Host '[3] TRANSCRIPT API ACCESS — check by eye, no cmdlet exists'
Write-Host '  https://admin.teams.microsoft.com  →  Transcript API access'
Write-Host '  →  Microsoft Graph access must be ON'

# ── Audience ─────────────────────────────────────────────────────────────────
# Not a gate, but the announcement is pointless without it.
Write-Host ''
Write-Host '[5] CHANNEL AUDIENCE'
$team = Get-Team -DisplayName 'bext_transcripts records' -ErrorAction SilentlyContinue
if ($team) {
    $members = Get-TeamUser -GroupId $team.GroupId
    Write-Host "  $($members.Count) member(s):"
    $members | ForEach-Object { Write-Host "    $($_.Role.PadRight(6)) $($_.User)" }
    $humans = $members | Where-Object { $_.User -ne $Organiser }
    if (-not $humans) {
        Write-Host '  FAIL  the service account is the only member — nobody sees the card'
        $fail += 'no human members on bext_transcripts records'
    }
} else {
    Write-Host '  warn  team not visible to this session'
}

Write-Host ''
if ($fail.Count) {
    Write-Host 'NOT READY'
    $fail | ForEach-Object { Write-Host "  · $_" }
    exit 1
} else {
    Write-Host 'All checked gates pass. Confirm gate 3 by eye.'
}
