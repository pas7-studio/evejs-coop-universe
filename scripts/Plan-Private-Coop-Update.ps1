#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [Parameter(Mandatory=$true)][string]$BackupPath
)
# Read-only upgrade gate; does not build, deploy, restart, snapshot or install.
$ErrorActionPreference = 'Stop'
$code = (Resolve-Path -LiteralPath $CodePath -ErrorAction Stop).Path
$ExpectedUpstreamSha = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
# Never let the caller override the audited pinned upstream commit.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git required.' }
$actual = (@(& git -C $code rev-parse HEAD) | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $actual -ne $ExpectedUpstreamSha) {
  throw "Upstream pin mismatch ($actual): do not patch or reset a shared checkout. Review docs/DEVELOPMENT_DOCTRINE.md."
}
Write-Host '[PASS] Exact upstream pin confirmed.'
& (Join-Path $PSScriptRoot 'Coop-Volume-Safeguard.ps1') -Action Verify -CodePath $code -BackupPath $BackupPath
if (-not $?) { throw 'Backup verification failed.' }
& (Join-Path $PSScriptRoot 'Verify-Private-Coop.ps1') -CodePath $code
if (-not $?) { throw 'Private-host configuration gate failed.' }
& (Join-Path $PSScriptRoot 'Install-Coop-RuntimeProbe.ps1') -CodePath $code -DryRun
if (-not $?) { throw 'Pinned overlay dry-run failed.' }
Write-Host '[PLAN PASS] Native pin, offline backup checksum, private listener/auth config and overlay source dry-run passed.'
Write-Warning 'This did NOT deploy. Stop services deliberately, preserve backup, record exact commit and use the existing approved Deploy-Coop-RuntimeProbe.ps1 only after operator review. Do not reinitialize, reseed or run docker compose down -v.'
