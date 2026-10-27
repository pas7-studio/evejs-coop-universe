# Night watchdog: one health line every 15 minutes while the owner sleeps.
# Read-only. It never restarts, never writes to the game, only appends a log.
$log = Join-Path $PSScriptRoot "..\.opencode\night-watch-20261028.log"
$log = [IO.Path]::GetFullPath($log)
function Line($text) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  Add-Content -Path $log -Value "$stamp $text"
}
Line "WATCHDOG START"
for ($i = 0; $i -lt 96; $i++) {
  try {
    $agents = (docker ps --filter name=evejs-agents-server-1 --format "{{.Status}}") -join ""
    $play = (docker ps --filter name=evejs-server-1 --format "{{.Status}}") -join ""
    $cpu = (docker stats --no-stream --format "{{.CPUPerc}}" evejs-agents-server-1 2>$null) -join ""
    $counts = docker exec evejs-agents-server-1 sh -c "grep -ac living-native-war-casualty /var/lib/evejs/coop-events.jsonl; grep -ac living-native-war-garrison /var/lib/evejs/coop-events.jsonl; grep -ac living-native-war-attack-orders /var/lib/evejs/coop-events.jsonl" 2>$null
    $c = ($counts -join "/") -replace "\s+", "/"
    Line "agents=[$agents] play=[$play] cpu=$cpu warEvents(casualty/garrison/orders)=$c"
  } catch {
    Line "WATCHDOG ERROR $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 900
}
Line "WATCHDOG STOP"
