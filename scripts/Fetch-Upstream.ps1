#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Root = 'C:\Games\EveCoop',
    [string]$EveJSRevision = '',
    [string]$LivingUniverseRevision = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$projects = @(
    @{ Name='upstream-evejs'; Url='https://github.com/gameboys84/EveJS.git'; Ref=$EveJSRevision },
    @{ Name='x-eve-living-universe'; Url='https://github.com/kaiwren986/evejs-living-universe.git'; Ref=$LivingUniverseRevision }
)
foreach ($p in $projects) {
    $target = Join-Path $Root $p.Name
    if (-not (Test-Path $target)) {
        & git clone -- $p.Url $target
        if ($LASTEXITCODE -ne 0) { throw "Clone failed: $($p.Url)" }
    } else {
        if (-not (Test-Path (Join-Path $target '.git'))) { throw "Refusing non-git target: $target" }
        Write-Host "Existing checkout left unchanged: $target"
    }
    if ($p.Ref) {
        & git -C $target fetch origin $p.Ref
        if ($LASTEXITCODE -ne 0) { throw "Fetch failed for $($p.Ref)" }
        & git -C $target checkout --detach $p.Ref
        if ($LASTEXITCODE -ne 0) { throw "Checkout failed for $($p.Ref)" }
    }
    $revision = (& git -C $target rev-parse HEAD)
    if ($LASTEXITCODE -ne 0) { throw "Cannot get revision: $target" }
    Write-Host ("{0} at {1}" -f $p.Name, $revision)
}
Write-Host 'No binaries or patches applied. IMPORTANT: EveJS main is not necessarily compatible with X-Eve v0.2.2.'
