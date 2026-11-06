#Requires -Version 5.1
# Manual, read-only local checks. Never edits native fork, restarts Docker,
# activates Personal Fleet or runs GitHub Actions.
[CmdletBinding()]
param(
  [string]$NativeCheckout,
  [string]$ReviewOutput
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
& $node -p 'Number(process.versions.node.split(".")[0]) >= 22 ? "PF62_NODE_OK" : process.exit(2)'
if ($LASTEXITCODE -ne 0) { throw 'PF62_NODE22_REQUIRED' }
& $node --test `
  (Join-Path $repo 'scripts/pf59/tests/pf59-removal.test.cjs') `
  (Join-Path $repo 'scripts/pf60/tests/pf60-terminal.test.cjs') `
  (Join-Path $repo 'scripts/pf61/tests/pf61-scoped-cleanup.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'PF62_REFERENCE_NODE_REGRESSION_FAILED' }
foreach ($pf in 59,61,62) {
  & $python -m unittest discover -s (Join-Path $repo ('scripts/pf'+$pf+'/tests')) -p 'test_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw ('PF62_PYTHON_REGRESSION_FAILED_'+$pf) }
}
if ([bool]$NativeCheckout -xor [bool]$ReviewOutput) {
  throw 'PF62_NATIVE_CHECKOUT_AND_REVIEW_OUTPUT_REQUIRED_TOGETHER'
}
if ($NativeCheckout) {
  & $python (Join-Path $PSScriptRoot 'build_native_review_bundle.py') `
    --engine $NativeCheckout --repo $repo --output $ReviewOutput
  if ($LASTEXITCODE -ne 0) { throw 'PF62_NATIVE_SOURCE_OR_COMPOSITION_BLOCKED' }
}
Write-Host 'PF62 local reference PASS. Real WORK, client E2E and native installation NOT RUN. Feature OFF.'
