# ALIFE-08 isolated tests / pinned upstream read-only verification.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
  $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife08-durable"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$files=@(
  "tests/coop-native-mining-fleet-durable.test.mjs",
  "tests/coop-native-mining-fleet-durable-overlay.test.mjs",
  "tests/coop-native-mining-cargo-integrity.test.mjs",
  "tests/coop-native-mining-cycle-conservation.test.mjs",
  "tests/coop-mining-startup-retry.test.mjs",
  "tests/coop-native-convoy-renewal.test.mjs"
)
foreach($file in $files){
 if(-not(Test-Path (Join-Path $repo $file))){throw "Required test missing: $file"}
}
$scenarios=Get-Content -Raw -Path (Join-Path $repo "tests/scenarios/native-mining-fleet-durable-e2e.json") | ConvertFrom-Json
if($scenarios.schema -ne "evejs-coop/alife08-durable-native-mining-e2e/v1" -or
   $scenarios.scenarios.Count -ne 12 -or
   @($scenarios.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "ALIFE08 physical E2E manifest lacks a truthful NOT_RUN gate"
}
$log=Join-Path $ReportDir "alife08-isolated-node.log"
Push-Location $repo
try { & $node --test @files *> $log; $exitCode=$LASTEXITCODE } finally { Pop-Location }
Get-Content $log | Select-Object -Last 45 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "ALIFE08 Node tests failed, inspect $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 & $node (Join-Path $repo "scripts/verify-alife08-durable-mining-source.cjs") $UpstreamCodeRoot
 if($LASTEXITCODE -ne 0){throw "ALIFE08 pinned EveJS source preflight FAILED"}
}else{Write-Warning "Pinned source NOT verified: supply -UpstreamCodeRoot"}
Write-Host "PASS: isolated Node tests only; 12 physical mining E2E scenarios NOT_RUN."
Write-Host "Feature flag EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE remains default OFF."
Write-Host "No changes to Docker or protected evejs-data."
