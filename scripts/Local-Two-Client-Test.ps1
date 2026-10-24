#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Prepare','Start','LaunchTwo','Status','Smoke','Logs','Stop')]
    [string]$Action = 'Status',
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
    [string]$OutputRoot = '',
    [int]$LaunchGapSeconds = 20,
    [int]$HealthTimeoutSeconds = 240,
    [switch]$ConfirmClientPermission
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $projectRoot 'test-results' }
$compose = Join-Path $CodePath 'compose.yaml'
$play = Join-Path $CodePath 'Play.bat'
if ($LaunchGapSeconds -lt 0 -or $LaunchGapSeconds -gt 300) { throw 'LaunchGapSeconds must be 0..300' }
if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
function Invoke-Compose([string[]]$Arguments) {
    & docker compose --project-directory $CodePath -f $compose @Arguments
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
        & (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -eq 0 -and $?) { return }
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
    'Logs' {
        Assert-BackendPrerequisites
        $folder = Join-Path $OutputRoot (Get-Timestamp)
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        & docker compose --project-directory $CodePath -f $compose ps --all *> (Join-Path $folder 'compose-ps.txt')
        & docker compose --project-directory $CodePath -f $compose logs --no-color --tail 1000 init market server *> (Join-Path $folder 'compose.log')
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
