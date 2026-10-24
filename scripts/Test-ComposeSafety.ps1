#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code')
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is missing.' }
if (-not (Test-Path (Join-Path $CodePath 'compose.yaml'))) { throw "Missing compose.yaml in $CodePath" }
Push-Location $CodePath
try {
    $argsList=@('-f','compose.yaml')
    $overlay=Join-Path $CodePath 'compose.coop-probe.yaml'
    if(Test-Path -LiteralPath $overlay -PathType Leaf){$argsList+=@('-f','compose.coop-probe.yaml')}
    $config = @(& docker compose @argsList config --format json)
    if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
    $obj = ($config -join "`n") | ConvertFrom-Json
    foreach ($name in @('init','server','market')) {
        if (-not ($obj.services.PSObject.Properties.Name -contains $name)) {
            throw "Missing required service: $name"
        }
    }
    # All published ports must be bound to the host loopback interface.
    foreach ($svc in $obj.services.PSObject.Properties) {
        foreach ($port in @($svc.Value.ports)) {
            if ($null -eq $port) { continue }
            $ip = [string]$port.host_ip
            if ($ip -ne '127.0.0.1' -and $ip -ne '::1') {
                throw ("Unsafe host publishing: service={0}, port={1}, host_ip={2}" -f $svc.Name,$port.published,$ip)
            }
        }
    }
    Write-Host '[PASS] Effective Compose configuration (including co-op overlay, if installed) contains required services and loopback-only published ports.'
    Write-Host 'This does not validate client compatibility or permit multiplayer exposure.'
} finally { Pop-Location }
