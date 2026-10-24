#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Root = 'C:\Games\EveCoop',
    [switch]$CheckPorts
)
$ErrorActionPreference = 'Stop'
function Write-Check([string]$Name, [bool]$Good, [string]$Details) {
    $state = if ($Good) { 'PASS' } else { 'WARN' }
    Write-Host ("[{0}] {1}: {2}" -f $state, $Name, $Details)
}
Write-Host 'EveJS Co-op Universe: local prerequisites (no client modifications)'
Write-Host ("Target workspace: {0}" -f $Root)
foreach ($tool in @('git','docker','node','npm')) {
    $command = Get-Command $tool -ErrorAction SilentlyContinue
    Write-Check $tool ([bool]$command) ($(if ($command) { $command.Source } else { 'not installed / not in PATH' }))
}
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    try {
        $osType = (& docker info --format '{{.OSType}}' 2>$null | Select-Object -First 1)
        Write-Check 'Docker engine' ($LASTEXITCODE -eq 0 -and $osType -eq 'linux') ("OSType={0} (expected linux)" -f $osType)
    } catch {
        Write-Check 'Docker engine' $false $_.Exception.Message
    }
}
if ($CheckPorts) {
    foreach ($port in @(443,5222,26000,26001,26002,40110)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        Write-Check ("port {0}" -f $port) ($listeners.Count -eq 0) ($(if ($listeners.Count) { "occupied by PID(s): " + (($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ',') } else { 'available locally' }))
    }
}
if (Test-Path $Root) {
    Write-Check 'Workspace directory' $true 'already exists'
} else {
    Write-Check 'Workspace directory' $true 'will be created by Fetch-Upstream.ps1'
}
Write-Host 'This script verifies environment only; it does not certify client rights or game compatibility.'
