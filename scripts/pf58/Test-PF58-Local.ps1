#Requires -Version 5.1
# No mutation of original EveJS. SIGKILL tests are Linux-only.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$tests = @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter 'pf58-*.test.cjs' -File)
if ($tests.Count -ne 5) { throw 'PF58_EXPECTED_FIVE_NODE_TEST_FILES' }
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
  Write-Warning 'SIGKILL needs Linux/WSL. Skipping pf58-sqlite-sigkill.test.cjs.'
  $tests = @($tests | Where-Object {$_.Name -ne 'pf58-sqlite-sigkill.test.cjs'})
}
$pf73 = Join-Path $root 'tests/pf73-docking-restart-permit.test.cjs'
if (-not (Test-Path -LiteralPath $pf73 -PathType Leaf)) { throw 'PF73_DOCK_RESTART_TEST_MISSING' }
$pf86 = Join-Path $root 'tests/pf86-presence-and-prewrite.test.cjs'
if (-not (Test-Path -LiteralPath $pf86 -PathType Leaf)) { throw 'PF86_PRESENCE_GATE_MISSING' }
$pf87 = Join-Path $root 'tests/pf87-atomic-handoff.test.cjs'
if (-not (Test-Path -LiteralPath $pf87 -PathType Leaf)) { throw 'PF87_ATOMIC_HANDOFF_TEST_MISSING' }
$pf88 = @( 'pf88-reciprocal-writers.test.cjs', 'pf88-sourcebound-gating.test.cjs' ) | ForEach-Object {
  $path = Join-Path $root ('tests/' + $_)
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'PF88_RECIPROCAL_WRITER_TEST_MISSING' }
  $path
}
$pf89 = Join-Path $root 'tests/pf89-actual-item-delta.test.cjs'
if (-not (Test-Path -LiteralPath $pf89 -PathType Leaf)) { throw 'PF89_ORIGINAL_ITEMS_DELTA_TEST_MISSING' }
$pf90 = Join-Path $root 'tests/pf90-owner-snapshot.test.cjs'
if (-not (Test-Path -LiteralPath $pf90 -PathType Leaf)) { throw 'PF90_ORIGINAL_OWNER_SNAPSHOT_TEST_MISSING' }
$pf91 = Join-Path $root 'tests/pf91-original-character-rows.test.cjs'
if (-not (Test-Path -LiteralPath $pf91 -PathType Leaf)) { throw 'PF91_ORIGINAL_CHARACTER_ROWS_TEST_MISSING' }
$pf92 = Join-Path $root 'tests/pf92-character-record-barrier.test.cjs'
if (-not (Test-Path -LiteralPath $pf92 -PathType Leaf)) { throw 'PF92_GENERIC_CHARACTER_OWNER_TEST_MISSING' }
$pf93 = Join-Path $root 'tests/pf93-native-session-tx-isolation.test.cjs'
if (-not (Test-Path -LiteralPath $pf93 -PathType Leaf)) { throw 'PF93_SQLITE_SESSION_WITNESS_TEST_MISSING' }
$pf94 = Join-Path $root '../pf94/tests/pf94-owner-epoch-sqlite.test.cjs'
if (-not (Test-Path -LiteralPath $pf94 -PathType Leaf)) { throw 'PF94_NATIVE_OWNER_SQLITE_TEST_MISSING' }
$allNodeTests = @($tests.FullName) + @($pf73) + @($pf86) + @($pf87) + @($pf88) + @($pf89) + @($pf90) + @($pf91) + @($pf92) + @($pf93) + @($pf94)
& $node --test '--test-concurrency=1' @allNodeTests
if ($LASTEXITCODE -ne 0) { throw 'PF58_NODE_REGRESSION_FAILED' }
$python = (Get-Command python -ErrorAction Stop).Source
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'PF58_PATCH_TESTS_FAILED' }
if ($NativeCheckout) {
  $native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  $patch = Join-Path ([System.IO.Path]::GetTempPath()) 'pf58-native-stock-fittings-review.patch'
  & $python (Join-Path $root 'build_native_stock_fittings_patch.py') $native --output $patch
  if ($LASTEXITCODE -ne 0) { throw 'PF58_NATIVE_SOURCE_PIN_FAILED' }
  $git = (Get-Command git -ErrorAction Stop).Source
  & $git -C $native apply --check $patch
  if ($LASTEXITCODE -ne 0) { throw 'PF58_GIT_APPLY_CHECK_FAILED' }
  Write-Host "Review-only patch at $patch (NOT applied)"
  $pf86SourceTest = Join-Path $root 'tests/pf86-original-source-pins.test.cjs'
  if (-not (Test-Path -LiteralPath $pf86SourceTest -PathType Leaf)) { throw 'PF86_ORIGINAL_PROVIDER_TEST_MISSING' }
  $oldPf86NativeRoot = [Environment]::GetEnvironmentVariable('PF86_NATIVE_WORKTREE', 'Process')
  try {
    $env:PF86_NATIVE_WORKTREE = $native
    & $node --test '--test-concurrency=1' $pf86SourceTest
    if ($LASTEXITCODE -ne 0) { throw 'PF86_ORIGINAL_PROVIDER_SOURCE_DRIFT' }
  } finally {
    [Environment]::SetEnvironmentVariable('PF86_NATIVE_WORKTREE', $oldPf86NativeRoot, 'Process')
  }
}
Write-Host 'PF58 local PASS. Original WORK server and PLAY NOT RUN; feature remains OFF.'
