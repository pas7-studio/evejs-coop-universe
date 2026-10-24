#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [switch]$Remove
)
$ErrorActionPreference='Stop'
$server=Join-Path $CodePath 'server/src'
$probeTarget=Join-Path $server 'space/coopRuntimeProbe.js'
$probeSource=Join-Path $PSScriptRoot '../integration/coopRuntimeProbe.cjs'
$npcSource=Join-Path $PSScriptRoot '../integration/coopNativeNpcDemo.cjs'
$npcTarget=Join-Path $server 'space/coopNativeNpcDemo.js'
$expected='c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
$rev=(& git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
if ($rev -ne $expected) { throw "Refusing to patch unknown EveJS revision $rev" }
$patches=@(
  @{ path=(Join-Path $server 'services/_shared/sessionDisconnect.js'); marker='  persistCharacterLogoffState(session);'; injection='  require("../../space/coopRuntimeProbe").observe("disconnect-before-persist", session, null);' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const attachElapsedMs = Date.now() - attachStartedAtMs;'; injection='  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const hydrationQueuedAtMs = Date.now();'; injection='  require("./coopNativeNpcDemo").maybeSpawn(session, activeShip);' }
)
foreach($p in $patches) {
  if(-not (Test-Path -LiteralPath $p.path)){throw "Missing upstream file: $($p.path)"}
  $original=[System.IO.File]::ReadAllText($p.path)
  if(-not $original.Contains($p.marker)){throw "Unexpected upstream layout in $($p.path)"}
  if(-not $Remove -and -not $original.Contains($p.injection)) {
    $updated=$original.Replace($p.marker,$p.marker+[Environment]::NewLine+$p.injection)
    [System.IO.File]::WriteAllText($p.path,$updated,[System.Text.UTF8Encoding]::new($false))
    Write-Host "[INSTALLED] $($p.path)"
  } elseif($Remove -and $original.Contains($p.injection)) {
    $updated=$original.Replace($p.marker+[Environment]::NewLine+$p.injection,$p.marker)
    [System.IO.File]::WriteAllText($p.path,$updated,[System.Text.UTF8Encoding]::new($false))
    Write-Host "[REMOVED] $($p.path)"
  } else { Write-Host "[UNCHANGED] $($p.path)" }
}
if($Remove) {
  if(Test-Path -LiteralPath $probeTarget){Remove-Item -LiteralPath $probeTarget -Force}
  if(Test-Path -LiteralPath $npcTarget){Remove-Item -LiteralPath $npcTarget -Force}
} else {
  Copy-Item -LiteralPath $probeSource -Destination $probeTarget -Force
  Copy-Item -LiteralPath $npcSource -Destination $npcTarget -Force
}
Write-Host 'Co-op probe installation complete. Set EVEJS_COOP_EVENTS_FILE within the server container to enable JSONL event output.'
