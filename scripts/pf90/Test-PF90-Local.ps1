#Requires -Version 5.1
# PF90: local-only original owner contract and stock source audit.
# Never writes native EveJS, starts a server, changes PLAY or enables PF.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @(
  (Join-Path $repo 'scripts/pf58/tests/pf90-owner-snapshot.test.cjs'),
  (Join-Path $root 'tests/pf90-original-owners.test.cjs')
)
foreach ($test in $tests) {
  if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
    throw 'PF90_REQUIRED_ORIGINAL_OWNER_TEST_MISSING'
  }
}
$previousRoot = [Environment]::GetEnvironmentVariable('PF90_NATIVE_WORKTREE', 'Process')
try {
  if ($NativeCheckout) {
    $env:PF90_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  } else {
    [Environment]::SetEnvironmentVariable('PF90_NATIVE_WORKTREE', '', 'Process')
  }
  & $node --test --test-concurrency=1 @tests
  if ($LASTEXITCODE -ne 0) { throw 'PF90_ORIGINAL_OWNER_NODE_TESTS_FAILED' }
  & $python -m unittest discover -s (Join-Path $repo 'scripts/pf58/tests') -p 'test_pf90_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF90_SOURCE_CONTRACT_TESTS_FAILED' }
  & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf90_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF90_ARCHIVE_INTEGRITY_FAILED' }
  if ($NativeCheckout) {
    $audit = Join-Path $root 'inspect-original-owner-writes.cjs'
    $json = & $node $audit --fork-root $env:PF90_NATIVE_WORKTREE
    $exitStatus = $LASTEXITCODE
    if ($exitStatus -ne 2) { throw 'PF90_OWNER_AUDIT_EXIT_INVALID' }
    try { $report = ($json | Out-String | ConvertFrom-Json) }
    catch { throw 'PF90_OWNER_AUDIT_JSON_INVALID' }
    if ($report.status -cne 'BLOCKED_FOR_ACTIVATION' -or
        $report.releaseAuthority -ne $false -or
        @($report.ownerPaths).Count -ne 5 -or
        @($report.ownerPaths | Where-Object { $_.status -cne 'OWNER_HOOK_ABSENT' }).Count -ne 0) {
      throw 'PF90_ORIGINAL_OWNER_SOURCE_REVIEW_REQUIRED'
    }
    Write-Warning 'PF90 native owner integration remains BLOCKED_FOR_ACTIVATION (expected).'
  } else {
    Write-Warning 'PF90 original native checkout not supplied: original stock functions were NOT exercised.'
  }
} finally {
  [Environment]::SetEnvironmentVariable('PF90_NATIVE_WORKTREE', $previousRoot, 'Process')
}
Write-Host 'PF90 local candidate checks finished. Original EveJS owner hooks NOT INSTALLED; Personal Fleet OFF.'
