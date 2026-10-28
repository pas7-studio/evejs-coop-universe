# Read-only ALIFE-09 full native mining -> station overlay gate.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife09" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
