#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Plan','Backup','Verify','RestoreToNew')]
  [string]$Action = 'Plan',
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$BackupRoot = 'C:\EveCoopBackups',
  [string]$BackupPath = '',
  [string]$DestinationSuffix = '',
  [string]$UtilityImage = 'busybox:1.36',
  [string]$ExpectedUtilityImageId = '',
  [switch]$Apply
)
# Fail-closed operator tool; NEVER run a backup while source volumes are in use.
# Restore can only create distinct new volumes and cannot switch Compose/live data.
$ErrorActionPreference = 'Stop'
if ($UtilityImage -ne 'busybox:1.36') { throw 'Only the reviewed, locally cached busybox:1.36 image is permitted.' }
$code = $null
if ($Action -ne 'Verify') {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is unavailable.' }
  $code = (Resolve-Path -LiteralPath $CodePath -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath (Join-Path $code 'compose.yaml') -PathType Leaf)) { throw 'Missing upstream compose.yaml.' }
}

function Invoke-Docker([string[]]$DockerArgs) {
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) { throw ("Docker operation failed: " + ($DockerArgs[0..([Math]::Min(2,$DockerArgs.Count-1))] -join ' ')) }
}
function Assert-VolumeName([string]$Name) {
  if ($Name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$') { throw 'Unsafe Docker volume name.' }
}
function Assert-VolumeExists([string]$Name) {
  Assert-VolumeName $Name
  & docker volume inspect $Name *> $null
  if ($LASTEXITCODE -ne 0) { throw "Expected Docker volume does not exist: $Name (never auto-create a source volume)." }
}
function Assert-VolumeStopped([string]$Name) {
  $running = @(& docker ps --filter "volume=$Name" --format '{{.ID}}')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot determine running volume consumers.' }
  if (@($running | Where-Object { $_.Trim() }).Count -ne 0) {
    throw "Volume $Name is mounted by a RUNNING container. Stop its services deliberately and retry; no hot-copy."
  }
}
function Assert-UtilityImage {
  if ($ExpectedUtilityImageId -notmatch '^sha256:[0-9a-f]{64}$') {
    throw 'Explicit -ExpectedUtilityImageId sha256:<64 hex> is required for a mutable backup/restore action.'
  }
  $id = (@(& docker image inspect --format '{{.Id}}' $UtilityImage 2>$null) | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]$id -ne $ExpectedUtilityImageId) {
    throw 'Offline BusyBox image ID mismatch or absent. Pin and verify the correct image locally; no pulls.'
  }
}
function Get-RequiredVolumes {
  $composeArgs = @('-f', 'compose.yaml')
  if (Test-Path -LiteralPath 'compose.coop-probe.yaml' -PathType Leaf) {
    $composeArgs += @('-f', 'compose.coop-probe.yaml')
  }
  $lines = @(& docker compose @composeArgs config --format json)
  if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) { throw 'Cannot inspect effective Compose config.' }
  $obj = ($lines -join "`n") | ConvertFrom-Json
  if (-not $obj.services.server) { throw 'No server service in Compose.' }
  $expected = @(
    [pscustomobject]@{Target='/var/lib/evejs'; Archive='evejs-data.tar'; Required=$true},
    [pscustomobject]@{Target='/app/server/src/_secondary/image/generated'; Archive='evejs-images.tar'; Required=$false}
  )
  $found = New-Object System.Collections.Generic.List[object]
  foreach ($spec in $expected) {
    $matches = @($obj.services.server.volumes | Where-Object { $_.target -eq $spec.Target -and $_.type -eq 'volume' })
    if ($matches.Count -ne 1) {
      if ($spec.Required) { throw 'The game store must use exactly one named Docker volume.' }
      Write-Warning 'Generated images lack a named volume; backup will not include the image cache. Do not claim complete visual-state recovery.'
      continue
    }
    $name = [string]$matches[0].source
    Assert-VolumeName $name
    $found.Add([pscustomobject]@{Source=$name; Target=$spec.Target; Archive=$spec.Archive})
  }
  return $found.ToArray()
}
function Verify-Manifest([string]$Folder) {
  $manifestPath = Join-Path $Folder 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Backup manifest missing.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or @($manifest.volumes).Count -lt 1) { throw 'Unsupported/empty backup manifest.' }
  $seen = @{}
  foreach ($entry in $manifest.volumes) {
    Assert-VolumeName ([string]$entry.source)
    $archive = [string]$entry.archive
    if ($archive -notin @('evejs-data.tar','evejs-images.tar') -or $seen.ContainsKey($archive)) { throw 'Unsafe/duplicate archive in manifest.' }
    $seen[$archive] = $true
    $full = Join-Path $Folder $archive
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Backup archive missing: $archive" }
    $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Backup checksum mismatch: $archive" }
    if ((Get-Item -LiteralPath $full).Length -ne [long]$entry.bytes) { throw "Backup archive size mismatch: $archive" }
  }
  if (-not $seen.ContainsKey('evejs-data.tar')) { throw 'GameStore data archive missing.' }
  return $manifest
}

if ($code) { Push-Location $code }
try {
  if ($Action -eq 'Verify' -or $Action -eq 'RestoreToNew') {
    if (-not $BackupPath) { throw 'This action requires -BackupPath.' }
    $dir = (Resolve-Path -LiteralPath $BackupPath -ErrorAction Stop).Path
    $manifest = Verify-Manifest $dir
    Write-Host "[PASS] Verified SHA-256 and byte lengths for $(@($manifest.volumes).Count) archive(s)."
    if ($Action -eq 'Verify') { return }
    if ($DestinationSuffix -notmatch '^[a-z][a-z0-9-]{2,30}$') { throw 'Supply a unique safe -DestinationSuffix.' }
    $destinations = @()
    foreach ($entry in $manifest.volumes) {
      $newName = "$([string]$entry.source)-$DestinationSuffix"
      Assert-VolumeName $newName
      & docker volume inspect $newName *> $null
      if ($LASTEXITCODE -eq 0) { throw "Refusing to overwrite existing restore volume: $newName" }
      $destinations += [pscustomobject]@{Source=[string]$entry.source; Destination=$newName; Archive=[string]$entry.archive}
    }
    Write-Host '[PLAN] Restore targets are NEW named volumes only; running EveJS remains untouched:'
    $destinations | Format-Table -AutoSize
    if (-not $Apply) { Write-Host 'Dry run. Re-run with -Apply only after manual review.'; return }
    Assert-UtilityImage
    foreach ($entry in $destinations) {
      Invoke-Docker @('volume','create',$entry.Destination)
      $source = "type=bind,source=$dir,target=/backup,readonly"
      $dest = "type=volume,source=$($entry.Destination),target=/restore"
      Invoke-Docker @('run','--rm','--pull','never','--network','none','--read-only',
        '--mount',$source,'--mount',$dest,$UtilityImage,'tar','-C','/restore','-xf',"/backup/$($entry.Archive)")
      Write-Host ("[RESTORED] New isolated volume: {0}" -f $entry.Destination)
    }
    Write-Warning 'Restore completed into new volumes. No Compose mapping was changed. Test the restored volumes in an isolated disposable deployment before any manual cutover.'
    return
  }
  $volumes = @(Get-RequiredVolumes)
  foreach ($vol in $volumes) { Assert-VolumeExists $vol.Source; Assert-VolumeStopped $vol.Source }
  Write-Host '[PASS] Source volumes exist and have NO running container consumers.'
  $volumes | Format-Table -AutoSize
  if ($Action -eq 'Plan' -or -not $Apply) {
    Write-Host '[PLAN] Quiesced consistent volume snapshot only, no hot-copy or live Docker modifications.'
    Write-Host 'Back up bind-mounted server certificates / local config separately into encrypted offline storage; never commit them.'
    Write-Host 'To create archives explicitly: -Action Backup -Apply -BackupRoot <external backup directory>'
    return
  }
  Assert-UtilityImage
  if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
    throw 'BackupRoot must exist. Create a restricted, preferably encrypted, external directory manually.'
  }
  $stamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
  $dir = Join-Path $BackupRoot ("evejs-coop-$stamp")
  if (Test-Path -LiteralPath $dir) { throw 'Backup folder already exists.' }
  New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
  $records = @()
  try {
    foreach ($entry in $volumes) {
      $source = "type=volume,source=$($entry.Source),target=/source,readonly"
      $dest = "type=bind,source=$dir,target=/backup"
      Invoke-Docker @('run','--rm','--pull','never','--network','none','--read-only',
        '--mount',$source,'--mount',$dest,$UtilityImage,'tar','-C','/source','-cf',"/backup/$($entry.Archive)",'.')
      $file = Join-Path $dir $entry.Archive
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Archive not produced: $($entry.Archive)" }
      $records += [ordered]@{source=$entry.Source; target=$entry.Target; archive=$entry.Archive;
        sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();
        bytes=(Get-Item -LiteralPath $file).Length}
    }
    $manifest = [ordered]@{schemaVersion=1; createdUtc=(Get-Date).ToUniversalTime().ToString('o');
      consistentStoppedSnapshot=$true; volumes=$records}
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dir 'manifest.json') -Encoding UTF8
    $null = Verify-Manifest $dir
    Write-Host ("[BACKUP PASS] All archives verified at {0}" -f $dir)
  } catch {
    Write-Warning "Incomplete backup directory remains quarantined for inspection: $dir"
    throw
  }
} finally {
  if ($code) { Pop-Location }
}
