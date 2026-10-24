#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Prepare','Start','CoopStart','LaunchOne','LaunchTwo','Status','Smoke','Party','Logs','Stop')]
    [string]$Action = 'Status',
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
    [string]$OutputRoot = '',
    [int]$LaunchGapSeconds = 20,
    [int]$HealthTimeoutSeconds = 240,
    [int]$NpcSystemID = 30000142,
    [switch]$ConfirmClientPermission
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $projectRoot 'test-results' }
$compose = Join-Path $CodePath 'compose.yaml'
$play = Join-Path $CodePath 'Play.bat'
if ($LaunchGapSeconds -lt 0 -or $LaunchGapSeconds -gt 300) { throw 'LaunchGapSeconds must be 0..300' }
if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
function Get-ComposeArgs {
    $options=@('--project-directory',$CodePath,'-f',$compose)
    $overlay=Join-Path $CodePath 'compose.coop-probe.yaml'
    if(Test-Path -LiteralPath $overlay -PathType Leaf){$options+=@('-f',$overlay)}
    return ,$options
}
function Invoke-Compose([string[]]$Arguments) {
    $options=Get-ComposeArgs
    & docker compose @options @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($Arguments -join ' ')" }
}
function Assert-BackendPrerequisites {
    if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw "Missing upstream compose.yaml: $compose. Run scripts/Fetch-Upstream.ps1 first." }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop CLI unavailable.' }
    $os = (& docker info --format '{{.OSType}}' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw "Docker must be running Linux containers: $os" }
}
function Wait-BackendHealthy {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    do {
        # Run the health checker in a separate process: its 'exit 1' must
        # not terminate this orchestrator before the retry loop finishes.
        $pwsh = (Get-Process -Id $PID).Path
        & $pwsh -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -eq 0) { return }
        Write-Host 'Backend still initializing; retrying health check...'
        Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    throw "Backend did not become healthy within $HealthTimeoutSeconds seconds. Run -Action Logs for diagnostics."
}
function Get-Timestamp { Get-Date -Format 'yyyyMMdd-HHmmss' }
switch ($Action) {
    'Prepare' {
        Assert-BackendPrerequisites
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Compose safety check failed.' }
        Invoke-Compose @('build','init')
        Invoke-Compose @('run','--rm','--no-deps','market-tools','engines')
        Invoke-Compose @('run','--rm','--no-deps','market-tools','rebuild','v1','--preset','jita_new_caldari')
        Write-Host 'Prepare complete. Next: -Action Start'
    }
    'Start' {
        Assert-BackendPrerequisites
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Compose safety check failed.' }
        Invoke-Compose @('up','--detach')
        Wait-BackendHealthy
        Write-Host 'Server running. Next: -Action LaunchTwo'
    }
    'CoopStart' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ required for pinned overlay.' }
        if ($NpcSystemID -le 0) { throw 'NpcSystemID must be a positive EveJS system ID.' }
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Unsafe Compose configuration.' }
        # Real source integration, one native encounter for a two-character party.
        # No market rebuild, database reset, open public ports or experimental
        # virtual economies in the recommended first-play path.
        & (Join-Path $PSScriptRoot 'Deploy-Coop-RuntimeProbe.ps1') -CodePath $CodePath -CoopCombat -NpcCount 1 -NpcSystemID $NpcSystemID
        if (-not $?) { throw 'Co-op runtime deployment failed.' }
        Wait-BackendHealthy
        Write-Host '[COOP] Backend ready for two private LOCAL clients.'
        Write-Host '[COOP] Use separate accounts. Fly both ships onto the same grid in the configured system.'
        Write-Host '[COOP] Run -Action Party to inspect actual shared-scene evidence.'
        Write-Warning 'Friend-PC/VPN access is NOT enabled by this command. Upstream still binds localhost.'
    }
    'LaunchOne' {
        Assert-BackendPrerequisites
        if (-not $ConfirmClientPermission) { throw 'Pass -ConfirmClientPermission only for an authorized compatible client.' }
        if (-not (Test-Path -LiteralPath $play -PathType Leaf)) { throw "Missing Play.bat: $play" }
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k call Play.bat' -WorkingDirectory $CodePath | Out-Null
        Write-Host '[PLAY] Started one local game client. Use the same authoritative Docker server for the second pilot.'
        Write-Warning 'For a second PC use only a separately authorized client and a verified private tunnel; no public ports.'
    }
    'LaunchTwo' {
        Assert-BackendPrerequisites
        if (-not $ConfirmClientPermission) { throw 'Explicitly pass -ConfirmClientPermission after confirming lawful client access, setup and permissions.' }
        if (-not (Test-Path -LiteralPath $play -PathType Leaf)) { throw "Missing Play.bat: $play" }
        & (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Backend is not healthy. Not launching clients.' }
        Write-Warning 'EveJS Play.bat was designed for single-client setup; multi-instance compatibility and shared cache isolation have NOT been verified. This command starts two launchers, not two guaranteed working game clients.'
        New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
        for ($n = 1; $n -le 2; $n++) {
            # Start each upstream launcher in its own visible command window.
            # Never copy/patch proprietary client binaries, install CA trust, or alter client config here.
            # PowerShell sets WorkingDirectory, so avoid nested cd /d quoting.
            Start-Process -FilePath 'cmd.exe' -ArgumentList '/k call Play.bat' -WorkingDirectory $CodePath | Out-Null
            Write-Host "Started Play.bat launcher #$n. Sign in with separate test account $n."
            if ($n -eq 1 -and $LaunchGapSeconds -gt 0) { Start-Sleep -Seconds $LaunchGapSeconds }
        }
        Write-Host 'Use separate test accounts/characters, never the same character in two sessions.'
    }
    'Status' {
        Assert-BackendPrerequisites
        Invoke-Compose @('ps','--all')
        & (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Backend health check failed.' }
    }
    'Smoke' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for transport smoke.' }
        $probe = Join-Path $PSScriptRoot 'smoke-two-tcp.mjs'
        & node $probe
        if ($LASTEXITCODE -ne 0) { throw 'Two concurrent TCP connections to EveJS game port failed.' }
        Write-Host 'Transport only: this is NOT a two-player login or gameplay PASS.'
    }
    'Party' {
        Assert-BackendPrerequisites
        $report=Join-Path $PSScriptRoot 'coop-party-report.cjs'
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for the party report.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw 'No live co-op event log yet. Run -Action CoopStart, enter space with both characters, and retry.'
        }
        $events | & node $report
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate co-op scene report.' }
    }
    'Logs' {
        Assert-BackendPrerequisites
        $folder = Join-Path $OutputRoot (Get-Timestamp)
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $options=Get-ComposeArgs
        & docker compose @options ps --all *> (Join-Path $folder 'compose-ps.txt')
        & docker compose @options logs --no-color --tail 1000 init market server *> (Join-Path $folder 'compose.log')
        & git -C (Split-Path -Parent $CodePath) rev-parse HEAD *> (Join-Path $folder 'upstream-sha.txt')
        Write-Host "Local evidence: $folder"
        Write-Warning 'Review logs for account names, tokens, IPs, emails, and credentials before sharing. These files remain local and must not be committed.'
    }
    'Stop' {
        Assert-BackendPrerequisites
        Write-Warning 'Stop both client windows manually first. This does not terminate or kill client processes.'
        Invoke-Compose @('down')
        Write-Host 'Backend stopped. Named volumes preserved.'
    }
}
