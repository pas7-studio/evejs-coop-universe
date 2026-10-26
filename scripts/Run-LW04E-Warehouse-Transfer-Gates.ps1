# LW-04E source-only original ALIFE-09 and corporate warehouse title gate
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04e-warehouse"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-lw04e-original-warehouse-title-transfer.test.mjs",
 "tests/coop-native-station-ore-settlement.test.mjs",
 "tests/coop-lw04d-original-native-chain-proof.test.mjs",
 "tests/coop-npc-industry-original-game-store-kernel.test.mjs",
 "tests/coop-npc-refinery.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $root "tests/scenarios/lw04e-original-warehouse-title-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04e-original-warehouse-title-finance-e2e/v1" -or
 $manifest.scenarios.Count -ne 15 -or
 @($manifest.scenarios|Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04E_NATIVE_E2E_NOT_RUN_MANIFEST_REQUIRED"
}
foreach($p in $tests){
 if(-not (Test-Path (Join-Path $root $p))){throw "LW04E_SOURCE_TEST_MISSING:$p"}
}
$log=Join-Path $ReportDir "lw04e-source-node-gate.log"
Push-Location $root
try{
 & $node --test @tests *> $log
 $exitCode=$LASTEXITCODE
}finally{Pop-Location}
Get-Content $log | Select-Object -Last 85 | ForEach-Object{Write-Host $_}
if($exitCode -ne 0){throw "LW04E_SOURCE_NODE_GATE_FAILED:$log"}
Write-Host "LW04E source-only PASS. Physical original GameStore/Rust/2-client NOT_RUN."
