#Requires -Version 5.1
<# PF95: source-pinned ORIGINAL SQLite writer test. Works only with a
   disposable temporary copy of original source. Does not modify original,
   create a worktree, build Docker, or touch PLAY. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$NativeCheckout)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$pf95 = Join-Path $PSScriptRoot 'tests/pf95-original-game-store-epoch.test.cjs'
$pf94 = Join-Path $repo 'scripts/pf94/tests/pf94-owner-epoch-sqlite.test.cjs'
$required = @(
 (Join-Path $PSScriptRoot 'review/coopGameStoreAtomic.pf95.review-only.patch'),
 $pf95,
 (Join-Path $PSScriptRoot 'tests/test_pf95_archive_integrity.py'),
 $pf94
)
foreach ($file in $required) {
 if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
  throw 'PF95_SOURCE_PINNED_NATIVE_TEST_REQUIRED_FILE_MISSING'
 }
}
$previous = [Environment]::GetEnvironmentVariable('PF95_NATIVE_WORKTREE','Process')
try {
 $env:PF95_NATIVE_WORKTREE = $native
 & $node --test --test-concurrency=1 $pf94 $pf95
 if ($LASTEXITCODE -ne 0) { throw 'PF95_ORIGINAL_NATIVE_SQLITE_OWNER_REGRESSION_FAILED' }
 & $python -m unittest discover -s (Join-Path $PSScriptRoot 'tests') -p 'test_pf95_*.py' -v
 if ($LASTEXITCODE -ne 0) { throw 'PF95_SOURCE_ARCHIVE_INTEGRITY_FAILED' }
} finally {
 [Environment]::SetEnvironmentVariable('PF95_NATIVE_WORKTREE',$previous,'Process')
}
Write-Host 'PF95 original source-pinned temporary-copy tests complete; feature OFF, original fork unchanged.'
