#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Start','Check','Verify')]
  [string]$Action='Check',
  [string]$HostVpnIPv4,
  [string]$SshUser,
  [int]$SshPort=22,
  [string]$IdentityFile='',
  # VPN meshes other than Tailscale use their own private addressing
  # (Radmin 26/8, Hamachi 25/8, ...). Public peer addresses are never allowed.
  [string[]]$ExtraPeerRanges=@()
)
$ErrorActionPreference='Stop'
$privateRanges=@('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10')+$ExtraPeerRanges
function Test-CidrMatch([byte[]]$Bytes,[string]$Cidr){
  $parts=$Cidr.Split('/')
  if($parts.Count -ne 2){throw "Invalid CIDR: $Cidr"}
  $net=$null
  if(-not [System.Net.IPAddress]::TryParse($parts[0],[ref]$net)){throw "Invalid CIDR address: $Cidr"}
  $prefix=[int]$parts[1]
  if($prefix -lt 0 -or $prefix -gt 32){throw "Invalid CIDR prefix: $Cidr"}
  $nb=$net.GetAddressBytes()
  if($nb.Length -ne 4){throw "IPv4 only: $Cidr"}
  for($i=0;$i -lt 4;$i++){
    $bits=[Math]::Max(0,[Math]::Min(8,$prefix-$i*8))
    if($bits -eq 0){break}
    $mask=[byte]((0xFF -shl (8-$bits)) -band 0xFF)
    if(($Bytes[$i] -band $mask) -ne ($nb[$i] -band $mask)){return $false}
  }
  return $true
}
if($Action -ne 'Verify'){
if(-not $SshUser -or -not $HostVpnIPv4){throw 'Provide -SshUser and -HostVpnIPv4 for Check or Start.'}
if($SshUser -notmatch '^[A-Za-z0-9._-]{1,64}$'){throw 'SshUser must be an unambiguous SSH username.'}
if($SshPort -lt 1 -or $SshPort -gt 65535){throw 'Invalid SSH port.'}
# The tunnel peer must be reachable only over a private VPN address.
$addr=$null
if(-not [System.Net.IPAddress]::TryParse($HostVpnIPv4,[ref]$addr)){throw 'Invalid host VPN IPv4 address.'}
$octets=$addr.GetAddressBytes()
if($octets.Length -ne 4){throw 'HostVpnIPv4 must be IPv4.'}
$allowed=$false
foreach($range in $privateRanges){ if(Test-CidrMatch $octets $range){$allowed=$true;break} }
if(-not $allowed){
  throw ("HostVpnIPv4 $HostVpnIPv4 is not a private/VPN address. Allowed: " + ($privateRanges -join ', ') + ". For another mesh pass -ExtraPeerRanges <cidr>. No public-IP forwarding.")
}
if($IdentityFile -and -not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)){throw "Missing SSH identity key: $IdentityFile"}
}
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
Write-Host ('[CHECK] Peer ' + $HostVpnIPv4 + ' is inside an allowed private/VPN range; independently verify the peer identity and SSH host key.')
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
