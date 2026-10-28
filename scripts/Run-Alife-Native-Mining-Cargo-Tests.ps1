# ALIFE-05 native ore cargo integrity. Read-only Node tests and optional source
# verification. Does NOT boot Docker or touch the preserved evejs-data volume.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alifeMiningCargo" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
