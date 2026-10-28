# LW-03 unified Living World 30s phase source gate (no live EveJS writes).
# This does NOT deploy, launch Docker, enable financial flags, or mark gameplay PASS.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "livingWorld" -ReportDir $ReportDir
