# Manual, source-level Stage J gate. No GitHub Actions or native world mutation.
# Does NOT enable game flags, patch Rust, or touch persistent evejs-data.
param(
 [string]$CodePath = ""
)
$ErrorActionPreference = "Stop"
$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $project
try {
 $tests = @(
  "tests/coop-salvage-npc-native-pending-market.test.mjs",
  "tests/coop-salvage-native-market-recovery.test.mjs",
  "tests/coop-alife-salvage-native-market.test.mjs",
  "tests/coop-stage-j-full-economy-source-e2e.test.mjs",
  "tests/coop-salvage-native-corporate-market-settlement.test.mjs",
  "tests/coop-npc-corporate-settlement.test.mjs",
  "tests/coop-stage-j-auto-market-wiring.test.mjs",
  "tests/coop-stage-j-native-rust-salvage-settlement-wiring.test.mjs"
 )
 & node --test @tests
 if ($LASTEXITCODE -ne 0) { throw "STAGE_J_NODE_REGRESSIONS_FAILED" }
 & node scripts/coop-test-baseline.cjs
 if ($LASTEXITCODE -ne 0) { throw "STAGE_J_BASELINE_FAILED" }
 if ($CodePath -ne "") {
  if (-not (Test-Path -LiteralPath $CodePath -PathType Container)) {
   throw "STAGE_J_PINNED_CODE_PATH_MISSING"
  }
  & node scripts/patch-evejs-coop.cjs --code-path $CodePath --dry-run
  if ($LASTEXITCODE -ne 0) { throw "STAGE_J_PINNED_OVERLAY_DRY_RUN_FAILED" }
 }
 Write-Host "STAGE_J_SOURCE_GATE=PASS"
 Write-Host "STAGE_J_RUST_COMPILE=NOT_RUN"
 Write-Host "STAGE_J_NATIVE_SQLITE=NOT_RUN"
 Write-Host "STAGE_J_TWO_CLIENT_EVE=NOT_RUN"
 Write-Host "Use tests/scenarios/coop-stage-j-full-autonomous-economy.json for real acceptance."
} finally {
 Pop-Location
}
