#Requires -Version 5.1
# Manual-only PF88 contract suite; never enables the feature or changes PLAY.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$tests = @(
  (Join-Path $repo 'scripts/pf58/tests/pf88-reciprocal-writers.test.cjs'),
  (Join-Path $repo 'scripts/pf58/tests/pf88-sourcebound-gating.test.cjs'),
  (Join-Path $root 'tests/pf88-writer-source-audit.test.cjs')
)
foreach ($test in $tests) {
  if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
    throw 'PF88_REQUIRED_LOCAL_TEST_MISSING'
  }
}
& $node --test --test-concurrency=1 @tests
if ($LASTEXITCODE -ne 0) { throw 'PF88_LOCAL_NODE_TESTS_FAILED' }
Write-Host 'PF88 isolated tests PASS; native original writer hooks NOT PROVEN.'
if ($NativeCheckout) {
  $native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  $audit = Join-Path $root 'inspect-original-writer-hooks.cjs'
  & $node $audit --fork-root $native
  if ($LASTEXITCODE -ne 2) {
    throw 'PF88_NATIVE_WRITER_AUDIT_EXIT_CONTRACT_VIOLATION'
  }
  Write-Host 'PF88 BLOCKED_FOR_ACTIVATION: original native writer coverage is NOT verified.'
  exit 2
}
Write-Host 'PF88 source-only: no original native fork review requested; activation blocked.'
