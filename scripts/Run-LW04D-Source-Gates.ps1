# LW-04D source-only: exact Node tests and pinned checkout readiness.
[CmdletBinding()]
param(
 [ValidateSet("Source","NativePreflight")][string]$Mode="Source",
 [string]$Upstream="",
 [string]$RustSource=""
)
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script=Join-Path $root "scripts/lw04d-native-readiness.cjs"
$node=(Get-Command node -ErrorAction Stop).Source
Push-Location $root
try {
 if($Mode -eq "NativePreflight"){
  if([string]::IsNullOrWhiteSpace($Upstream) -or
     [string]::IsNullOrWhiteSpace($RustSource)){
   throw "LW04D_EXPLICIT_ORIGINAL_CHECKOUT_AND_RUST_PATH_REQUIRED"
  }
  & $node $script --native-preflight --upstream $Upstream --rust-source $RustSource
 } else {
  & $node $script --source
 }
 if($LASTEXITCODE -ne 0){throw "LW04D_GATE_FAILED"}
}finally{Pop-Location}
Write-Host "LW04D source readiness complete. Original SQLite/Rust transaction and two-client E2E: NOT_RUN."
