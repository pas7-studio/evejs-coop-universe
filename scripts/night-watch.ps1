# Night watchdog v2: one health line every 15 minutes, plus an explicit PROBLEM
# line when something is actually wrong. Read-only: it never restarts a service,
# never writes to the game, never touches a volume.
$root = Split-Path -Parent $PSScriptRoot
$log = [IO.Path]::GetFullPath((Join-Path $root ".opencode\night-watch-20261028.log"))
function Line($text) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Add-Content -Path $log -Value "$stamp $text"
}
function Count($pattern) {
  $raw = docker exec evejs-server-1 sh -c "grep -ac $pattern /var/lib/evejs/coop-events.jsonl" 2>$null
  $n = 0
  if ([int]::TryParse((($raw -join "") -replace "\s", ""), [ref]$n)) { return $n }
  return -1
}
Line "WATCHDOG v2 START (15 min, problem detection)"
$lastCasualty = -1
$lastGarrison = -1
$stagnant = 0
for ($i = 0; $i -lt 96; $i++) {
  try {
    $agents = (docker ps --filter name=evejs-agents-server-1 --format "{{.Status}}") -join ""
    $play = (docker ps --filter name=evejs-server-1 --format "{{.Status}}") -join ""
    $cpuText = (docker stats --no-stream --format "{{.CPUPerc}}" evejs-server-1 2>$null) -join ""
    $cpu = 0.0
    [double]::TryParse(($cpuText -replace "[^0-9.]", ""), [ref]$cpu) | Out-Null
    $casualty = Count "living-native-war-casualty"
    $garrison = Count "living-native-war-garrison"
    $orders = Count "living-native-war-attack-orders"
    Line "play=[$play] agents=[$agents] cpu=$([math]::Round($cpu,1))% war(casualty/garrison/orders)=$casualty/$garrison/$orders"
    if ($play -notmatch "healthy") { Line "PROBLEM play stack is not healthy: [$play]" }
    if ($agents -notmatch "healthy") { Line "PROBLEM agents stack is not healthy: [$agents]" }
    if ($cpu -gt 70) { Line "PROBLEM play server CPU $([math]::Round($cpu,1))% above 70%" }
    if ($casualty -lt 0) { Line "PROBLEM cannot read the war event file" }
    if ($casualty -eq $lastCasualty -and $garrison -eq $lastGarrison -and $i -gt 0) {
      $stagnant += 1
      if ($stagnant -ge 4) { Line "PROBLEM no war event for 60 min (casualty=$casualty garrison=$garrison) - war may be frozen" }
    } else {
      $stagnant = 0
    }
    $lastCasualty = $casualty
    $lastGarrison = $garrison
  } catch {
    Line "PROBLEM watchdog exception: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 900
}
Line "WATCHDOG v2 STOP"
