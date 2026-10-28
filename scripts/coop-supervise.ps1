# Supervisor check — run every 30 minutes while the coding agent works.
# Usage: powershell -File scripts/coop-supervise.ps1
$repo = "R:\GitRepository\pas7std\evejs-coop-universe"
Set-Location $repo

Write-Output "=== SUPERVISOR $(Get-Date -Format o) ==="

# 1. Is the agent making progress? Any commit in the last 40 minutes?
$last = git log -1 --format="%h|%cI|%s"
$lastAt = [datetime]::Parse((git log -1 --format="%cI"))
$ageMin = [math]::Round(((Get-Date).ToUniversalTime() - $lastAt.ToUniversalTime()).TotalMinutes)
Write-Output "last commit: $last  (age ${ageMin}m)"
if ($ageMin -gt 40) { Write-Output "WARN: no commit for ${ageMin}m - agent may be stuck" }

# 2. Uncommitted work piling up?
$dirty = (git status --porcelain | Measure-Object).Count
Write-Output "uncommitted files: $dirty"
if ($dirty -gt 12) { Write-Output "WARN: many uncommitted files - ask agent to commit" }

# 3. Metrics ledger freshness
if (Test-Path ".opencode\metrics.md") {
  $m = Get-Item ".opencode\metrics.md"
  $mAge = [math]::Round(((Get-Date) - $m.LastWriteTime).TotalMinutes)
  Write-Output "metrics.md age: ${mAge}m  blocks: $((Select-String -Path .opencode\metrics.md -Pattern '^## ').Count)"
  if ($mAge -gt 45) { Write-Output "WARN: metrics not updated for ${mAge}m" }
  Get-Content ".opencode\metrics.md" -Tail 8
} else { Write-Output "WARN: .opencode/metrics.md missing" }

# 4. Handoff state
if (Test-Path ".opencode\state.md") {
  Write-Output "--- state.md tail ---"
  Get-Content ".opencode\state.md" -Tail 6
}

# 5. Live container health
Write-Output "--- containers ---"
docker ps --format "{{.Names}} {{.Status}}" 2>$null | Select-String "evejs"

# 6. War phases still reporting (last 10 min)
Write-Output "--- war log ---"
docker logs evejs-server-1 --since 10m 2>&1 | Select-String "CoopFactionWar|CoopNpcTactics" | Select-Object -Last 6

Write-Output "=== NEXT CHECK IN 30 MIN ==="
