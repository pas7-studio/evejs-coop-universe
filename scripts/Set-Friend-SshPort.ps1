#Requires -Version 5.1
<#
.SYNOPSIS
  Point the friend's SSH entry at the port ProtonVPN currently forwards.

.DESCRIPTION
  ProtonVPN port forwarding maps one public port to the SAME local port, and the
  number changes between sessions. sshd must listen on that number and the
  inbound firewall rule must allow it from the friend's real address only.

  This script edits the managed drop-in C:\ProgramData\ssh\sshd_config.d\
  coop-friend.conf (replacing its `Port` lines), restarts sshd, creates one
  inbound rule per port scoped to -AllowedSourceIp, and prints what is actually
  listening. It never touches EveJS, Docker or any game port.

  Must run elevated.
#>
[CmdletBinding()]
param(
  [int[]]$Ports=@(55346),
  [string]$AllowedSourceIp='176.37.43.83',
  [switch]$Apply
)
$ErrorActionPreference='Stop'
$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $isAdmin){throw 'This script must run elevated (it edits sshd config, the service and the firewall).'}
if($AllowedSourceIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$'){throw "AllowedSourceIp must be a single IPv4 address, got '$AllowedSourceIp'"}
foreach($p in $Ports){ if($p -lt 1024 -or $p -gt 65535){throw "Invalid port $p"} }

$conf='C:\ProgramData\ssh\sshd_config.d\coop-friend.conf'
if(-not (Test-Path -LiteralPath $conf)){throw "Missing sshd drop-in: $conf"}

$lines=Get-Content -LiteralPath $conf
$kept=@($lines | Where-Object { $_ -notmatch '^\s*Port\s+\d+\s*$' })
# Port lines go right after the managed-by comment so the file stays readable.
$header=@(); $body=@()
foreach($l in $kept){ if($body.Count -eq 0 -and $l -match '^\s*#'){ $header+=$l } else { $body+=$l } }
$portLines=@($Ports | ForEach-Object { "Port $_" })
$new=@($header)+$portLines+@($body)

if(-not $Apply){
  "--- would write $conf ---"
  ($new -join "`n")
  "--- would restart sshd and allow ports $($Ports -join ', ') from $AllowedSourceIp ---"
  'DRY_RUN (add -Apply)'
  return
}

$backup="$conf.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $conf -Destination $backup -Force
Set-Content -LiteralPath $conf -Value $new -Encoding ascii
"BACKUP $backup"
"CONFIG_WRITTEN ports=$($Ports -join ',')"

Restart-Service sshd -Force
Start-Sleep -Seconds 2
(Get-Service sshd) | Select-Object Name,Status | Format-Table -AutoSize | Out-String | Write-Output

foreach($p in $Ports){
  $name="EveJS co-op SSH $p"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $p -RemoteAddress $AllowedSourceIp -Profile Any | Out-Null
  "FIREWALL_RULE $name -> tcp/$p from $AllowedSourceIp"
}

"LISTENING:"
Get-NetTCPConnection -State Listen -LocalPort $Ports -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize | Out-String | Write-Output
