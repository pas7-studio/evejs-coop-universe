# ALIFE-03 read-only native warehouse/manifest and delivery handoff test gate.
# This script never starts Docker or changes any game volume.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alifeDelivery" -ReportDir $ReportDir
