#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$Note = '',
  [string]$Next = '',
  [switch]$SkipTests,
  [switch]$SkipServer,
  [switch]$SkipClient,
  [string]$ClientLogRoot = '',
  [string[]]$RedactNames = @(),
  [int]$MaxEventRows = 5000,
  [int]$ClientLogFiles = 3,
  [int]$ClientLogLines = 400
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22+ is required to publish session state.' }
$workDir = Join-Path $projectRoot 'test-results'
if (-not (Test-Path -LiteralPath $workDir)) { New-Item -ItemType Directory -Force -Path $workDir | Out-Null }

function Invoke-NodeRaw([string[]]$Arguments) {
  # Native stderr (including an inherited NODE_OPTIONS inspector banner) must not
  # abort the publisher under $ErrorActionPreference = 'Stop'.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $node.Source @Arguments 2>&1)
    $exit = $LASTEXITCODE
    $text = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ ExitCode = $exit; Text = $text }
}
function Invoke-JsonNode([string[]]$Arguments) {
  $result = Invoke-NodeRaw $Arguments
  $json = $null
  $start = $result.Text.IndexOf('{')
  $end = $result.Text.LastIndexOf('}')
  if ($start -ge 0 -and $end -gt $start) {
    $candidate = $result.Text.Substring($start, $end - $start + 1)
    try { $json = $candidate | ConvertFrom-Json } catch { $json = $null }
  }
  return [pscustomobject]@{ ExitCode = $result.ExitCode; Json = $json; Raw = $result.Text }
}

# 1. Local regression tests (compare against the recorded baseline).
$tests = $null
if (-not $SkipTests) {
  Write-Host '[STATE] Running local regression baseline...'
  $result = Invoke-JsonNode @((Join-Path $PSScriptRoot 'coop-test-baseline.cjs'))
  if ($result.Json) {
    $tests = [ordered]@{
      status = $result.Json.status
      totals = $result.Json.currentTotals
      newFailures = @($result.Json.newFailures)
    }
  } else {
    $tests = [ordered]@{ status = 'UNKNOWN'; totals = @{ files = 0; pass = 0; fail = 0; skipped = 0; crashed = 0 }; newFailures = @() }
    Write-Warning '[STATE] Could not parse test output; recording UNKNOWN.'
  }
}

# 2. Overlay drift (read-only).
$overlay = $null
$patcher = Join-Path $PSScriptRoot 'patch-evejs-coop.cjs'
if (Test-Path -LiteralPath $patcher -PathType Leaf) {
  $check = Invoke-JsonNode @($patcher, '--code-path', $CodePath, '--check')
  if ($check.Json) {
    $overlay = [ordered]@{
      status = $check.Json.status
      counts = $check.Json.counts
      problems = @($check.Json.problems | Select-Object -First 10)
    }
  } else {
    $overlay = [ordered]@{ status = 'NOT_CHECKED'; counts = @{}; problems = @() }
  }
}

# 3. Real server events from the running container (never raw rows in git).
$server = @{ rows = @(); error = 'skipped by -SkipServer' }
if (-not $SkipServer) {
  $compose = Join-Path $CodePath 'compose.yaml'
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker -or -not (Test-Path -LiteralPath $compose -PathType Leaf)) {
    $server = @{ rows = @(); error = 'docker or pinned compose.yaml unavailable' }
  } else {
    $composeArgs = @('--project-directory', $CodePath, '-f', $compose)
    $override = Join-Path $CodePath 'compose.coop-probe.yaml'
    if (Test-Path -LiteralPath $override -PathType Leaf) { $composeArgs += @('-f', $override) }
    $raw = @(& docker compose @composeArgs exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
    if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
      $server = @{ rows = @(); error = 'no /var/lib/evejs/coop-events.jsonl in the running server (BLOCKED_TELEMETRY unless the world never started)' }
    } else {
      $rows = @()
      foreach ($line in ($raw | Select-Object -Last $MaxEventRows)) {
        if (-not $line) { continue }
        try {
          $row = $line | ConvertFrom-Json
          $rows += @{ event = [string]$row.event; at = [string]($row.at) }
        } catch { }
      }
      $server = @{ rows = $rows; error = $null }
    }
  }
}

# 4. Real client logs, redacted and tail-only.
$client = @()
if (-not $SkipClient) {
  if (-not $ClientLogRoot) { $ClientLogRoot = Join-Path $env:LOCALAPPDATA 'CCP\EVE\logs\Gamelogs' }
  if (Test-Path -LiteralPath $ClientLogRoot -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $ClientLogRoot -Filter '*.txt' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First $ClientLogFiles)
    foreach ($file in $files) {
      $content = @(Get-Content -LiteralPath $file.FullName -Tail $ClientLogLines -ErrorAction SilentlyContinue)
      $client += @{
        name = $file.Name
        bytes = $file.Length
        lines = @(Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue).Count
        lines_sample = $content
      }
    }
  } else {
    Write-Host "[STATE] No EVE client logs at $ClientLogRoot (no authorized client run on this machine)."
  }
}

# 5. Gate status derived only from what was actually observed in this publish.
$gates = [ordered]@{}
if (-not $SkipServer) {
  if ($server.error) { $gates.telemetry = 'NO_EVENTS (' + $server.error + ')' }
  else { $gates.telemetry = 'events ' + @($server.rows).Count }
}
if (-not $SkipClient) {
  if (@($client).Count -gt 0) { $gates.client = 'logs ' + @($client).Count + ' file(s)' }
  else { $gates.client = 'BLOCKED_CLIENT_UNAVAILABLE (no gamelogs on this machine)' }
}

$bundle = [ordered]@{
  note = $Note
  next = $Next
  redactNames = @($RedactNames)
  tests = $tests
  overlay = $overlay
  server = $server
  client = $client
  gates = $gates
}
$bundlePath = Join-Path $workDir ('state-bundle-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$bundleJson = $bundle | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($bundlePath, $bundleJson, (New-Object System.Text.UTF8Encoding($false)))

Write-Host '[STATE] Publishing bundle for cloud sessions...'
$publishResult = Invoke-NodeRaw @((Join-Path $PSScriptRoot 'coop-state.cjs'), '--publish', '--input', $bundlePath)
Write-Host $publishResult.Text
if ($publishResult.ExitCode -ne 0) { throw 'Session state publish failed.' }
$verifyResult = Invoke-NodeRaw @((Join-Path $PSScriptRoot 'coop-state.cjs'), '--verify')
Write-Host $verifyResult.Text
if ($verifyResult.ExitCode -ne 0) {
  Write-Warning '[STATE] state/ has problems (stale rev, budget or redaction). Read the list above before trusting it.'
}
Write-Host '[STATE] Review state/NOW.md, then commit state/ with the change it describes.'
