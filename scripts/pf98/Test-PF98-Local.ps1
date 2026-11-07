#Requires -Version 5.1
# PF98 native PF91/PF92 session witness bridge; Node SQLite fixture tests.
# No original repo changes, no server startup, no PLAY modifications.
[CmdletBinding()]
param([string]$NativeCheckout = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$test = Join-Path $root 'tests/pf98-native-owner-bridge.test.cjs'
if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
  throw 'PF98_NATIVE_SQLITE_BRIDGE_TEST_MISSING'
}
& $node --test --test-concurrency=1 $test
if ($LASTEXITCODE -ne 0) { throw 'PF98_NATIVE_SOURCE_WITNESS_BRIDGE_FAILED' }
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf98_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'PF98_NATIVE_SOURCE_ARCHIVE_INTEGRITY_FAILED' }
if ($NativeCheckout) {
  $native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  $original = Join-Path $root '../pf95/Test-PF95-Local.ps1'
  if (-not (Test-Path -LiteralPath $original -PathType Leaf)) {
    throw 'PF98_NATIVE_OWNER_SOURCE_PIN_TEST_MISSING'
  }
  & $original -NativeCheckout $native
  if ($LASTEXITCODE -ne 0) { throw 'PF98_ORIGINAL_NATIVE_OWNER_SOURCE_PIN_FAILED' }
} else {
  Write-Warning 'No NativeCheckout supplied: original EveJS source-pinned owner tests were not run.'
}
Write-Host 'PF98 real Node SQLite fixture contract checks complete; Personal Fleet remains OFF.'
