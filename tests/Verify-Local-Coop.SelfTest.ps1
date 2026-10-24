#Requires -Version 7.0
# End-to-end negative tests of the verifier, designed to run in GitHub Actions
# without Docker, EveJS checkout, game client, or any external services.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $projectRoot 'scripts/Verify-Local-Coop.ps1'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('evejs-verifier-negative-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null

function Assert-FailureReport([string]$Case, [string[]]$Arguments, [string]$RequiredMessage) {
  $out = Join-Path $root $Case
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $output = & pwsh -NoProfile -NonInteractive -File $runner -EvidenceRoot $out @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) { throw "Unexpected success ($Case): $output" }
  $reports = @(Get-ChildItem -LiteralPath $out -Recurse -Filter 'report.json' -File)
  if ($reports.Count -ne 1) { throw "$Case expected one report.json; found $($reports.Count): $output" }
  $report = Get-Content -LiteralPath $reports[0].FullName -Raw | ConvertFrom-Json
  if ($report.status -ne 'FAIL') { throw "$Case report is not FAIL" }
  if (-not ($report.results | Where-Object { $_.status -eq 'FAIL' -and $_.detail -like "*$RequiredMessage*" })) {
    throw "$Case missing expected error '$RequiredMessage': $($report | ConvertTo-Json -Depth 8)"
  }
  Write-Host "[PASS] ${Case}: nonzero exit, FAIL report, expected diagnostic"
}

try {
  Assert-FailureReport 'invalid-timeout' @('-CodePath',(Join-Path $root 'no-evejs-code'),'-HealthTimeoutSeconds','10') 'HealthTimeoutSeconds must be 15..900'
  Assert-FailureReport 'missing-checkout' @('-CodePath',(Join-Path $root 'no-evejs-code')) 'Missing upstream compose.yaml'
  Write-Host '[PASS] Verifier negative regression suite'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
