# LW-04C3B manual source-only NPC manufacturer sale finance gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04c3b-finance"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-npc-industry-original-sale-audit.test.mjs",
 "tests/coop-npc-industry-original-buyer-settlement.test.mjs",
 "tests/coop-npc-industry-original-wallet-witness.test.mjs",
 "tests/coop-npc-corporate-settlement.test.mjs",
 "tests/coop-npc-partial-fill-atomic.test.mjs",
 "tests/coop-npc-industry-original-rust-sell.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04c3b-factory-sale-finance-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04c3b-original-npc-sale-finance-e2e/v1" -or
 $manifest.scenarios.Count -ne 14 -or
 @($manifest.scenarios|Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04C3B_PHYSICAL_FINANCIAL_E2E_NOT_RUN_REQUIRED"
}
foreach($path in $tests){if(-not (Test-Path (Join-Path $repo $path))){
 throw "LW04C3B_REQUIRED_SOURCE_TEST_MISSING:$path"}}
$log=Join-Path $ReportDir "lw04c3b-finance-source-gates.log"
Push-Location $repo
try{& $node --test @tests *> $log;$exitCode=$LASTEXITCODE}
finally{Pop-Location}
Get-Content $log | Select-Object -Last 80 | ForEach-Object{Write-Host $_}
if($exitCode -ne 0){throw "LW04C3B_SOURCE_GATE_FAILURE:$log"}
Write-Host "LW04C3B source tests PASS; original native SQLite/Rust + 2-client E2E NOT_RUN."
