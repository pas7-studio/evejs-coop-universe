#requires -Version 5.1
<#
.SYNOPSIS
  Collect public community fitting data and safely plan/stage native EveJS installation.
.DESCRIPTION
  Collect NEVER changes the game DB. Plan is read-only. Apply is explicit, requires stopped
  Docker server, a catalog SHA-256 from Plan and an out-of-volume SQLite backup.
  By default Collect covers all published hulls in the supplied pinned EveJS SDE.
.EXAMPLE
  .\scripts\Run-CommunityFittings.ps1 -Action Collect -SdePath 'O:\EveSDE' -OutputRoot 'O:\tmp\coop043' -Ships 'Venture,Merlin,Heron,Caracal'
.EXAMPLE
  .\scripts\Run-CommunityFittings.ps1 -Action Plan -SdePath 'O:\EveSDE' -OutputRoot 'O:\tmp\coop043' -CodePath 'C:\Games\EveCoop\upstream-evejs\Code' -DbPath 'O:\evejs-staging\gamestore.sqlite'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Collect','Plan','Apply')][string]$Action,
  [Parameter(Mandatory=$true)][string]$SdePath,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [string]$Ships = '',
  [string]$Manifest = '',
  [int]$PerHull = 5,
  [int]$WorkbenchPages = 120,
  [int]$FieldPages = 3,
  [int]$MaxFits = 2000,
  [int]$Concurrency = 3,
  [int]$Spacing = 150,
  [string]$CodePath = '',
  [string]$DbPath = '',
  [string]$Container = 'evejs-local',
  [string]$BackupDir = '',
  [string]$CatalogSha256 = '',
  [switch]$ExperimentalLargeCatalog,
  [switch]$ConfirmApply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PerHull -lt 3 -or $PerHull -gt 5) { throw 'PerHull must be 3..5.' }
if ($FieldPages -lt 0 -or $FieldPages -gt 6) { throw 'FieldPages must be 0..6 (0 = public killmail fallback disabled).' }
if ($MaxFits -lt 100 -or $MaxFits -gt 10000) { throw 'MaxFits must be 100..10000.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdePath 'types.jsonl')) -or -not (Test-Path -LiteralPath (Join-Path $SdePath 'groups.jsonl'))) {
  throw 'SDE root must contain types.jsonl and groups.jsonl from the PINNED EveJS game data. Locate the real SDE snapshot; do not substitute a live EVE SDE.'
}
$Tools = $PSScriptRoot
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (-not (Test-Path -LiteralPath $OutputRoot)) { New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null }
$Catalog = Join-Path $OutputRoot 'catalog.json'
function Invoke-Node([string[]] $Arguments) {
  # Node writes progress/warnings to stderr; with $ErrorActionPreference='Stop' that used to
  # abort a long Collect run even though node was healthy. Merge both streams and only the
  # exit code decides success.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & node @Arguments 2>&1 | ForEach-Object { Write-Host $_ } }
  finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { throw "Node command failed with exit code $LASTEXITCODE; arguments: $($Arguments -join ' ')" }
}
if ($Action -eq 'Collect') {
  # Strict tests first; do not touch a real game database.
  Invoke-Node -Arguments @('--test',(Join-Path $Tools '..\tests\coop-community-fittings.test.mjs'),(Join-Path $Tools '..\tests\coop-community-fitting-pipeline.test.mjs'),(Join-Path $Tools '..\tests\coop-community-fit-dogma.test.mjs'))
  $wb = Join-Path $OutputRoot 'workbench.json'
  $wbArgs = @((Join-Path $Tools 'coop-community-fit-workbench.cjs'), '--sde', $SdePath, '--out', $wb,
    '--cache',(Join-Path $OutputRoot 'cache-workbench'),'--pages',[string]$WorkbenchPages,'--per-hull',[string]$PerHull,
    '--max-fits',[string]$MaxFits,'--concurrency',[string]$Concurrency,'--spacing',[string]$Spacing)
  if ($Ships) { $wbArgs += @('--ships', $Ships) }
  $inputs = @()
  $need = @()
  $workbenchSucceeded = $false
  try {
    Invoke-Node -Arguments $wbArgs
    $first = Get-Content -Raw -LiteralPath $wb | ConvertFrom-Json
    $need = @($first.coverage | Where-Object { $_.variants -lt 3 -and $_.fittable -ne $false } | ForEach-Object { $_.shipName })
    $inputs += $wb
    $workbenchSucceeded = $true
  } catch {
    Write-Warning "EVE Workbench API unavailable or changed; proceeding using public killmail fallback. $($_.Exception.Message)"
  }
  if (((-not $workbenchSucceeded) -or $need.Count -gt 0) -and $FieldPages -gt 0) {
    $field = Join-Path $OutputRoot 'field.json'
    $fieldArgs = @((Join-Path $Tools 'coop-community-fit-harvest.cjs'),'--sde',$SdePath,'--out',$field,
      '--cache',(Join-Path $OutputRoot 'cache-field'),'--per-hull',[string]$PerHull,
      '--pages',[string]$FieldPages)
    if ($workbenchSucceeded) {
      if ($need.Count -gt 0) { $fieldArgs += @('--ships',($need -join ',')) }
    } elseif ($Ships) { $fieldArgs += @('--ships',$Ships) }
    Invoke-Node -Arguments $fieldArgs
    $inputs += $field
  }
  if ($Manifest) {
    $eft = Join-Path $OutputRoot 'curated-eft.json'
    Invoke-Node -Arguments @((Join-Path $Tools 'coop-community-fit-eft.cjs'),'--sde',$SdePath,'--manifest',$Manifest,
      '--out',$eft,'--per-hull',[string]$PerHull)
    $inputs += $eft
  }
  Invoke-Node -Arguments (@((Join-Path $Tools 'coop-community-fit-merge.cjs'),'--sde',$SdePath,'--out',$Catalog,
      '--per-hull',[string]$PerHull) + $inputs)
  $result = Get-Content -Raw -LiteralPath $Catalog | ConvertFrom-Json
  if ([int]$result.summary.fits -eq 0) { throw 'NO_FITS_COLLECTED: both sources returned nothing. Do not seed an empty catalog; inspect API failures and caches.' }
  $covered = @($result.coverage | Where-Object { $_.variants -ge 3 -and $_.fittable -ne $false }).Count
  $withFive = @($result.coverage | Where-Object { $_.variants -ge 5 -and $_.fittable -ne $false }).Count
  $sourceCounts = @{}
  foreach ($fit in $result.records) {
    $key = [string]$fit.provenance.kind
    if (-not $sourceCounts.ContainsKey($key)) { $sourceCounts[$key] = 0 }
    $sourceCounts[$key]++
  }
  $roleCounts = @{}
  foreach ($fit in $result.records) {
    $key = if ($fit.role) { [string]$fit.role } else { 'unknown' }
    if (-not $roleCounts.ContainsKey($key)) { $roleCounts[$key] = 0 }
    $roleCounts[$key]++
  }
  $invalidList = @()
  if ($result.PSObject.Properties.Name -contains 'invalid') { $invalidList = @($result.invalid) }
  $rejectedList = @()
  if ($result.PSObject.Properties.Name -contains 'rejected') { $rejectedList = @($result.rejected) }
  $reasonCounts = @{}
  foreach ($rej in @($invalidList + $rejectedList)) {
    if (-not $rej) { continue }
    $key = [string]$rej.reason
    if (-not $key) { continue }
    if (-not $reasonCounts.ContainsKey($key)) { $reasonCounts[$key] = 0 }
    $reasonCounts[$key]++
  }
  $rejectedTotal = $invalidList.Count + $rejectedList.Count
  # Rejections that happened while reading the public sources (already-fetched candidates
  # that failed EFT parsing or pinned-SDE dogma) are part of the honest coverage story.
  $sourceRejections = [ordered]@{}
  $sourceRejectedTotal = 0
  foreach ($file in @('workbench.json','field.json')) {
    $path = Join-Path $OutputRoot $file
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $input = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    if (-not ($input.PSObject.Properties.Name -contains 'importFailures')) { continue }
    foreach ($failure in @($input.importFailures)) {
      $code = ([string]$failure.reason).Split(' ')[0]
      if (-not $code) { $code = 'UNKNOWN' }
      if (-not $sourceRejections.Contains($code)) { $sourceRejections[$code] = 0 }
      $sourceRejections[$code]++
      $sourceRejectedTotal++
    }
  }
  $dogmaValidated = $false
  if ($result.summary.PSObject.Properties.Name -contains 'dogmaValidated') { $dogmaValidated = [bool]$result.summary.dogmaValidated }
  $dogmaChecked = 0
  if ($result.summary.PSObject.Properties.Name -contains 'dogmaChecked') { $dogmaChecked = [int]$result.summary.dogmaChecked }
  $missing = @($result.coverage | Where-Object { $_.variants -lt 3 -and $_.fittable -ne $false } | Select-Object shipTypeID,shipName,variants,target,available,reason,roles,slots)
  $notFittable = @($result.coverage | Where-Object { $_.fittable -eq $false } | Select-Object shipTypeID,shipName,slots)
  $hullsWithAny = @($result.coverage | Where-Object { $_.variants -ge 1 }).Count
  $report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    source = 'Published EVE Workbench; public killmails; explicitly permissioned EFT'
    sdePin = $result.sdePin
    catalog = $Catalog
    shipsTotal = $result.summary.hulls
    shipsFittable = $result.summary.fittableHulls
    shipsNotFittable = $result.summary.notFittableHulls
    shipsWithAtLeastOneFit = $hullsWithAny
    shipsWithoutFit = $result.summary.fittableHulls - $hullsWithAny
    fittingsTotal = $result.summary.fits
    atLeastThree = $covered
    atLeastFive = $withFive
    fewerThanThree = $missing.Count
    bySource = $sourceCounts
    byRole = $roleCounts
    rejectedTotal = $rejectedTotal
    rejectedReasons = $reasonCounts
    sourceRejectedTotal = $sourceRejectedTotal
    sourceRejectionReasons = $sourceRejections
    missing = $missing
    notFittableHulls = $notFittable
    dogmaValidated = $dogmaValidated
    dogmaCheckedRecords = $dogmaChecked
    nativeClientValidated = $false
    clientNotes = 'Coverage is server-side only until a real client browses and saves these fittings.'
  }
  $reportFile = Join-Path $OutputRoot 'coverage-report.json'
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Host "COLLECTED: $($result.summary.fits) valid unique fits, $covered hulls with >=3, $withFive hulls with 5. Uncovered hulls: $($missing.Count)."
  Write-Host "CATALOG: $Catalog"
  Write-Host "REPORT: $reportFile"
  Write-Warning 'No server data changed; actual native fitting eligibility and 600+ client rendering still require a staging acceptance test.'
  return
}
if (-not (Test-Path -LiteralPath $Catalog)) { throw "Collect first; missing $Catalog" }
if (-not $CodePath -or -not $DbPath) { throw 'Plan and Apply require explicit -CodePath and -DbPath. Never guess the game volume path.' }
$seed = Join-Path $Tools 'coop-community-fit-seed.cjs'
$opts = @($seed,'--mode',$Action.ToLowerInvariant(),'--sde',$SdePath,'--code-path',$CodePath,'--db',$DbPath,'--catalog',$Catalog)
if ($ExperimentalLargeCatalog) { $opts += @('--allow-over-600','yes') }
if ($Action -eq 'Apply') {
  if (-not $ConfirmApply) { throw 'Apply requires explicit -ConfirmApply and human approval after staging Plan.' }
  if ($CatalogSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Apply requires -CatalogSha256 from the preceding Plan.' }
  if (-not $BackupDir) { throw 'Apply requires -BackupDir outside the game data volume.' }
  $opts += @('--container',$Container,'--backup-dir',$BackupDir,'--approve-sha256',$CatalogSha256.ToLowerInvariant(),'--confirm-stopped','yes')
}
Invoke-Node -Arguments $opts