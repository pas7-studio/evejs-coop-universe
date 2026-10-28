# LW-04B source-only manufacturing admission gate.
# Must never mutate Docker, local active GameStore, Rust market or evejs-data.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04b" -ReportDir $ReportDir
