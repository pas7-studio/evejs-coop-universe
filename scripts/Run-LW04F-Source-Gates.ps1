# LW-04F exact original COOP-030 hook and ALIFE-09 source/flush regression.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04f-depot"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$tests=@(
 "tests/coop-lw04f-original-native-depot-hook.test.mjs",
 "tests/coop-native-station-ore-settlement.test.mjs",
 "tests/coop-lw04e-original-warehouse-title-transfer.test.mjs",
 "tests/coop-lw04d-original-native-chain-proof.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04f-original-depot-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04f-original-itemstore-depot-e2e/v1" -or
 $manifest.scenarios.Count -ne 12 -or
 @($manifest.scenarios | Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04F_REAL_NATIVE_DEPOSIT_AND_SQLITE_NOT_RUN_REQUIRED"
}
$node=(Get-Command node -ErrorAction Stop).Source
Push-Location $repo
try {
 foreach($file in $tests){if(-not (Test-Path $file)){throw "LW04F_SOURCE_MISSING:$file"}}
 & $node --check integration/coopNativeStationOreSettlement.cjs
 if($LASTEXITCODE -ne 0){throw "LW04F_SOURCE_SYNTAX_FAILED"}
 & $node --test @tests *> (Join-Path $ReportDir "lw04f-node-source.log")
 $code=$LASTEXITCODE
}finally{Pop-Location}
Get-Content (Join-Path $ReportDir "lw04f-node-source.log") |
 Select-Object -Last 80 | ForEach-Object{Write-Host $_}
if($code -ne 0){throw "LW04F_NODE_SOURCE_GATE_FAILED"}
Write-Host "LW04F source gate PASS; original native SQLite/Rust and two-client E2E NOT_RUN."
