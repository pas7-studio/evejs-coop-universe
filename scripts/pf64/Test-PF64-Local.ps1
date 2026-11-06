#Requires -Version 5.1
# Manual read-only regression. Does NOT touch native engine, services or PLAY.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$node=(Get-Command node -ErrorAction Stop).Source
$python=(Get-Command python -ErrorAction Stop).Source
$tests=@(
 'scripts/pf59/tests/pf59-removal.test.cjs',
 'scripts/pf60/tests/pf60-terminal.test.cjs',
 'scripts/pf61/tests/pf61-scoped-cleanup.test.cjs',
 'scripts/pf64/tests/pf64-bootstrap.test.cjs'
)
if ($env:OS -ne 'Windows_NT') {
 $tests+=@('scripts/pf60/tests/pf60-sigkill.test.cjs','scripts/pf61/tests/pf64-sigkill.test.cjs')
} else {
 Write-Warning 'Eight SIGKILL cases require Linux/WSL and are skipped on Windows.'
}
& $node --test '--test-concurrency=1' @($tests | ForEach-Object {Join-Path $root $_})
if ($LASTEXITCODE -ne 0) { throw 'PF64_NODE_REGRESSION_FAILED' }
foreach ($p in @('scripts/pf61/tests','scripts/pf62/tests')) {
 & $python -m unittest discover -s (Join-Path $root $p) -p 'test_*.py' -v
 if ($LASTEXITCODE -ne 0) {throw 'PF64_PYTHON_REGRESSION_FAILED'}
}
Write-Host 'PF64 LOCAL REGRESSION PASS; Original native WORK/PLAY E2E NOT RUN. Feature OFF.'
