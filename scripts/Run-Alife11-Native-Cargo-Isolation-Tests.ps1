# ALIFE-11 read-only mixed NPC cargo regression gate.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife11" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
