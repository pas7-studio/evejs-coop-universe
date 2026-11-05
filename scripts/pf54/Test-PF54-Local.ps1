#Requires -Version 5.1
<# PF54 local source and synthetic SQLite regression. No native writes. #>
param([switch]$WithFullRegression)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  $sums = Join-Path $root 'SHA256SUMS.txt'
  if (-not (Test-Path $sums)) { throw 'PF54_SHA256_MANIFEST_MISSING' }
  foreach ($line in Get-Content $sums) {
    if ($line -match '^([0-9a-f]{64})  (.+)$') {
      $want = $Matches[1]; $name = $Matches[2]; $target = Join-Path $root $name
      if (-not (Test-Path $target)) { throw "PF54_FILE_MISSING: $name" }
      $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
      if ($got -ne $want) { throw "PF54_FILE_HASH_MISMATCH: $name" }
    }
  }
  & node --test 'tests/pf54-deploy.test.cjs' 'tests/pf54-sigkill.test.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'PF54_NODE_TESTS_FAILED' }
  if ($WithFullRegression) {
    Write-Host 'PF54 previous PF46-53 bundle is separate; no native or combined test was invoked by this command.'
  }
  Write-Host 'PF54_LOCAL_PASS__NATIVE_WORK_NOT_RUN__PERSONAL_FLEET_OFF'
} finally { Pop-Location }