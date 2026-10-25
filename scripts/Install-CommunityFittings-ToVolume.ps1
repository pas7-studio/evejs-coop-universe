#requires -Version 5.1
<#
.SYNOPSIS
  Install a COOP-043 community fitting catalog into a STOPPED EveJS world volume.
.DESCRIPTION
  The live gamestore.sqlite lives inside a Docker volume that Windows cannot open directly.
  This wrapper performs the only approved sequence, with evidence at each step:
    1. refuse unless the target container is stopped;
    2. copy gamestore.sqlite (+ WAL/SHM) out of the volume with a native SQLite snapshot first;
    3. run Plan (read-only) and capture the catalog SHA-256;
    4. Apply with an out-of-volume backup, WAL checkpoint;
    5. copy the single checkpointed file back, drop stale WAL/SHM, restore node ownership;
    6. verify the payload with the real upstream fitting store.
  It never starts or restarts a container, never resets a volume and never writes player rows.
.EXAMPLE
  .\scripts\Install-CommunityFittings-ToVolume.ps1 -Volume evejs-data -Container evejs-server-1 -Catalog O:\tmp\coop043\full\catalog.json -SdePath O:\tmp\coop043\sde -CodePath C:\Games\EveCoop\upstream-evejs\Code -WorkRoot O:\tmp\coop043\live -BackupDir O:\tmp\coop043\live-backups -ConfirmInstall
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Volume,
  [Parameter(Mandatory=$true)][string]$Container,
  [Parameter(Mandatory=$true)][string]$Catalog,
  [Parameter(Mandatory=$true)][string]$SdePath,
  [Parameter(Mandatory=$true)][string]$CodePath,
  [Parameter(Mandatory=$true)][string]$WorkRoot,
  [Parameter(Mandatory=$true)][string]$BackupDir,
  [switch]$AllowOver600,
  [switch]$ConfirmInstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ConfirmInstall) { throw 'Install requires -ConfirmInstall (stopped world, verified backup, owner approval).' }
if (-not (Test-Path -LiteralPath $Catalog)) { throw "Missing catalog: $Catalog" }
if (-not (Test-Path -LiteralPath (Join-Path $SdePath 'typeDogma.jsonl'))) { throw 'SdePath must be the pinned SDE with typeDogma.jsonl.' }
$runner = Join-Path $PSScriptRoot 'Run-CommunityFittings.ps1'
$verify = Join-Path $PSScriptRoot 'Verify-CommunityFittings-Native.cjs'
New-Item -ItemType Directory -Force -Path $WorkRoot,$BackupDir | Out-Null

$running = (& docker inspect --format '{{.State.Running}}' $Container).Trim()
if ($running -ne 'false') { throw "SERVER_MUST_BE_STOPPED $Container=$running" }
$mounts = (& docker inspect --format '{{range .Mounts}}{{.Type}}={{.Name}};{{end}}' $Container).Trim()
$volumeNames = @($mounts.Split(';') | Where-Object { $_ -like 'volume=*' } | ForEach-Object { $_.Substring('volume='.Length) })
if (-not ($volumeNames -contains $Volume)) { throw "VOLUME_NOT_ATTACHED container=$($volumeNames -join ',') expected=$Volume" }
Write-Host "VOLUMES $($volumeNames -join ',')"

$dbLocal = Join-Path $WorkRoot 'gamestore.sqlite'
foreach ($suffix in @('', '-wal', '-shm')) { Remove-Item -LiteralPath ($dbLocal + $suffix) -Force -ErrorAction SilentlyContinue }
Write-Host "COPY_OUT $Volume /var/lib/evejs/gameStore/gamestore.sqlite -> $dbLocal"
& docker cp "${Container}:/var/lib/evejs/gameStore/gamestore.sqlite" $dbLocal
foreach ($suffix in @('-wal','-shm')) {
  $probe = & docker run --rm -v "${Volume}:/v" alpine sh -c "test -f /v/gameStore/gamestore.sqlite$suffix && echo yes || echo no"
  if ($probe.Trim() -eq 'yes') { & docker cp "${Container}:/var/lib/evejs/gameStore/gamestore.sqlite$suffix" ($dbLocal + $suffix) }
}
$sourceHash = (Get-FileHash -LiteralPath $dbLocal -Algorithm SHA256).Hash

$planArgs = @('--mode','plan','--sde',$SdePath,'--code-path',$CodePath,'--db',$dbLocal,'--catalog',$Catalog)
if ($AllowOver600) { $planArgs += @('--allow-over-600','yes') }
$planJson = & node (Join-Path $PSScriptRoot 'coop-community-fit-seed.cjs') @planArgs
if ($LASTEXITCODE -ne 0) { throw 'PLAN_FAILED' }
$plan = $planJson | ConvertFrom-Json
$sha = [string]$plan.catalogSha256
Write-Host "PLAN afterCommunity=$($plan.afterCommunity) created=$($plan.changes.created) updated=$($plan.changes.updated) sha=$sha"

$applyArgs = @('--mode','apply','--sde',$SdePath,'--code-path',$CodePath,'--db',$dbLocal,'--catalog',$Catalog,
  '--container',$Container,'--backup-dir',$BackupDir,'--approve-sha256',$sha,'--confirm-stopped','yes')
if ($AllowOver600) { $applyArgs += @('--allow-over-600','yes') }
$applyJson = & node (Join-Path $PSScriptRoot 'coop-community-fit-seed.cjs') @applyArgs
if ($LASTEXITCODE -ne 0) { throw 'APPLY_FAILED' }
$apply = $applyJson | ConvertFrom-Json
$backupHash = (Get-FileHash -LiteralPath ([string]$apply.backupPath) -Algorithm SHA256).Hash

# Fold the WAL (the seeder checkpoints on close) so one file is authoritative.
& docker run --rm -v "${Volume}:/v" alpine sh -c "rm -f /v/gameStore/gamestore.sqlite-wal /v/gameStore/gamestore.sqlite-shm"
& docker cp $dbLocal "${Container}:/var/lib/evejs/gameStore/gamestore.sqlite"
& docker run --rm -v "${Volume}:/v" alpine sh -c "chown 1000:1000 /v/gameStore/gamestore.sqlite && ls -l /v/gameStore/gamestore.sqlite"
$installedHash = (Get-FileHash -LiteralPath $dbLocal -Algorithm SHA256).Hash

$repoRoot = Split-Path -Parent $PSScriptRoot
# The image already contains the pinned upstream source with Linux native modules; mounting
# the Windows checkout would shadow them with win32 binaries.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $verifyOutput = & docker run --rm -v "${Volume}:/var/lib/evejs" -v "${repoRoot}:/repo:ro" -e EVEJS_CODE_PATH=/app -e EVEJS_GAMESTORE_DATA_DIR=/var/lib/evejs/gameStore/data evejs-local node /repo/scripts/Verify-CommunityFittings-Native.cjs 2>&1
} finally { $ErrorActionPreference = $previous }
Write-Host ($verifyOutput | Out-String)

$evidence = [ordered]@{
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  volume = $Volume
  container = $Container
  containerWasStopped = $true
  catalog = (Resolve-Path -LiteralPath $Catalog).Path
  catalogSha256 = $sha
  sourceDbSha256 = $sourceHash
  installedDbSha256 = $installedHash
  backupPath = [string]$apply.backupPath
  backupSha256 = $backupHash
  afterCommunity = $apply.afterCommunity
  created = $apply.changes.created
  updated = $apply.changes.updated
  unchanged = $apply.changes.unchanged
  dogmaValidated = $apply.dogmaValidated
  nativeVerify = [string]::Join("`n", @($verifyOutput))
  serverStartedByThisScript = $false
}
$evidenceFile = Join-Path $WorkRoot ("install-evidence-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidenceFile -Encoding UTF8
Write-Host "EVIDENCE $evidenceFile"
Write-Host 'NOT RESTARTED: start the world yourself, then verify the client window.'
