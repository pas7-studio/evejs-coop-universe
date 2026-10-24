#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [string]$ExpectedSha256 = '1DEB61A51F808D9F2B330214DA64EC297D9EE5F96EE4B8265692A65F35EEFC1E'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw "Archive not found: $ArchivePath" }
if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'ExpectedSha256 must be exactly 64 hex characters.' }
$actual = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToUpperInvariant()
$expected = $ExpectedSha256.ToUpperInvariant()
Write-Host ("Archive: {0}" -f $ArchivePath)
Write-Host ("Expected: {0}" -f $expected)
Write-Host ("Actual:   {0}" -f $actual)
if ($actual -ne $expected) {
    Write-Error 'INCOMPATIBLE archive: do not apply X-Eve patch to this source.'
    exit 1
}
Write-Host '[PASS] Exact X-Eve documented baseline archive SHA-256 matched.'
Write-Host 'Hash match verifies byte identity only; it does not grant rights to use software or verify runtime compatibility.'
