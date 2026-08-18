# Adds people to the team that receives the meeting record.
#
#   pwsh -File graph/team-add-members.ps1 -Upns brent@bextconsultancy.com.au
#   pwsh -File graph/team-add-members.ps1 -Upns a@x.com,b@x.com -Role Owner
#   pwsh -File graph/team-add-members.ps1            # list current members, add nothing
#
# Why this exists: as of 18 Aug 2026 the team `bext_transcripts records` has exactly
# one member, Admin.bext-automation@ — the service account that files the documents.
# The pipeline works perfectly and no human sees any of it. Adding people is the
# difference between a working automation and a useful one.
#
# Admin.bext-automation@ is the team OWNER, so this needs no tenant admin. What it
# does need is Brent deciding WHO — that is a client call, not a technical one.

param(
    [string[]] $Upns = @(),
    [ValidateSet('Member', 'Owner')]
    [string] $Role = 'Member'
)

$ErrorActionPreference = 'Stop'
$TeamName = 'bext_transcripts records'

if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
    Write-Host 'Installing the MicrosoftTeams module...'
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
}
Import-Module MicrosoftTeams
Connect-MicrosoftTeams | Out-Null

$team = Get-Team -DisplayName $TeamName
if (-not $team) { throw "Team '$TeamName' not visible to this account." }

Write-Host ''
Write-Host "Team: $TeamName  ($($team.GroupId))"
Write-Host 'Current members:'
Get-TeamUser -GroupId $team.GroupId | ForEach-Object {
    Write-Host "  $($_.Role.PadRight(6)) $($_.User)"
}

if (-not $Upns.Count) {
    Write-Host ''
    Write-Host 'No -Upns given, so nothing was changed.'
    Write-Host 'Re-run with, for example:'
    Write-Host '  pwsh -File graph/team-add-members.ps1 -Upns brent@bextconsultancy.com.au'
    return
}

Write-Host ''
Write-Host "Adding $($Upns.Count) person(s) as ${Role}:"
foreach ($u in $Upns) {
    try {
        # Idempotent enough: adding an existing member throws, which is not a failure.
        Add-TeamUser -GroupId $team.GroupId -User $u -Role $Role
        Write-Host "  added   $u"
    } catch {
        if ($_.Exception.Message -match 'already') { Write-Host "  present $u" }
        else { Write-Host "  FAILED  $u — $($_.Exception.Message)" }
    }
}

Write-Host ''
Write-Host 'Members now:'
Get-TeamUser -GroupId $team.GroupId | ForEach-Object {
    Write-Host "  $($_.Role.PadRight(6)) $($_.User)"
}
Write-Host ''
Write-Host 'New members see the channel history, including any cards already posted.'
