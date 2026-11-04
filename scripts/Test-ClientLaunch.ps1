<#
.SYNOPSIS
  Read-only proof that the EVE client was launched the ONE supported way (Play.bat), and
  a plain-language list of what is broken when it was not.

.DESCRIPTION
  Every check below answers a question an agent actually asked on this machine:
    * is a client running at all?
    * was it started by the launcher (Play.bat) or by explorer / a shortcut?
    * did the launcher's two invisible pieces reach the process: the `noconsole`
      argument (logmodule stops re-raising IOError EBADF) and the stdout redirect
      (Code/_local/diagnostics/evejs-client-stdout-*.log must exist and be fresh)?
    * does the local gateway really receive the client (proxy CONNECT + HTTP/2)?
    * does the server log any client traceback worth reading first?

  It never starts, stops or restarts anything. Exit code 0 = PASS, 2 = problems found.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ClientLaunch.ps1
#>
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$Container = 'evejs-server-1',
  [int]$FreshMinutes = 240
)

$ErrorActionPreference = 'Continue'
$problems = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

function Write-Result {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  $tag = 'FAIL'
  if ($Ok) { $tag = 'PASS' }
  Write-Output ('[{0}] {1}: {2}' -f $tag, $Name, $Detail)
  if (-not $Ok) { $script:problems.Add(('{0} - {1}' -f $Name, $Detail)) | Out-Null }
}

Write-Output '=== EVE client launch verification ==='

# 1. Is a client process running?
$clients = @(Get-CimInstance Win32_Process -Filter "Name='exefile.exe'" -ErrorAction SilentlyContinue)
$runningDetail = 'no exefile.exe - nothing is running'
if ($clients.Count -gt 0) { $runningDetail = ('{0} exefile.exe process(es)' -f $clients.Count) }
Write-Result 'client-process' ($clients.Count -gt 0) $runningDetail

if ($clients.Count -eq 0) {
  Write-Output 'Nothing else can be checked without a running client.'
  Write-Output ('Start it with: ' + (Join-Path $CodePath 'Play.bat'))
  exit 2
}

foreach ($client in $clients) {
  $pidText = [string]$client.ProcessId
  $cmdline = [string]$client.CommandLine

  # 2. `noconsole` reached the process.
  $hasNoConsole = [bool]($cmdline -match '(^|\s)noconsole(\s|$)')
  $noConsoleDetail = 'MISSING - every log write during a window build can unwind it: IOError [Errno 9] Bad file descriptor, and the overview / selected-item window silently fails to appear'
  if ($hasNoConsole) { $noConsoleDetail = 'logmodule will not re-raise IOError EBADF on stdout' }
  Write-Result ('pid {0} noconsole' -f $pidText) $hasNoConsole $noConsoleDetail

  # 3. Started by the launcher (its parent is a cmd.exe running Play.bat), not explorer.
  $parent = $null
  try {
    $parent = Get-CimInstance Win32_Process -Filter ('ProcessId={0}' -f $client.ParentProcessId) -ErrorAction Stop
  } catch { $parent = $null }
  $parentOk = $false
  $parentDetail = 'parent process unknown'
  if ($parent) {
    $parentText = [string]$parent.CommandLine
    $parentName = [string]$parent.Name
    $parentOk = ($parentName -match '^(cmd|powershell|pwsh)\.exe$') -and ($parentText -match 'Play\.bat')
    $parentDetail = $parentName + ' ' + ($parentText -replace '\s+', ' ')
    if (-not $parentOk -and $parentText -match 'explorer\.exe') {
      $parentDetail = 'started by explorer (double-click / shortcut)'
    }
  }
  Write-Result ('pid {0} launcher-parent' -f $pidText) $parentOk $parentDetail

  # 4. The stdout redirect file: the launcher always writes one. A session without one was
  #    not started by the launcher, whatever the process tree says (a client that restarted
  #    itself inherits nothing).
  $diag = Join-Path $CodePath '_local\diagnostics'
  $stdoutLog = $null
  if (Test-Path -LiteralPath $diag) {
    $stdoutLog = Get-ChildItem -LiteralPath $diag -Filter 'evejs-client-stdout-*.log' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  $fresh = $false
  $freshDetail = ('no evejs-client-stdout-*.log under ' + $diag)
  if ($stdoutLog) {
    $ageMinutes = [math]::Round(((Get-Date) - $stdoutLog.LastWriteTime).TotalMinutes, 1)
    $fresh = ($ageMinutes -le $FreshMinutes)
    $freshDetail = ('{0}, last written {1} min ago, {2} bytes' -f $stdoutLog.Name, $ageMinutes, $stdoutLog.Length)
  }
  Write-Result ('pid {0} launcher-stdout-log' -f $pidText) $fresh $freshDetail
}

# 5. The gateway really receives the client: proxy CONNECT + HTTP/2 TLS in the server log.
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  $notes.Add('docker not on PATH - gateway check skipped') | Out-Null
} else {
  $gatewayLines = @()
  try {
    $gatewayLines = @(docker logs --since ('{0}m' -f $FreshMinutes) $Container 2>&1 |
      Select-String -Pattern 'H2 .*tls established|eve_public\.gateway\.Requests/Send')
  } catch {
    $notes.Add('docker logs failed: ' + $_.Exception.Message) | Out-Null
  }
  Write-Result 'gateway-requests' ($gatewayLines.Count -gt 0) `
    ('{0} H2/gateway line(s) in the last {1} min from container {2}' -f $gatewayLines.Count, $FreshMinutes, $Container)
  if ($gatewayLines.Count -gt 0) {
    $gatewayLines | Select-Object -Last 3 | ForEach-Object { Write-Output ('       ' + ([string]$_).Trim()) }
  } else {
    Write-Output '       Without CONNECT/HTTP-2 the client never reaches the local gateway: licences,'
    Write-Output '       campaigns, advantage, corp goals and insurgency answer 500 "invalid character on request".'
    Write-Output '       Fix: close the client and start it with Play.bat (it exports the proxy + CA).'
  }

  # 6. Client tracebacks the server was told about - read these before blaming the server.
  $count = 0
  try {
    $raw = docker exec $Container sh -c "grep -c SendClientStackTraceAlert /var/lib/evejs/logs/server.log 2>/dev/null" 2>&1
    [int]::TryParse(([string]$raw).Trim(), [ref]$count) | Out-Null
  } catch { $count = 0 }
  if ($count -gt 0) {
    Write-Output ('[INFO] client-tracebacks: {0} SendClientStackTraceAlert line(s) in the current server log.' -f $count)
    Write-Output '       They are the only client error channel; read them first:'
    Write-Output ('       docker exec {0} sh -c "grep -A6 SendClientStackTraceAlert /var/lib/evejs/logs/server.log | tail -60"' -f $Container)
    $notes.Add(('{0} client traceback(s) - inspect before blaming the server' -f $count)) | Out-Null
  } else {
    Write-Output '[PASS] client-tracebacks: none in the current server log'
  }
}

Write-Output ''
if ($problems.Count -eq 0) {
  Write-Output 'RESULT: PASS - this client was launched through Play.bat with noconsole and stdout redirect.'
  exit 0
}

Write-Output 'RESULT: PROBLEMS'
foreach ($problem in $problems) { Write-Output ('  - ' + $problem) }
Write-Output ''
Write-Output 'Fix (every case above): close the client completely, then run'
Write-Output ('  ' + (Join-Path $CodePath 'Play.bat'))
Write-Output 'Never start bin64\exefile.exe directly, and never accept a client self-restart'
Write-Output '(a self-restarted client loses the noconsole argument).'
foreach ($note in $notes) { Write-Output ('note: ' + $note) }
exit 2
