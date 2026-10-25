# ALIFE-11 read-only mixed NPC cargo regression gate.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife11-cargo-isolation"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$files=@(
 "tests/coop-native-cargo-transient-isolation.test.mjs",
 "tests/coop-native-haul-transfer-atomic.test.mjs",
 "tests/coop-native-haul-transfer-sqlite.test.mjs",
 "tests/coop-native-haul-atomic-routing.test.mjs",
 "tests/coop-gamestore-atomic.test.mjs",
 "tests/coop-gamestore-atomic-patch.test.mjs",
 "tests/coop-native-mining-atomic.test.mjs",
 "tests/coop-native-mining-fleet-durable.test.mjs",
 "tests/coop-native-station-arrival.test.mjs",
 "tests/coop-native-warehouse.test.mjs"
)
foreach($f in $files){if(-not(Test-Path (Join-Path $repo $f))){throw "ALIFE11_REQUIRED_TEST_NOT_FOUND: $f"}}
$physical=Get-Content -Raw -Path (Join-Path $repo "tests/scenarios/alife11-transient-cargo-isolation-e2e.json") | ConvertFrom-Json
if($physical.schema -ne "evejs-coop/alife11-transient-native-cargo-isolation/v1" -or
  $physical.scenarios.Count -ne 9 -or
  @($physical.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "ALIFE11_PHYSICAL_SCENARIOS_MUST_REMAIN_NOT_RUN_WITHOUT_EVIDENCE"
}
$log=Join-Path $ReportDir "alife11-native-cargo-node.log"
Push-Location $repo
try {& $node --test @files *> $log; $exitCode=$LASTEXITCODE}
finally {Pop-Location}
Get-Content $log | Select-Object -Last 50 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "ALIFE11_NODE_TEST_FAILED: $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 & $node (Join-Path $repo "scripts/verify-alife09-mining-overlay.cjs") $UpstreamCodeRoot
 if($LASTEXITCODE -ne 0){throw "ALIFE11_PINNED_SOURCE_PREFLIGHT_FAILED"}
}else{Write-Warning "Original clean pinned source not inspected. Provide -UpstreamCodeRoot."}
Write-Host "PASS: isolated native Node/SQLite regression gate. Nine physical E2E NOT_RUN."
Write-Host "No Docker commands; no changes to protected evejs-data."
