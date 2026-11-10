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
$pf98 = Join-Path $root '../pf98/tests/pf98-native-owner-bridge.test.cjs'
if (-not (Test-Path -LiteralPath $pf98 -PathType Leaf)) { throw 'PF98_NATIVE_OWNER_WITNESS_BRIDGE_TEST_MISSING' }
$pf99Auth = Join-Path $root '../pf99/tests/pf99-authenticated-original-session.test.cjs'
$pf99Native = Join-Path $root '../pf99/tests/pf99-source-bound-pf91-pf92-sqlite.test.cjs'
foreach ($file in @($pf99Auth,$pf99Native)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw 'PF99_AUTHENTICATED_NATIVE_OWNER_TEST_MISSING'
  }
}
$pf100Proof = Join-Path $root '../pf100/tests/pf100-original-postcommit-proof.test.cjs'
if (-not (Test-Path -LiteralPath $pf100Proof -PathType Leaf)) { throw 'PF100_POSTCOMMIT_SQLITE_PROOF_TEST_MISSING' }
$allNodeTests = @($tests.FullName) + @($pf73) + @($pf86) + @($pf87) + @($pf88) + @($pf89) + @($pf90) + @($pf91) + @($pf92) + @($pf93) + @($pf94) + @($pf98) + @($pf99Auth) + @($pf99Native) + @($pf100Proof)
& $node --test '--test-concurrency=1' @allNodeTests
if ($LASTEXITCODE -ne 0) { throw 'PF58_NODE_REGRESSION_FAILED' }
$python = (Get-Command python -ErrorAction Stop).Source
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'PF58_PATCH_TESTS_FAILED' }
if ($NativeCheckout) {
  $native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  $pf95Original = Join-Path $root '../pf95/tests/pf95-original-game-store-epoch.test.cjs'
  if (-not (Test-Path -LiteralPath $pf95Original -PathType Leaf)) {
    throw 'PF95_NATIVE_TEMPORARY_OWNER_TEST_MISSING'
  }
  $oldPf95Root = [Environment]::GetEnvironmentVariable('PF95_NATIVE_WORKTREE','Process')
  try {
    $env:PF95_NATIVE_WORKTREE = $native
    & $node --test '--test-concurrency=1' $pf95Original
    if ($LASTEXITCODE -ne 0) { throw 'PF95_ORIGINAL_GAMESTORE_OWNER_WITNESS_FAILED' }
  } finally {
    [Environment]::SetEnvironmentVariable('PF95_NATIVE_WORKTREE',$oldPf95Root,'Process')
  }
  # PF97 source-pinned original character + ItemStore temp-only ownership tests.
  $pf97Character = Join-Path $root '../pf97/tests/pf97-character-writer-source.test.cjs'
  $pf97ItemStore = Join-Path $root '../pf97/tests/pf97-itemstore-source.test.cjs'
  foreach ($file in @($pf97Character,$pf97ItemStore)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw 'PF97_ORIGINAL_CHARACTER_ITEMSTORE_TEST_MISSING'
    }
  }
  $oldPf97Root = [Environment]::GetEnvironmentVariable('PF97_NATIVE_WORKTREE','Process')
  try {
    $env:PF97_NATIVE_WORKTREE = $native
    & $node --test '--test-concurrency=1' $pf97Character $pf97ItemStore
    if ($LASTEXITCODE -ne 0) { throw 'PF97_ORIGINAL_CHARACTER_ITEMSTORE_TEST_FAILED' }
  } finally {
    [Environment]::SetEnvironmentVariable('PF97_NATIVE_WORKTREE',$oldPf97Root,'Process')
  }
  # PF99: re-run source-bound authenticated session tests against exact
  # original source pins, including real sessionRegistry and charService.
  $oldPf99Root = [Environment]::GetEnvironmentVariable('PF99_NATIVE_WORKTREE','Process')
  try {
    $env:PF99_NATIVE_WORKTREE = $native
    & $node --test '--test-concurrency=1' $pf99Auth $pf99Native
    if ($LASTEXITCODE -ne 0) { throw 'PF99_ORIGINAL_SESSION_SOURCE_PINNED_GATE_FAILED' }
  } finally {
    [Environment]::SetEnvironmentVariable('PF99_NATIVE_WORKTREE',$oldPf99Root,'Process')
  }
  # PF100 must run native original six-source pins and SHA256 in WORK preflight.
  $pf100Runner = Join-Path $root '../pf100/Test-PF100-Local.ps1'
  if (-not (Test-Path -LiteralPath $pf100Runner -PathType Leaf)) { throw 'PF100_WORK_PROOF_RUNNER_MISSING' }
  & $pf100Runner -NativeCheckout $native
  if ($LASTEXITCODE -ne 0) { throw 'PF100_WORK_POSTCOMMIT_PROOF_GATE_FAILED' }
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
