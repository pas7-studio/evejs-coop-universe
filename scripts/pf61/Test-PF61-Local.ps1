#Requires -Version 5.1
# Read-only isolated PF61 source check, no native patch apply, CI or Docker.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node=(Get-Command node -ErrorAction Stop).Source
$python=(Get-Command python -ErrorAction Stop).Source
& $node --test (Join-Path $root 'tests/pf61-scoped-cleanup.test.cjs')
if ($LASTEXITCODE -ne 0) {throw 'PF61_NODE_TEST_FAILURE'}
if ($env:OS -ne 'Windows_NT') {
  & $node --test (Join-Path $root 'tests/pf64-sigkill.test.cjs')
} else {Write-Warning 'PF64 SIGKILL tests require Linux/WSL; skipped on Windows.'}
if ($LASTEXITCODE -ne 0) {throw 'PF61_NODE_TEST_FAILURE'}
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) {throw 'PF61_NATIVE_PATCH_TEST_FAILURE'}
Write-Host 'PF61 ISOLATED PASS; REAL NATIVE WORK E2E NOT RUN; FEATURE OFF'
