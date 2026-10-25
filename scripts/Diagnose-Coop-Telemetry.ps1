#Requires -Version 5.1
# Read-only diagnosis of the RUNNING EveJS process, not the local Compose YAML.
[CmdletBinding()]
param([string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $CodePath 'compose.yaml'
if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw "Missing compose.yaml: $compose" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI missing' }
$opts = @('--project-directory',$CodePath,'-f',$compose)
$override = Join-Path $CodePath 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $override -PathType Leaf) { $opts += @('-f',$override) }
$id = (& docker compose @opts ps -q server | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $id) { throw 'BLOCKED_SERVER: running server container unavailable' }
$start = (& docker inspect --format '{{.State.StartedAt}}' $id | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the running process start timestamp' }
Write-Host "[COOP-TELEMETRY] Server process started at $start"
$check = @'
set -u
world=/app/server/src/space/coopVirtualWorldRuntime.js
probe=/app/server/src/space/coopRuntimeProbe.js
hook=/app/server/src/network/tcp/index.js
if [ "${EVEJS_COOP_VIRTUAL_WORLD:-}" = 1 ]; then echo "CONFIG_VIRTUAL_WORLD: ENABLED"; else echo "CONFIG_VIRTUAL_WORLD: DISABLED"; fi
if [ "${EVEJS_COOP_HEADLESS_WORLD_BOOT:-}" = 1 ]; then echo "CONFIG_HEADLESS_BOOT: ENABLED"; else echo "CONFIG_HEADLESS_BOOT: DISABLED"; fi
if [ "${EVEJS_COOP_EVENTS_FILE:-}" = /var/lib/evejs/coop-events.jsonl ]; then echo "CONFIG_EVENTS_PATH: EXPECTED"; else echo "CONFIG_EVENTS_PATH: MISSING_OR_DIFFERENT"; fi
if [ -f "$world" ]; then echo "OVERLAY_WORLD: PRESENT"; else echo "OVERLAY_WORLD: MISSING"; fi
if [ -f "$probe" ]; then echo "OVERLAY_PROBE: PRESENT"; else echo "OVERLAY_PROBE: MISSING"; fi
if [ -f "$hook" ] && grep -Fq 'coopVirtualWorldRuntime' "$hook"; then echo "START_HOOK: PRESENT_IN_INSTALLED_CODE"; else echo "START_HOOK: ABSENT"; fi
if [ -f "$probe" ] && grep -Fq 'living-startup-entered' "$world" 2>/dev/null; then echo "BOOT_MARKER_PATCH: PRESENT"; else echo "BOOT_MARKER_PATCH: ABSENT"; fi
if [ -d /var/lib/evejs ] && [ -w /var/lib/evejs ]; then echo "DATA_VOLUME_DIRECTORY: WRITABLE"; else echo "DATA_VOLUME_DIRECTORY: NOT_WRITABLE"; fi
f="${EVEJS_COOP_EVENTS_FILE:-}"
if [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ]; then
  echo "EVENTS_FILE: PRESENT_READABLE"
  echo "START_ENTERED_COUNT: $(grep -Fc '"event":"living-startup-entered"' "$f" || true)"
  echo "START_FAILED_COUNT: $(grep -Fc '"event":"living-startup-failed"' "$f" || true)"
  echo "BOOT_REQUESTED_COUNT: $(grep -Fc '"event":"living-headless-boot-requested"' "$f" || true)"
  echo "NATIVE_TOPOLOGY_COUNT: $(grep -Fc '"event":"living-world-topology"' "$f" || true)"
else
  echo "EVENTS_FILE: ABSENT_OR_UNREADABLE"
fi
if [ -f "$probe" ] && command -v sha256sum >/dev/null 2>&1; then
  echo "INSTALLED_PROBE_SHA256: $(sha256sum "$probe" | cut -d ' ' -f 1)"
fi
if [ -f "$world" ] && command -v sha256sum >/dev/null 2>&1; then
  echo "INSTALLED_WORLD_SHA256: $(sha256sum "$world" | cut -d ' ' -f 1)"
fi
'@
Write-Host '[COOP-TELEMETRY] Read-only runtime checks:'
# CRLF from the here-string makes `sh -c` fail on `then\r` / `fi\r` (Windows).
$check = ($check -replace "`r`n", "`n") -replace "`r", "`n"
$encodedCheck = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($check))
$lines = @(& docker compose @opts exec -T server sh -c "echo $encodedCheck | base64 -d | sh -s")
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect installed runtime inside server container' }
$lines | ForEach-Object { Write-Host $_ }
$localProbe = Join-Path $root 'integration/coopRuntimeProbe.cjs'
$localWorld = Join-Path $root 'integration/coopVirtualWorldRuntime.cjs'
if (Test-Path -LiteralPath $localProbe -PathType Leaf) {
    Write-Host "PROJECT_PROBE_SHA256: $((Get-FileHash -LiteralPath $localProbe -Algorithm SHA256).Hash.ToLowerInvariant())"
}
if (Test-Path -LiteralPath $localWorld -PathType Leaf) {
    Write-Host "PROJECT_WORLD_SHA256: $((Get-FileHash -LiteralPath $localWorld -Algorithm SHA256).Hash.ToLowerInvariant())"
}
$statuses = $lines -join "`n"
if ($statuses -match '(?m)^START_HOOK: ABSENT$') {
    Write-Warning 'BLOCKED_START_HOOK: running image is missing the pinned EveJS startup hook; compare installed overlay and intended image before an approved redeploy.'
} elseif ($statuses -match '(?m)^CONFIG_(VIRTUAL_WORLD|HEADLESS_BOOT): DISABLED$') {
    Write-Warning 'BLOCKED_RUNTIME_CONFIG: effective running flags are disabled; local YAML flags do not prove container env.'
} elseif ($statuses -match '(?m)^CONFIG_EVENTS_PATH: MISSING_OR_DIFFERENT$') {
    Write-Warning 'BLOCKED_TELEMETRY_CONFIG: running event-file path is unset/unexpected.'
} elseif ($statuses -match '(?m)^DATA_VOLUME_DIRECTORY: NOT_WRITABLE$') {
    Write-Warning 'BLOCKED_TELEMETRY_WRITE: inspect mounted data directory permissions; this script makes no changes.'
} elseif ($statuses -match '(?m)^EVENTS_FILE: ABSENT_OR_UNREADABLE$') {
    Write-Warning 'BLOCKED_TELEMETRY: compare SHA256, check running server startup errors. An old installed image will not include this code until an authorized rebuild/restart.'
} elseif ($statuses -match '(?m)^BOOT_REQUESTED_COUNT: 0$') {
    Write-Warning 'BLOCKED_HEADLESS_BOOT: event writer works, but boot request was not evidenced; check startup-failed events and server logs.'
} else {
    Write-Host '[COOP-TELEMETRY] Boot events exist; World still requires real native scene/activity evidence.'
}
Write-Host '[COOP-TELEMETRY] Read-only. No Docker rebuild, restart, volume modification, or synthetic events.'