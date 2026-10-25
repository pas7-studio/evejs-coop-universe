#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
    [string]$OutputRoot = '',
    [string]$Before = '',
    [string]$After = '',
    [string]$GiftBefore = '',
    [string]$GiftAfter = '',
    [string]$Ledger = '',
    [string]$Client = '',
    [ValidateRange(1,1440)][int]$WindowMinutes = 30
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $root 'test-results' }
$composePath = Join-Path $CodePath 'compose.yaml'
if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw "Missing upstream compose.yaml: $composePath" }
foreach ($tool in @('docker','node','git')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required executable not found: $tool" }
}
$nodeVersion = (& node -p 'process.versions.node.split(".")[0]').Trim()
if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion -lt 22) { throw 'Node 22+ required' }
$upstreamRoot = Split-Path -Parent $CodePath
$projectSha = (& git -C $root rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify project commit' }
$upstreamSha = (& git -C $upstreamRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify pinned upstream commit' }
$composeArgs = @('--project-directory',$CodePath,'-f',$composePath)
$override = Join-Path $CodePath 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $override -PathType Leaf) { $composeArgs += @('-f',$override) }
$containerID = (& docker compose @composeArgs ps -q server | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $containerID) { throw 'Running server unavailable; no gameplay proof' }
$imageId = (& docker inspect --format '{{.Image}}' $containerID | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Cannot identify exact running image' }
$containerStartedAt = (& docker inspect --format '{{.State.StartedAt}}' $containerID | Out-String).Trim()
$parsedStartedAt = [DateTimeOffset]::MinValue
if ($LASTEXITCODE -ne 0 -or -not [DateTimeOffset]::TryParse($containerStartedAt, [ref]$parsedStartedAt)) {
    throw 'Cannot identify real Docker container start time'
}
# The native upstream server mounts this exact named Docker volume. Verify it
# from the actual running container, not from an untrusted fixture or YAML text.
$mountJson = (& docker inspect --format '{{json .Mounts}}' $containerID | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $mountJson) { throw 'Cannot inspect actual persistent Docker mounts' }
$mounts = @($mountJson | ConvertFrom-Json)
$gameVolumes = @($mounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -eq 'evejs-data' -and $_.Destination -eq '/var/lib/evejs' })
if ($gameVolumes.Count -ne 1) { throw 'BLOCKED_PERSISTENCE_VOLUME: running server does not mount evejs-data at /var/lib/evejs' }
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path $OutputRoot "coop-reliability-$timestamp.json"
$metaPath = Join-Path ([IO.Path]::GetTempPath()) "evejs-reliability-meta-$([Guid]::NewGuid().ToString('N')).json"
try {
    $metaText = @{projectSha=$projectSha;upstreamSha=$upstreamSha;imageId=$imageId;containerStartedAt=$containerStartedAt} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($metaPath, $metaText, (New-Object System.Text.UTF8Encoding($false)))
    $args = @((Join-Path $PSScriptRoot 'coop-reliability-gates.cjs'),'--events','-','--meta',$metaPath,'--window-minutes',"$WindowMinutes",'--out',$report)
    $evidenceFiles = @{'--before'=$Before;'--after'=$After;'--gift-before'=$GiftBefore;'--gift-after'=$GiftAfter;'--ledger'=$Ledger;'--client'=$Client}
    foreach ($key in $evidenceFiles.Keys) {
        $value = $evidenceFiles[$key]
        if ($value) {
            if (-not (Test-Path -LiteralPath $value -PathType Leaf)) { throw "Evidence file not found for $key" }
            $args += @($key,$value)
        }
    }
    # Read-only: no redeploy, restart, login, export of confidential DB or network change.
    # Limit collection, keep raw JSONL in-memory, and store only a summarized report.
    # Include the most recent REAL boot event even if the busy world's
    # 10k-line activity tail no longer contains it. Provenance is still
    # checked against the actual container start by the Node gate.
    # Always retain the last real boot request independently of bounded scene
    # anchors and the busy-world event tail, even after many hours of uptime.
    # All output is still read-only native telemetry. Old activity never
    # substitutes for fresh samples in coop-reliability-gates.cjs.
    $readEvents = 'f="${EVEJS_COOP_EVENTS_FILE:-/var/lib/evejs/coop-events.jsonl}"; [ -r "$f" ] || exit 12; grep -F ''"event":"living-headless-boot-requested"'' "$f" | tail -n 1; grep -E ''"event":"(living-headless-boot-system|living-world-topology|living-native-industry|virtual-world-materialization|living-native-durable-recovery|living-native-system-site-readiness|living-native-mining-startup-slot)"'' "$f" | tail -n 300; tail -n 10000 "$f"'
    $events = @(& docker compose @composeArgs exec -T server sh -c $readEvents 2>$null)
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'BLOCKED_TELEMETRY: events absent or unreadable. Run Local-Two-Client-Test.ps1 -Action DiagnoseWorld.'
        $events = @()
    }
    $events | & node @args
    $exitCode = $LASTEXITCODE
    if (Test-Path -LiteralPath $report -PathType Leaf) {
        Get-Content -LiteralPath $report -Encoding UTF8
        Write-Host "[RELIABILITY] Summary report: $report"
    }
    if ($exitCode -ne 0) {
        Write-Warning 'Reliability gates BLOCKED/FAIL. Backend/TCP PASS is not a gameplay PASS.'
        exit 2
    }
    Write-Host '[RELIABILITY] Evidence-backed checks passed; client evidence is operator-attested, not automated visual proof.'
} finally {
    Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
}