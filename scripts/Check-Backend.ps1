#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $CodePath 'compose.yaml'))) { throw "Missing compose.yaml: $CodePath" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not installed.' }
Push-Location $CodePath
try {
    # Docker Compose v2 may emit a JSON array or one JSON object per line.
    $raw = @(& docker compose ps --all --format json)
    if ($LASTEXITCODE -ne 0) { throw 'docker compose ps failed' }
    $text = ($raw -join [Environment]::NewLine).Trim()
    if (-not $text) { throw 'No Compose services returned; deploy the backend first.' }
    $entries = @()
    try {
        $parsed = ConvertFrom-Json -InputObject $text
        $entries = @($parsed)
    } catch {
        foreach ($line in $raw) {
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                $entries += ConvertFrom-Json -InputObject $line
            }
        }
    }
    if ($entries.Count -eq 1 -and $entries[0] -is [array]) { $entries = @($entries[0]) }
    $failed = $false
    foreach ($service in @('init','server','market')) {
        $matching = @($entries | Where-Object { $_.Service -eq $service })
        if ($matching.Count -eq 0) { Write-Host "[FAIL] $service absent"; $failed = $true; continue }
        $record = $matching[0]
        $ok = if ($service -eq 'init') {
            $record.State -eq 'exited' -and ([string]$record.ExitCode -eq '0')
        } else {
            $record.State -eq 'running' -and $record.Health -eq 'healthy'
        }
        if (-not $ok) { $failed = $true }
        $status = if ($ok) { 'PASS' } else { 'FAIL' }
        Write-Host ("[{0}] {1}: state={2}; health={3}; exit={4}" -f $status,$service,$record.State,$record.Health,$record.ExitCode)
    }
    Write-Host 'Backend container state only; not proof of playable EVE, multiplayer, or NPC functionality.'
    if ($failed) { exit 1 }
} finally { Pop-Location }
