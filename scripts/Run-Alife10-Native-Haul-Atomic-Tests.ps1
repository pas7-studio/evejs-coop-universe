# ALIFE-10 read-only and disposable SQLite regression gate.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife10-atomic-haul"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-native-haul-transfer-atomic.test.mjs",
 "tests/coop-native-haul-transfer-sqlite.test.mjs",
 "tests/coop-native-haul-atomic-routing.test.mjs",
 "tests/coop-native-hauler-persistence.test.mjs",
 "tests/coop-native-mining-fleet-durable.test.mjs",
 "tests/coop-native-mining-atomic.test.mjs",
 "tests/coop-alife09-station-fleet-restart-compat.test.mjs",
 "tests/coop-native-station-arrival.test.mjs",
 "tests/coop-native-warehouse.test.mjs"
)
foreach($test in $tests){
 if(-not(Test-Path (Join-Path $repo $test))){throw "Missing required native test: $test"}
}
$manifest=Get-Content -Raw -Path (Join-Path $repo "tests/scenarios/native-haul-transfer-atomic-alife10-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/alife10-atomic-native-haul-e2e/v1" -or
   $manifest.scenarios.Count -ne 9 -or
   @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "ALIFE-10 physical E2E manifest must remain NOT_RUN without evidence"
}
# The node:sqlite test creates and deletes an isolated temporary .sqlite file.
$log=Join-Path $ReportDir "alife10-native-haul-node.log"
Push-Location $repo
try{& $node --test @tests *> $log; $exitCode=$LASTEXITCODE}
finally{Pop-Location}
Get-Content -Path $log | Select-Object -Last 55 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "ALIFE-10 test suite failed. Log: $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 & $node (Join-Path $repo "scripts/verify-alife09-mining-overlay.cjs") $UpstreamCodeRoot
 if($LASTEXITCODE -ne 0){throw "Pinned original mining overlay preflight FAILED"}
}else{Write-Warning "Pinned source not inspected: pass -UpstreamCodeRoot to check pristine EveJS"}
Write-Host "PASS: isolated unit/SQLite regression suite. Physical gameplay E2E: 9 NOT_RUN."
Write-Host "No Docker commands and no protected evejs-data modifications."
