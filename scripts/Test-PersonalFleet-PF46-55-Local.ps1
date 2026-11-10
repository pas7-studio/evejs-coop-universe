#Requires -Version 5.1
<#
  Read-only local PF46-55 source/SQLite gate for the evejs-coop-universe PR branch.
  Does not deploy, touch WORK/PLAY, or apply patches. No GitHub CI.
  Linux SIGKILL tests skip on Windows; they MUST run under Linux for acceptance.
#>
[CmdletBinding()]
param([string]$NativeWorktree = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    $node = Get-Command node -ErrorAction Stop
    $python = Get-Command python -ErrorAction Stop
    $paths = @(
      'tests/pf46-shutdown.test.mjs',
      'tests/pf47-gamestore-adapter.test.mjs',
      'tests/pf48-native-writer-audit.test.mjs',
      'scripts/pf49/tests/pf49-native-mining-txn-guard.test.cjs',
      'scripts/pf49/tests/pf49-sqlite-durability.test.cjs',
      'scripts/pf50/tests/pf50-guard.test.cjs',
      'scripts/pf50/tests/pf50-sqlite.test.cjs',
      'scripts/pf50/tests/pf50-sqlite-sigkill.test.cjs',
      'scripts/pf51/tests/pf51-startup-fence.test.cjs',
      'scripts/pf51/tests/pf51-sqlite-sigkill.test.cjs',
      'scripts/pf51/tests/pf51-patch-smoke.test.cjs',
      'scripts/pf52/tests/pf52-hangar.test.cjs',
      'scripts/pf52/tests/pf52-sqlite-sigkill.test.cjs',
      'scripts/pf53/tests/pf53-paid-hiring.test.cjs',
      'scripts/pf53/tests/pf53-paid-hiring-sigkill.test.cjs',
      'scripts/pf54/tests/pf54-deploy.test.cjs',
      'scripts/pf54/tests/pf54-sigkill.test.cjs',
      'scripts/pf55/tests/pf55-orders.test.cjs',
      'scripts/pf55/tests/pf55-native-executor.test.cjs',
      'scripts/pf55/tests/pf55-sqlite-sigkill.test.cjs'
    )
    foreach ($p in $paths) {
      if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
        throw ('REQUIRED_TEST_SOURCE_MISSING: ' + $p)
      }
    }
    & $node.Source --test $paths
    if ($LASTEXITCODE -ne 0) { throw 'PF46_55_NODE_REGRESSION_FAILED' }
    & $python.Source scripts/pf55/tests/pf55-patch-builder.test.py
    if ($LASTEXITCODE -ne 0) { throw 'PF55_NATIVE_PATCH_REGRESSION_FAILED' }
    if ($NativeWorktree -ne '') {
      & (Join-Path $repo 'scripts/pf55/Test-PF55-Local.ps1') -NativeWorktree $NativeWorktree
    } else {
      Write-Host 'Native original fork patch applicability NOT RUN (pass -NativeWorktree).'
    }
    if ($env:OS -eq 'Windows_NT') {
      Write-Warning 'Linux SIGKILL tests SKIPPED on Windows: RUN ON LINUX before WORK acceptance.'
    }
    Write-Host 'SOURCE-LEVEL PASS ONLY. Actual EveJS 2-player native gameplay NOT RUN.'
    Write-Host 'PERSONAL FLEET OFF; PF42 EXCLUSION ACTIVE; NO PLAY DEPLOY.'
} finally { Pop-Location }