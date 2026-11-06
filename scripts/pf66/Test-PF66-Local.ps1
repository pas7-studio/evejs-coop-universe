#Requires -Version 5.1
# Manual isolated tests only, no activation, merge, CI, or PLAY mutation.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @((Join-Path $root 'tests/pf66-dock.test.cjs'),
  (Join-Path $root 'tests/pf66-native-service.test.cjs'))
if (-not ($IsWindows -or $env:OS -eq 'Windows_NT')) {
  $tests += (Join-Path $root 'tests/pf66-sigkill.test.cjs')
} else {
  Write-Warning 'PF66 SIGKILL requires Linux/WSL; skipped on Windows.'
}
& $node --test '--test-concurrency=1' @tests
if ($LASTEXITCODE -ne 0) { throw 'PF66_NODE_FAILED' }
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'PF66_PATCH_BUILDER_FAILED' }
Write-Host 'PF66 isolated PASS. Original EveJS engine and WORK E2E NOT RUN. Personal Fleet OFF.'
