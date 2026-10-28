# ALIFE-12 original native mining -> station restart regression gate.
# Never starts Docker, creates live NPCs or modifies protected evejs-data.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife12" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
