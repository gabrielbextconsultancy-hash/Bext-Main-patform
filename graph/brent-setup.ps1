# Everything Brent needs to run, in one script. Idempotent — safe to re-run.
#
#   pwsh -File graph/brent-setup.ps1 -Humans brent@bextconsultancy.com.au
#   pwsh -File graph/brent-setup.ps1 -Humans a@x.com,b@x.com -SkipRole
#   pwsh -File graph/brent-setup.ps1 -WhatIfOnly          # report only, change nothing
#
# Brent must be Global Administrator or Privileged Role Administrator for step 1.
# Steps 2 and 3 only need team ownership, which Admin.bext-automation@ already has.
#
# Two sign-in prompts: one for Microsoft Graph, one for Microsoft Teams. Both are
# interactive by design — an unattended process should not hold admin rights.
#
# What this does NOT do: renew the lapsed O365 Business Premium licence. That is a
# purchase and has no cmdlet. See the closing summary.

param(
    [string[]] $Humans = @(),
    [switch]   $SkipRole,
    [switch]   $WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$Automation = 'Admin.bext-automation@bextconsultancy.com.au'
$TeamName   = 'bext_transcripts records'
# Well-known directory role template ids.
$CloudAppAdmin = '158c047a-c907-4556-b7ef-446551a6b5f7'   # Cloud Application Administrator
$TeamsAdmin    = '69091246-20e8-4a56-aa4d-066075b2a7a8'   # Teams Administrator (already assigned)

$done = @(); $todo = @()

function Need($name, $installName) {
    if (-not (Get-Module -ListAvailable -Name $name)) {
        Write-Host "Installing $installName ..."
        Install-Module $installName -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module $name -ErrorAction SilentlyContinue
}

# ── 1. Cloud Application Administrator on the automation account ─────────────
# Teams Administrator does NOT confer app-consent rights. Without this, every new
# MCP server or integration needs Brent to click Grant admin consent by hand.
# This role consents applications and nothing else: no mail, no files, no
# directory writes, and it cannot assign other roles.
if ($SkipRole) {
    Write-Host '[1] ROLE — skipped by request'
} else {
    Write-Host '[1] ROLE — Cloud Application Administrator'
    Need 'Microsoft.Graph.Identity.DirectoryManagement' 'Microsoft.Graph'
    Need 'Microsoft.Graph.Users' 'Microsoft.Graph'
    Connect-MgGraph -Scopes 'RoleManagement.ReadWrite.Directory', 'Directory.Read.All', 'User.Read.All' -NoWelcome

    $user = Get-MgUser -UserId $Automation
    $role = Get-MgDirectoryRole -Filter "roleTemplateId eq '$CloudAppAdmin'" -ErrorAction SilentlyContinue
    if (-not $role) {
        # Directory roles are dormant until first used; activate from the template.
        if ($WhatIfOnly) { Write-Host '  would activate the role template' }
        else { $role = New-MgDirectoryRole -RoleTemplateId $CloudAppAdmin; Write-Host '  activated the role template' }
    }

    if ($role) {
        $already = Get-MgDirectoryRoleMember -DirectoryRoleId $role.Id |
                   Where-Object { $_.Id -eq $user.Id }
        if ($already) {
            Write-Host "  ok    $Automation already holds Cloud Application Administrator"
            $done += 'Cloud Application Administrator (was already assigned)'
        } elseif ($WhatIfOnly) {
            Write-Host "  would assign Cloud Application Administrator to $Automation"
        } else {
            New-MgDirectoryRoleMemberByRef -DirectoryRoleId $role.Id -BodyParameter @{
                '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($user.Id)"
            }
            Write-Host "  added Cloud Application Administrator to $Automation"
            $done += 'Cloud Application Administrator assigned'
        }
    }

    $t = Get-MgDirectoryRole -Filter "roleTemplateId eq '$TeamsAdmin'" -ErrorAction SilentlyContinue
    if ($t -and (Get-MgDirectoryRoleMember -DirectoryRoleId $t.Id | Where-Object { $_.Id -eq $user.Id })) {
        Write-Host '  ok    Teams Administrator already assigned'
    }
}

# ── 2. Give the announcements an audience ────────────────────────────────────
# The pipeline files documents and posts a card into a team whose only member is
# the service account. It works perfectly and nobody reads it.
Write-Host ''
Write-Host '[2] TEAM MEMBERS'
Need 'MicrosoftTeams' 'MicrosoftTeams'
Connect-MicrosoftTeams | Out-Null

$team = Get-Team -DisplayName $TeamName -ErrorAction SilentlyContinue
if (-not $team) {
    Write-Host "  FAIL  team '$TeamName' not visible to this account"
    $todo += "could not see the team '$TeamName'"
} else {
    $members = Get-TeamUser -GroupId $team.GroupId
    Write-Host "  current: $($members.Count) member(s)"
    $members | ForEach-Object { Write-Host "    $($_.Role.PadRight(6)) $($_.User)" }

    foreach ($u in $Humans) {
        if ($members.User -contains $u) { Write-Host "    present $u"; continue }
        if ($WhatIfOnly) { Write-Host "    would add $u"; continue }
        try { Add-TeamUser -GroupId $team.GroupId -User $u; Write-Host "    added   $u"; $done += "added $u to the team" }
        catch { Write-Host "    FAILED  $u — $($_.Exception.Message)"; $todo += "add $u to the team" }
    }

    $after = Get-TeamUser -GroupId $team.GroupId
    if (-not ($after | Where-Object { $_.User -ne $Automation })) {
        $todo += 'the service account is still the only member — nobody will see the card'
    }
}

# ── 3. The four transcript gates, reported only ──────────────────────────────
Write-Host ''
Write-Host '[3] TRANSCRIPT GATES'
$mp = Get-CsTeamsMeetingPolicy -Identity Global
Write-Host "  transcription on global meeting policy: $($mp.AllowTranscription)"
if (-not $mp.AllowTranscription) {
    Write-Host '  FAIL  no transcript will be produced'
    Write-Host '        Set-CsTeamsMeetingPolicy -Identity Global -AllowTranscription $true'
    $todo += 'transcription is off on the global meeting policy'
}
$pol = Get-CsApplicationAccessPolicy -Identity 'BEXT-Automation-Policy' -ErrorAction SilentlyContinue
if ($pol) { Write-Host '  ok    application access policy present' }
else { Write-Host '  FAIL  application access policy missing — run graph/teams-access-policy.ps1'; $todo += 'application access policy missing' }
Write-Host '  by eye: https://admin.teams.microsoft.com → Transcript API access →'
Write-Host '          Microsoft Graph access must be ON (no cmdlet exposes this)'

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '───────────────────────────────────────────────'
if ($done.Count) { Write-Host 'Done:'; $done | ForEach-Object { Write-Host "  · $_" } }
if ($todo.Count) { Write-Host 'Still outstanding:'; $todo | ForEach-Object { Write-Host "  · $_" } }
Write-Host ''
Write-Host 'Not doable here — no cmdlet exists, it is a purchase:'
Write-Host '  · O365 Business Premium shows 0 purchased / 1 assigned on the report-sender'
Write-Host '    mailbox. It blocks the 05:00 daily report, not Teams.'
Write-Host '    https://admin.microsoft.com/#/subscriptions'
