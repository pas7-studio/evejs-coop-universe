#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateCount(2,2)][string[]]$CharacterIds,
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
    [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$exporter = Join-Path $PSScriptRoot 'coop-native-snapshot.cjs'
$composePath = Join-Path $CodePath 'compose.yaml'
foreach ($tool in @('git','docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing command: $tool" }
}
if (-not (Test-Path -LiteralPath $exporter -PathType Leaf)) { throw 'Missing native SQLite read-only exporter' }
if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw 'Missing upstream EveJS Compose configuration' }
$ids=@($CharacterIds | ForEach-Object { $_.Trim() })
if (@($ids | Select-Object -Unique).Count -ne 2 -or @($ids | Where-Object { $_ -notmatch '^[1-9][0-9]*$' }).Count -gt 0) {
    throw 'Require two distinct positive numeric native character IDs'
}
$projectSha = (& git -C $root rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine project SHA' }
$upstreamSha = (& git -C (Split-Path -Parent $CodePath) rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine upstream SHA' }
$argsList = @('--project-directory',$CodePath,'-f',$composePath)
$override = Join-Path $CodePath 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $override -PathType Leaf) { $argsList += @('-f',$override) }
$containerId = (& docker compose @argsList ps -q server | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'No running native server to snapshot' }
$imageId = (& docker inspect --format '{{.Image}}' $containerId | Out-String).Trim()
$started = (& docker inspect --format '{{.State.StartedAt}}' $containerId | Out-String).Trim()
$mountJson = (& docker inspect --format '{{json .Mounts}}' $containerId | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[0-9a-f]{64}$' -or -not $started -or -not $mountJson) { throw 'Native running Docker metadata unavailable' }
$mounts = @($mountJson | ConvertFrom-Json)
$validMount = @($mounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -eq 'evejs-data' -and $_.Destination -eq '/var/lib/evejs' })
if ($validMount.Count -ne 1) { throw 'Missing actual EveJS persisted-volume mount' }
$parsedStarted = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse($started, [ref]$parsedStarted)) { throw 'Invalid running container start timestamp' }
$meta = @{projectSha=$projectSha;upstreamSha=$upstreamSha;runtime=@{
    volumeName='evejs-data';containerId=$containerId;imageId=$imageId;containerStartedAt=$started
}} | ConvertTo-Json -Depth 5 -Compress
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($meta))
# Execute the exporter via stdin; do not copy scripts or data to the live
# container. Its SQLite driver is instantiated readonly + query_only and the
# SQL transaction is read-only with rollback. No private DB leaves the host.
$source = [IO.File]::ReadAllText($exporter)
$raw = @($source | & docker compose @argsList exec -T server node - --meta-base64 $base64 --characters ($ids -join ',') 2>$null)
if ($LASTEXITCODE -ne 0 -or $raw.Count -ne 1) { throw 'Native SQLite snapshot BLOCKED. Verify database tables, two real character/ship records and installed server better-sqlite3. No data changed.' }
$json = [string]$raw[0]
try { $snapshot = $json | ConvertFrom-Json } catch { throw 'Native exporter returned invalid JSON' }
if ($snapshot.source -ne 'native-authoritative-export' -or @($snapshot.characters).Count -ne 2) { throw 'Native exporter did not return the required two-player state' }
if (-not $OutputPath) {
    $directory = Join-Path $root 'test-results'
    $OutputPath = Join-Path $directory ('native-snapshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
}
$destination = [IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$bytes = [Text.Encoding]::UTF8.GetBytes($json + [Environment]::NewLine)
$stream = New-Object IO.FileStream($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Write-Host '[NATIVE_SNAPSHOT] Read-only SQLite capture complete; exact two player IDs, ships, owned items and ISK cents recorded.'
Write-Host "[NATIVE_SNAPSHOT] Private local file: $destination"
Write-Warning 'Snapshot contains game character/item IDs and balances. Never commit it, upload it publicly, or use it as a substitute for a witnessed restart/client gameplay.'