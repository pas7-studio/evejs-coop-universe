#Requires -Version 5.1
# PF60 manual read-only local tests. No CI, Docker, native patch or gameplay activation.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
& $node --test (Join-Path $root 'tests/pf60-terminal.test.cjs') (Join-Path $root 'tests/pf60-sigkill.test.cjs')
if ($LASTEXITCODE -ne 0) {throw 'PF60_LOCAL_TESTS_FAILED'}
Write-Host 'PF60 SOURCE/SQLITE PASS; ORIGINAL NATIVE WORK E2E NOT RUN; FEATURE OFF'