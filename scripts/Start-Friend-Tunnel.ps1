#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Start','Check','Verify')]
  [string]$Action='Check',
  [Parameter(Mandatory=$true)]
  [string]$HostVpnIPv4,
  [Parameter(Mandatory=$true)]
  [string]$SshUser,
  [int]$SshPort=22,
  [string]$IdentityFile=''
)
$ErrorActionPreference='Stop'
if($SshUser -notmatch '^[A-Za-z0-9._-]{1,64}$'){throw 'SshUser must be an unambiguous SSH username.'}
if($SshPort -lt 1 -or $SshPort -gt 65535){throw 'Invalid SSH port.'}
# Opt-in overlay is intentionally restricted to Tailscale's IPv4 CGNAT range.
$addr=$null
if(-not [System.Net.IPAddress]::TryParse($HostVpnIPv4,[ref]$addr)){throw 'Invalid host VPN IPv4 address.'}
$octets=$addr.GetAddressBytes()
if($octets.Length -ne 4 -or $octets[0] -ne 100 -or $octets[1] -lt 64 -or $octets[1] -gt 127){
  throw 'HostVpnIPv4 must be a verified Tailscale-range 100.64.0.0/10 address. No public-IP forwarding.'
}
if($IdentityFile -and -not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)){throw "Missing SSH identity key: $IdentityFile"}
if($Action -eq 'Verify'){
  $ports=@(443,5222,26000,26001,26002)
  $failed=$false
  foreach($port in $ports){
    $client=New-Object Net.Sockets.TcpClient
    try{
      $pending=$client.BeginConnect('127.0.0.1',$port,$null,$null)
      $ok=$pending.AsyncWaitHandle.WaitOne(1000,$false)
      if($ok){$client.EndConnect($pending)}
      $ok=$ok -and $client.Connected
    }catch{$ok=$false}finally{$client.Close()}
    Write-Host ("[{0}] 127.0.0.1:{1}" -f $(if($ok){'PASS'}else{'FAIL'}),$port)
    if(-not $ok){$failed=$true}
  }
  try{
    $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://127.0.0.1:26002/health'
    $proxyOK=($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  }catch{$proxyOK=$false}
  Write-Host ("[{0}] Local EveJS proxy health over tunnel" -f $(if($proxyOK){'PASS'}else{'FAIL'}))
  if($failed -or -not $proxyOK){throw 'Tunnel reachability incomplete. This is not a successful remote game login.'}
  Write-Host '[CHECK] Forwarded ports reachable. Separate EVE client authentication and rendering still unverified.'
  return
}
$ssh=Get-Command 'ssh.exe' -ErrorAction Stop
$ports=@(443,5222,26000,26001,26002)
foreach($port in $ports){
  $listener=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if($listener.Count -gt 0){
    throw "Local 127.0.0.1:$port is occupied. Stop conflicting software before launching the tunnel."
  }
}
Write-Host '[CHECK] Required client-side localhost ports are available.'
Write-Host '[CHECK] VPN address syntax is Tailscale-range; independently verify the peer identity and SSH host key.'
Write-Host '[CHECK] This does not prove an EVE client can connect or that the host is authorized.'
if($Action -eq 'Check'){return}
$argsList=@('-N','-T','-4',
  '-o','ExitOnForwardFailure=yes',
  '-o','StrictHostKeyChecking=yes',
  '-o','BatchMode=yes',
  '-o','ServerAliveInterval=20',
  '-o','ServerAliveCountMax=3',
  '-o','GatewayPorts=no',
  '-p',"$SshPort"
)
if($IdentityFile){$argsList+=@('-i',$IdentityFile)}
foreach($port in $ports){
  $argsList+=@('-L',("127.0.0.1:{0}:127.0.0.1:{0}" -f $port))
}
$argsList+=("$SshUser@$HostVpnIPv4")
Write-Host '[START] Secure client-local port forwards to the authorized EveJS host.'
Write-Host '[START] Leave this window open while playing; Ctrl+C closes the tunnel.'
& $ssh.Source @argsList
if($LASTEXITCODE -ne 0){throw "SSH tunnel terminated with exit code $LASTEXITCODE"}
