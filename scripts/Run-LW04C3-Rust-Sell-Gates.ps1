# LW-04C3 source-only Rust NPC sell listing and escrow test gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04c3-source"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-npc-industry-original-rust-sell.test.mjs",
 "tests/coop-npc-pending-market-escrow.test.mjs",
 "tests/coop-npc-industry-original-stage-executor.test.mjs",
 "tests/coop-npc-industry-original-game-store-kernel.test.mjs",
 "tests/coop-npc-industry-recovery-fence.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04c3-rust-npc-sell-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04c3-original-rust-npc-sell-e2e/v1" -or
 $manifest.scenarios.Count -ne 12 -or
 @($manifest.scenarios|Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04C3_NATIVE_RUST_E2E_MANIFEST_NOT_RUN_REQUIRED"
}
foreach($path in $tests){
 if(-not (Test-Path (Join-Path $repo $path))){throw "LW04C3_TEST_MISSING:$path"}
}
$log=Join-Path $ReportDir "lw04c3-source-gates.log"
Push-Location $repo
try{& $node --test @tests *> $log;$exitCode=$LASTEXITCODE}
finally{Pop-Location}
Get-Content $log | Select-Object -Last 60 | ForEach-Object{Write-Host $_}
if($exitCode -ne 0){throw "LW04C3_SOURCE_GATE_FAILED:$log"}
Write-Host "LW04C3 source-only PASS; actual Rust daemon/SQLite/two-client NOT_RUN."
