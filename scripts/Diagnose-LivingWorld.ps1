#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$compose = Join-Path $CodePath 'compose.yaml'
if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) {
    throw "Missing EveJS Compose definition: $compose"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI not available; cannot inspect a running native EveJS server'
}
$argsList = @('--project-directory', $CodePath, '-f', $compose)
$override = Join-Path $CodePath 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $override -PathType Leaf) {
    $argsList += @('-f', $override)
} else {
    Write-Warning "LivingCoop compose overlay is absent: $override"
}

# This script is explicitly READ ONLY. A missing event file should never
# provoke a build, restart, market reset, npm audit or manufactured event.
# Literal PowerShell here-string keeps shell environment expansion inside
# the container; print only exact nonsecret feature switches.
$readOnlyCheck = @'
echo "=== Running EveJS LivingCoop diagnostics (read-only) ==="
echo "Virtual world flag: ${EVEJS_COOP_VIRTUAL_WORLD:-UNSET}"
echo "Headless boot flag: ${EVEJS_COOP_HEADLESS_WORLD_BOOT:-UNSET}"
echo "Materialization flag: ${EVEJS_COOP_MATERIALIZE_NPCS:-UNSET}"
echo "Native mining flag: ${EVEJS_COOP_NATIVE_MINING:-UNSET}"
echo "Native mining retry flag: ${EVEJS_COOP_MINING_STARTUP_RETRY:-UNSET}"
echo "Native mining configured startup fleets: ${EVEJS_MINING_NPC_STARTUP_FLEET_COUNT:-UNSET}"
echo "Telemetry file setting: ${EVEJS_COOP_EVENTS_FILE:-UNSET}"
if [ -f /app/server/src/space/coopVirtualWorldRuntime.js ]; then
  echo "World overlay module: INSTALLED"
else
  echo "World overlay module: MISSING"
fi
if [ -f /app/server/src/space/coopRuntimeProbe.js ]; then
  echo "Telemetry overlay module: INSTALLED"
else
  echo "Telemetry overlay module: MISSING"
fi
if [ -z "${EVEJS_COOP_EVENTS_FILE:-}" ]; then
  echo "TELEMETRY_CONFIG: MISSING_PATH"
elif [ ! -f "$EVEJS_COOP_EVENTS_FILE" ]; then
  echo "TELEMETRY_FILE: MISSING"
  if [ -d /var/lib/evejs ]; then
    echo "Telemetry directory /var/lib/evejs: EXISTS"
  else
    echo "Telemetry directory /var/lib/evejs: MISSING"
  fi
else
  echo "TELEMETRY_FILE: EXISTS"
  if [ ! -r "$EVEJS_COOP_EVENTS_FILE" ]; then
    echo "TELEMETRY_FILE: UNREADABLE"
  else
    echo "Telemetry lines:"
    wc -l < "$EVEJS_COOP_EVENTS_FILE"
    echo "Headless boot requests:"
    grep -c '"event":"living-headless-boot-requested"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Headless boot system evidence:"
    grep -c '"event":"living-headless-boot-system"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Real topology events:"
    grep -c '"event":"living-world-topology"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Real activity events:"
    grep -c '"event":"living-native-activity"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Native mining startup outcomes:"
    grep -c '"event":"living-native-mining-startup-slot"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Stock mining fleet HP damage events:"
    grep -c '"event":"living-native-stock-fleet-combat"' "$EVEJS_COOP_EVENTS_FILE" || true
    echo "Observed native weapon events:"
    grep -c '"event":"living-native-weapon-event"' "$EVEJS_COOP_EVENTS_FILE" || true
  fi
fi
'@

Write-Host '[DIAGNOSE] Inspecting effective running server; no container or game-data changes will be made.'
$readOnlyCheck -split '\r?\n' | & docker compose @argsList exec -T server sh -s
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot inspect the running EveJS server container; check its state with -Action Status'
}

Write-Host '[DIAGNOSE] Recent relevant startup/telemetry warnings (redact before sharing):'
$lines = @(& docker compose @argsList logs --no-color --tail 250 server 2>&1)
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Could not read recent server logs'
} else {
    $matchesFound = @($lines | Select-String -Pattern '\[CoopVirtualWorld\]|\[CoopProbe\]|\[CoopLivingWorld\]|living-headless-boot|NATIVE_SCENE|CoopNpc|CoopMiningRetry' | Select-Object -Last 35)
    if ($matchesFound.Count -eq 0) {
        Write-Host 'No matching recent messages. This does not establish that the startup hook executed.'
    } else {
        $matchesFound | ForEach-Object { Write-Host $_.Line }
    }
}
Write-Host '[DIAGNOSE] Next: consult docs/GAMEPLAY_TESTING.md Phase 1. Missing event file = BLOCKED_TELEMETRY, not missing-client proof.'
Write-Warning 'Do not share unredacted logs or run npm audit in place of gameplay verification.'
