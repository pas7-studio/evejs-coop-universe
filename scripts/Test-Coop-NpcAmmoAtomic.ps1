# P0 isolated native NPC ammo acceptance, READ-ONLY against deployed world.
# Execute in this repository. Tests create throwaway temp directories and SQLite DBs.
[CmdletBinding()]
param(
  [string]$DisposableCodePath = ""
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $root
try {
  $versionText = (& node --version)
  if ($LASTEXITCODE -ne 0) { throw "Node.js is not available" }
  $major = [int]($versionText -replace '^v([0-9]+)\..*$', '$1')
  if ($major -lt 22) { throw "Node.js 22+ required for node:sqlite; found $versionText" }
  Write-Host "P0 native NPC ammo isolated validation with $versionText"
  $testFiles = @(
    "tests/coop-npc-strict-ammo.test.mjs",
    "tests/coop-npc-durable-ammo-debit.test.mjs",
    "tests/coop-npc-ammo-journal-audit.test.mjs",
    "tests/coop-npc-ammo-posix-crash.test.mjs",
    "tests/coop-npc-atomic-weapon-bank.test.mjs",
    "tests/coop-npc-atomic-sqlite-crash.test.mjs",
    "tests/coop-npc-atomic-sqlite-audit.test.mjs",
    "tests/coop-npc-fire-debit-source.test.mjs",
    "tests/coop-gamestore-atomic.test.mjs"
  )
  & node --test @testFiles
  if ($LASTEXITCODE -ne 0) { throw "NPC_AMMO_TARGETED_TESTS_FAILED" }
  # Only explicit disposable checkouts; NEVER patch the live upstream in this script.
  if ($DisposableCodePath -ne "") {
    if (!(Test-Path -LiteralPath $DisposableCodePath -PathType Container)) {
      throw "DisposableCodePath does not exist"
    }
    & node scripts/patch-evejs-coop.cjs --dry-run --code-path $DisposableCodePath
    if ($LASTEXITCODE -ne 0) { throw "NPC_AMMO_OVERLAY_DRY_RUN_FAILED" }
  }
  Write-Host "NPC_AMMO_TARGETED_TESTS_PASS (not a live gameplay acceptance)"
}
finally { Pop-Location }
