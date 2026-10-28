# ALIFE-08 isolated tests / pinned upstream read-only verification.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife08" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
