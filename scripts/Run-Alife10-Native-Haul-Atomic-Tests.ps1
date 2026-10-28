# ALIFE-10 read-only and disposable SQLite regression gate.
# The node:sqlite test creates and deletes an isolated temporary .sqlite file.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife10" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
