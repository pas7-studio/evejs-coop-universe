# LW-04C4 source-only strict native NPC SOLD finalization gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04c4-sold"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-npc-native-economy-director.test.mjs",
 "tests/coop-npc-industry-original-sale-audit.test.mjs",
 "tests/coop-npc-industry-original-wallet-witness.test.mjs",
 "tests/coop-npc-factory-original-sale-finance-chain.test.mjs",
 "tests/coop-npc-industry-original-buyer-settlement.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04c4-original-npc-sold-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04c4-original-npc-sold-finalization/v1" -or
 $manifest.scenarios.Count -ne 13 -or
 @($manifest.scenarios|Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04C4_REAL_NATIVE_SQLITE_RUST_E2E_NOT_RUN_REQUIRED"
}
foreach($path in $tests){
 if(-not (Test-Path (Join-Path $repo $path))){throw "LW04C4_REQUIRED_TEST_MISSING:$path"}
}
$log=Join-Path $ReportDir "lw04c4-sold-source-tests.log"
Push-Location $repo
try{
 & $node --check integration/coopNpcNativeEconomyDirector.cjs
 if($LASTEXITCODE -ne 0){throw "LW04C4_DIRECTOR_SYNTAX_FAILED"}
 & $node --test @tests *> $log
 $exitCode=$LASTEXITCODE
}finally{Pop-Location}
Get-Content $log | Select-Object -Last 90 | ForEach-Object{Write-Host $_}
if($exitCode -ne 0){throw "LW04C4_NODE_SOURCE_GATE_FAILED:$log"}
Write-Host "LW04C4 Node source tests PASS; real SQLite/Rust and 2-client E2E remain NOT_RUN."
