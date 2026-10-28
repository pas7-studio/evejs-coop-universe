# ALIFE-06 source/cargo conservation checks. Does not start game or Docker.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alifeMiningCycle" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
