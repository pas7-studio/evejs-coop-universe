#Requires -Version 5.1
# Read-only manual regression: available PF49-PF58 archived Node tests.
# Supports either Github scripts/pfXX folders or the unified review ZIP layout.
[CmdletBinding()]
param([switch]$WithPythonChecks)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$bundleNames = @{
  49='pf49-native-gate'; 50='pf50-native-haul'; 51='pf51-native-startup';
  52='pf52-native-hangar'; 53='pf53-paid-hiring'; 54='pf54-native-deploy';
  55='pf55-native-orders'; 56='pf56-return-dock'; 57='pf57-contract-life';
  58='pf58-original-native-handoff'
}
$tests = New-Object System.Collections.Generic.List[string]
$dirs = @{}
for ($i=49; $i -le 58; $i++) {
  $choices = @(
    (Join-Path $root ('pf'+$i+'/tests')),
    (Join-Path $root ($bundleNames[$i]+'/tests')),
    (Join-Path $root ('scripts/pf'+$i+'/tests'))
  )
  $dir = @($choices | Where-Object {Test-Path -LiteralPath $_ -PathType Container} | Select-Object -First 1)
  if ($dir.Count -ne 1) {throw "PF_TEST_DIR_MISSING_$i"}
  $dirs[$i] = $dir[0]
  $found = @(Get-ChildItem -LiteralPath $dir[0] -Filter '*.test.cjs' -File)
  if ($env:OS -eq 'Windows_NT') {
    $found = @($found | Where-Object {$_.Name -notmatch '(sigkill|sqlite-sigkill)'})
  }
  if ($found.Count -eq 0) {throw "PF_TEST_FILES_MISSING_$i"}
  foreach ($f in $found) {$tests.Add($f.FullName)}
}
Write-Host "Executing $($tests.Count) PF49-58 isolated test files in serial"
& $node --test '--test-concurrency=1' @($tests.ToArray())
if ($LASTEXITCODE -ne 0) {throw 'PERSONAL_FLEET_REPRODUCIBLE_NODE_TEST_FAILURE'}
if ($WithPythonChecks) {
  $python=(Get-Command python -ErrorAction Stop).Source
  & $python -m unittest discover -s $dirs[58] -p 'test_*.py' -v
  if ($LASTEXITCODE -ne 0) {throw 'PF58_NATIVE_PATCH_TEST_FAILURE'}
}
Write-Host 'PASS: isolated source/SQLite tests, original native WORK E2E NOT RUN; Personal Fleet OFF.'
