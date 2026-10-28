# LW-04C source-only crash recovery and ACT admission gate.
# Runs Node unit/regression tests. Never opens the original game database.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04c" -ReportDir $ReportDir
