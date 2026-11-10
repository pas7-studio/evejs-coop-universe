#Requires -Version 5.1
# PF59 is read-only by default: NO native source mutation, CI, Docker or game restart.
[CmdletBinding()]
param([string]$NativeCheckout)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
& $node --test (Join-Path $root 'tests/pf59-removal.test.cjs')
if ($LASTEXITCODE -ne 0) {throw 'PF59_NODE_TEST_FAILED'}
& $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) {throw 'PF59_PYTHON_TEST_FAILED'}
if ($NativeCheckout) {
  if (-not (Test-Path -LiteralPath $NativeCheckout -PathType Container)) {
    throw 'PF59_NATIVE_CHECKOUT_NOT_FOUND'
  }
  $scratch = Join-Path ([IO.Path]::GetTempPath()) ('PF59-' + [Guid]::NewGuid().ToString('N') + '.patch')
  try {
    & $python (Join-Path $root 'build_native_removal_patch.py') $NativeCheckout --output $scratch
    if ($LASTEXITCODE -ne 0) {throw 'PF59_NATIVE_SOURCE_DRIFT'}
    $git = (Get-Command git -ErrorAction Stop).Source
    & $git -C $NativeCheckout apply --check $scratch
    if ($LASTEXITCODE -ne 0) {throw 'PF59_NATIVE_APPLY_CHECK_FAILED'}
  } finally {Remove-Item -LiteralPath $scratch -Force -ErrorAction SilentlyContinue}
}
Write-Host 'PF59 LOCAL PASS. Native WORK / two-client E2E NOT RUN. Personal Fleet OFF.'
