#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',[switch]$Remove)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$installer=Join-Path $PSScriptRoot 'Install-Coop-RuntimeProbe.ps1'
$override=Join-Path $CodePath 'compose.coop-probe.yaml'
& $installer -CodePath $CodePath -Remove:$Remove
if($Remove) {
  if(Test-Path -LiteralPath $override){Remove-Item -LiteralPath $override -Force}
} else {
  $yaml=@'
services:
  server:
    environment:
      EVEJS_COOP_EVENTS_FILE: /var/lib/evejs/coop-events.jsonl
'@
  [System.IO.File]::WriteAllText($override,$yaml,[System.Text.UTF8Encoding]::new($false))
}
Push-Location $CodePath
try {
  & docker compose -f compose.yaml build
  if($LASTEXITCODE -ne 0){throw 'Docker build failed'}
  if($Remove) {
    & docker compose -f compose.yaml up -d
  } else {
    & docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
  }
  if($LASTEXITCODE -ne 0){throw 'Docker startup failed'}
  Write-Host ('[DONE] Co-op probe ' + $(if($Remove){'removed'}else{'installed and started'}))
} finally {Pop-Location}
