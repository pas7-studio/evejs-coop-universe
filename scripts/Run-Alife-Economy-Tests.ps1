# COOP-042 A-Life native economy unit+scenario preflight (no Docker actions).
# Usage: pwsh -File scripts/Run-Alife-Economy-Tests.ps1
[CmdletBinding()]
param(
  [string]$ReportDir = "",
  [switch]$IncludeExistingEconomyTests
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
  $ReportDir = Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife-economy-gates"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$manifestPath = Join-Path $root "tests/scenarios/alife-native-economy-e2e.json"
if (-not (Test-Path $manifestPath)) { throw "Missing 22-scenario ALIFE acceptance manifest" }
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
if ($manifest.schema -ne "coop-alife-economy-acceptance/v1" -or $manifest.scenarios.Count -lt 20) {
  throw "Invalid ALIFE native economy test manifest"
}
$nonPending = @($manifest.scenarios | Where-Object { $_.status -ne "NOT_RUN" })
if ($nonPending.Count -gt 0) {
  throw "Do not mark local E2E scenarios PASS before actually running them"
}
$integrityManifest = Join-Path $root "tests/scenarios/coop-044-industry-replenishment-integrity.json"
if (-not (Test-Path $integrityManifest)) { throw "Missing native industry replenishment integrity scenarios" }
$integrity = Get-Content -Raw -Path $integrityManifest | ConvertFrom-Json
if ($integrity.schema -ne "coop-044-native-industry-replenishment-integrity/v1" -or $integrity.scenarios.Count -lt 10) {
  throw "Native industry integrity acceptance manifest invalid"
}
if (@($integrity.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not mark native industry acceptance scenarios PASS before real gameplay validation"
}
$demandManifest = Join-Path $root "tests/scenarios/coop-045-native-demand-lifecycle.json"
if (-not (Test-Path $demandManifest)) { throw "Missing native demand lifecycle scenarios" }
$demand = Get-Content -Raw -Path $demandManifest | ConvertFrom-Json
if ($demand.schema -ne "coop-045-native-demand-lifecycle/v1" -or $demand.scenarios.Count -lt 8) {
  throw "Invalid native demand lifecycle acceptance manifest"
}
if (@($demand.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not mark demand lifecycle gameplay scenarios PASS without actual native evidence"
}
$policyManifest = Join-Path $root "tests/scenarios/coop-046-market-policy-acceptance.json"
if (-not (Test-Path $policyManifest)) { throw "Missing native market policy acceptance scenarios" }
$policy = Get-Content -Raw -Path $policyManifest | ConvertFrom-Json
if ($policy.schema -ne "coop-046-native-market-policy/v1" -or $policy.scenarios.Count -lt 6) {
  throw "Invalid native market policy acceptance manifest"
}
if (@($policy.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not mark market policy E2E PASS without native settlement evidence"
}
$partialManifest = Join-Path $root "tests/scenarios/coop-047-native-partial-market-e2e.json"
if (-not (Test-Path $partialManifest)) { throw "Missing native partial-fill acceptance scenarios" }
$partial = Get-Content -Raw -Path $partialManifest | ConvertFrom-Json
if ($partial.schema -ne "coop-047-native-partial-market/v1" -or $partial.scenarios.Count -lt 7) {
  throw "Invalid native partial-fill acceptance manifest"
}
if (@($partial.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not mark native Rust/GameStore E2E PASS without physical evidence"
}
$npcBuyerManifest = Join-Path $root "tests/scenarios/coop-048-native-npc-player-buyer.json"
if (-not (Test-Path $npcBuyerManifest)) { throw "Missing native NPC buyer acceptance scenarios" }
$npcBuyer = Get-Content -Raw -Path $npcBuyerManifest | ConvertFrom-Json
if ($npcBuyer.schema -ne "coop-048-native-npc-player-buy/v1" -or $npcBuyer.scenarios.Count -lt 8) {
  throw "Invalid native NPC corporate buyer acceptance manifest"
}
if (@($npcBuyer.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not claim NPC buyer gameplay success without native Rust/GameStore evidence"
}
$integrationManifestPath = Join-Path $root "tests/scenarios/alife-native-authority-integration.json"
if (-not (Test-Path $integrationManifestPath)) { throw "Missing 8-scenario A-Life integration acceptance manifest" }
$integration = Get-Content -Raw -Path $integrationManifestPath | ConvertFrom-Json
if ($integration.schema -ne "evejs-coop/alife-integration-acceptance/v1" -or $integration.scenarios.Count -ne 8) {
  throw "Invalid A-Life integration acceptance manifest"
}
if (@($integration.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Never mark live A-Life gameplay accepted from an isolated test run"
}
$actManifestPath = Join-Path $root "tests/scenarios/alife-native-resupply-act-e2e.json"
if (-not (Test-Path $actManifestPath)) { throw "Missing native A-Life RESUPPLY ACT acceptance manifest" }
$actManifest = Get-Content -Raw -Path $actManifestPath | ConvertFrom-Json
if ($actManifest.schema -ne "evejs-coop/alife-native-resupply-act-acceptance/v1" -or $actManifest.scenarios.Count -ne 7) {
 throw "Invalid native RESUPPLY ACT scenarios"
}
if (@($actManifest.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
 throw "Never claim live native resupply ACT from source-only tests"
}
$buyer49Manifest = Join-Path $root "tests/scenarios/coop-049-alife-native-buyer-e2e.json"
if (-not (Test-Path $buyer49Manifest)) { throw "Missing A-Life native buyer acceptance scenarios" }
$buyer49 = Get-Content -Raw -Path $buyer49Manifest | ConvertFrom-Json
if ($buyer49.schema -ne "coop-049-alife-native-buyer-v1" -or $buyer49.scenarios.Count -lt 11) {
  throw "Invalid A-Life native buyer acceptance manifest"
}
if (@($buyer49.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not claim native A-Life buyer E2E without physical receipts"
}
$files = @(
  "tests/coop-alife-native-buyer-dispatch.test.mjs",
  "tests/coop-alife-native-buyer-runtime.test.mjs",
  "tests/coop-npc-buyer-native-bindings.test.mjs",
  "tests/coop-npc-rust-order-authority.test.mjs",
  "tests/coop-npc-seller-tax-authority.test.mjs",
  "tests/coop-npc-buyer-recovery-audit.test.mjs",
  "tests/coop-npc-buyer-controlled-recovery.test.mjs",
  "tests/coop-npc-buyer-admin-control.test.mjs",
  "tests/coop-npc-market-completion-notify.test.mjs",
  "tests/coop-alife-native-buyer-wiring.test.mjs",
  "tests/coop-alife-native-overlay-compat.test.mjs",
  "tests/coop-npc-corp-buyer.test.mjs",
  "tests/coop-npc-buyer-coordinator.test.mjs",
  "tests/coop-npc-corp-buyer-real-sqlite.test.mjs",
  "tests/coop-rust-npc-corp-buy-patch.test.mjs",
  "tests/coop-npc-partial-fill-atomic.test.mjs",
  "tests/coop-npc-partial-real-sqlite.test.mjs",
  "tests/coop-rust-npc-partial-patch.test.mjs",
  "tests/coop-npc-market-policy.test.mjs",
  "tests/coop-npc-demand-authority.test.mjs",
  "tests/coop-alife-native-act.test.mjs",
  "tests/coop-alife-native-economy.test.mjs",
  "tests/coop-alife-economy-sensor.test.mjs",
  "tests/coop-alife-economy-wiring.test.mjs",
  "tests/coop-alife-station-authority.test.mjs",
  "tests/coop-alife-station-runtime.test.mjs",
  "tests/coop-alife-station-owner-isolation.test.mjs",
  "tests/coop-alife-station-wiring.test.mjs",
  "tests/coop-npc-manufacturing.test.mjs",
  "tests/coop-npc-native-economy-director.test.mjs",
  "tests/coop-alife-order-authority.test.mjs",
  "tests/coop-alife-native-intent-reconciliation.test.mjs",
  "tests/coop-alife-integration-acceptance.test.mjs",
  "tests/coop-alife-native-resupply-act.test.mjs",
  "tests/coop-alife-native-resupply-wiring.test.mjs",
  "tests/coop-npc-ammo-supply.test.mjs",
  "tests/coop-alife-native-resupply-acceptance.test.mjs"
)
if ($IncludeExistingEconomyTests) {
  $files += @(
    "tests/coop-npc-native-economy-director.test.mjs",
    "tests/coop-npc-native-bindings.test.mjs",
    "tests/coop-npc-economy-scheduler.test.mjs"
  )
}
foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $root $f))) { throw "Missing required test: $f" }
}
$node = Get-Command node -ErrorAction Stop
$log = Join-Path $ReportDir "alife-economy-node-tests.txt"
Push-Location $root
try {
  & $node.Source --test @files *> $log
  $code = $LASTEXITCODE
} finally { Pop-Location }

if ($code -ne 0) {
  Write-Host "=== NATIVE ECONOMY TEST FAILURE CONTEXT ==="
  $failures = @(Select-String -Path $log -Pattern '^not ok [0-9]+' -Context 2,25)
  if ($failures.Count -eq 0) {
    Get-Content -Path $log | Select-Object -Last 120 | ForEach-Object { Write-Host $_ }
  } else {
    foreach ($failure in $failures) {
      $failure.Context.PreContext | ForEach-Object { Write-Host $_ }
      Write-Host $failure.Line
      $failure.Context.PostContext | ForEach-Object { Write-Host $_ }
    }
  }
}
Get-Content -Path $log | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
if ($code -ne 0) { throw "A-Life economy tests failed (exit $code): $log" }
Write-Host ("PASS: local unit and contract checks. E2E scenarios remaining NOT_RUN: " + ($manifest.scenarios.Count + $integrity.scenarios.Count + $demand.scenarios.Count + $policy.scenarios.Count + $partial.scenarios.Count + $npcBuyer.scenarios.Count + $integration.scenarios.Count + $actManifest.scenarios.Count + $buyer49.scenarios.Count))
Write-Host ("Evidence checklists: " + $manifestPath + " ; " + $integrationManifestPath + " ; " + $actManifestPath)
Write-Host ("Test report: " + $log)
Write-Host "No game server, market database, Docker volume, or evejs-data was modified."
