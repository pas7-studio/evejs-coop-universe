#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $CodePath 'compose.yaml'))) { throw "Missing compose.yaml: $CodePath" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not installed.' }
Push-Location $CodePath
try {
    $json = & docker compose ps --all --format json
    if ($LASTEXITCODE -ne 0) { throw 'docker compose ps failed' }
    $entries = @($json | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    if ($entries.Count -eq 1 -and $entries[0] -is [array]) { $entries = @($entries[0]) }
    foreach ($service in @('init','server','market')) {
        $entry = @($entries | Where-Object { $_.Service -eq $service } | Select-Object -First 1)
        if ($entry.Count -eq 0) { Write-Host "[FAIL] $service absent"; continue }
        $record = $entry[0]
        $ok = if ($service -eq 'init') { $record.State -eq 'exited' -and ([string]$record.ExitCode -eq '0') } else { $record.State -eq 'running' -and $record.Health -eq 'healthy' }
        $status = if ($ok) { 'PASS' } else { 'FAIL' }
        Write-Host ("[{0}] {1}: state={2}; health={3}; exit={4}" -f $status,$service,$record.State,$record.Health,$record.ExitCode)
    }
    Write-Host 'This command checks container state, NOT multiplayer, game login or NPC behavior.'
} finally { Pop-Location }
