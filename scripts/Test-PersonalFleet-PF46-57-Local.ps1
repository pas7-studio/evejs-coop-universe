#Requires -Version 5.1
# Read-only manual regression for all TEST FILES AVAILABLE under scripts/pf49..pf57.
# PF46-48 have no Node tests in the supplied archived bundle; their coverage is NOT inferred.
[CmdletBinding()]
param([switch]$WithPythonPatchChecks)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$tests = New-Object System.Collections.Generic.List[string]
for ($number=49; $number -le 57; $number++) {
  $folder = Join-Path $root ('pf' + $number + '/tests')
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw "MISSING_PF_TEST_DIR: $folder" }
  $group = @(Get-ChildItem -LiteralPath $folder -Filter '*.test.cjs' -File)
  if ($group.Count -eq 0) { throw "NO_PF_TESTS: $folder" }
  foreach ($file in $group) { $tests.Add($file.FullName) }
}
Write-Host "Executing $($tests.Count) Node test files in serial: PF49-PF57"
& $node --test '--test-concurrency=1' @($tests.ToArray())
if ($LASTEXITCODE -ne 0) { throw "PERSONAL_FLEET_LOCAL_NODE_REGRESSION_FAILED" }
if ($WithPythonPatchChecks) {
  $check = Join-Path $root 'pf55/tests/pf55-patch-builder.test.py'
  if (-not (Test-Path -LiteralPath $check -PathType Leaf)) { throw 'PF55_PYTHON_PATCH_TEST_MISSING' }
  $py = (Get-Command python -ErrorAction Stop).Source
  & $py $check
  if ($LASTEXITCODE -ne 0) { throw 'PERSONAL_FLEET_PYTHON_PATCH_TESTS_FAILED' }
}
Write-Host 'Local source/SQLite PASS. Original native WORK/PLAY gameplay NOT RUN, Personal Fleet remains OFF.'
