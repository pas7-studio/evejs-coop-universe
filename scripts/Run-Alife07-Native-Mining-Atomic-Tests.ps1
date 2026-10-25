# ALIFE-07: isolated SQLite and pinned source checks. No Docker or preserved volume.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife07-atomic"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$manifest=Join-Path $root "tests/scenarios/native-mining-atomic-e2e.json"
$m=Get-Content -Raw -Path $manifest | ConvertFrom-Json
if($m.schema -ne "evejs-coop/alife07-atomic-mining-e2e/v1" -or
 $m.scenarios.Count -ne 10 -or
 @($m.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -gt 0){
 throw "ALIFE-07 physical E2E cases cannot pass without local evidence"
}
$tests=@(
 "tests/coop-native-mining-atomic.test.mjs",
 "tests/coop-native-mining-atomic-overlay.test.mjs",
 "tests/coop-native-mining-cycle-conservation.test.mjs",
 "tests/coop-native-mining-cargo-integrity.test.mjs",
 "tests/coop-gamestore-atomic.test.mjs"
)
foreach($test in $tests){
 if(-not (Test-Path (Join-Path $root $test))){throw "Missing test: $test"}
}
$log=Join-Path $ReportDir "alife07-atomic-node-tests.log"
Push-Location $root
try{ & $node --test @tests *> $log; $status=$LASTEXITCODE }
finally{Pop-Location}
Get-Content -Path $log | Select-Object -Last 45 | ForEach-Object {Write-Host $_}
if($status -ne 0){throw "ALIFE07 Node test suite failed: $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 Push-Location $root
 try{
  & $node "scripts/verify-alife07-native-mining-source.cjs" $UpstreamCodeRoot
  if($LASTEXITCODE -ne 0){throw "ALIFE07 original pinned mining source mismatch"}
 }finally{Pop-Location}
}else{Write-Host "Pinned upstream source NOT CHECKED: supply -UpstreamCodeRoot"}
Write-Host "PASS: Node isolated checks only; 10 physical ALIFE07 E2E scenarios NOT_RUN."
Write-Host "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC default OFF."
Write-Host "No game world, Docker or preserved evejs-data modifications."
