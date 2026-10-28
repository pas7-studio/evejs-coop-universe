# LW-04C3 source-only Rust NPC sell listing and escrow test gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04c3" -ReportDir $ReportDir
