# Friend on a second PC: private loopback tunneling experiment

**Status: implemented client-side SSH tunnel, not yet verified with the
proprietary EVE client.** This is an *optional*, authenticated connection
path, not a promise that all original launcher, TLS, chat and game
protocol assumptions will work remotely.

## Why not just expose the server?

The pinned EveJS Docker Compose publishes game and companion interfaces
to `127.0.0.1` only. Its launcher explicitly expects
`start.ini` to use `127.0.0.1`; the server also advertises loopback
image/proxy URLs. Publishing `26000` on a public interface would be both
unsafe and insufficient.

An SSH tunnel lets a separately authorized client on the friend's PC
connect to **its own** loopback addresses, securely forwarded across
a private Tailscale connection to the host PC's loopback-only EveJS
listeners. The host continues to run exactly one authoritative server.

## Exact local ports from pinned `Code/compose.yaml`

| Friend's 127.0.0.1 | Host's 127.0.0.1 | EveJS service |
| --- | --- | --- |
| 26000 | 26000 | Game TCP |
| 26001 | 26001 | Image server |
| 26002 | 26002 | HTTP/microservices proxy |
| 443 | 443 | Local HTTPS/CDN interception |
| 5222 | 5222 | Chat/XMPP |

Host port `443` maps to container port `26003`; **do not**
forward internal container port `26003`. Port `40110` (market
health) and administrative interfaces must never be forwarded to
the friend.

## Requirements and trust boundaries

1. Both machines belong to the same authorized private tailnet. Record
   the *host's* real tailnet IPv4 (100.64.0.0/10) and verify the
   friend's device is permitted by Tailscale policy.
2. The host has a key-only SSH account that can forward only the five
   listed 127.0.0.1 destinations. Restrict the SSH service and host
   firewall to the Tailscale interface and your friend's verified tailnet
   IP. **Do not enable an internet-facing SSH listener** and do not
   widen Docker's loopback port bindings.
3. The friend validates the host SSH fingerprint out-of-band and stores
   it in their `known_hosts`. The script deliberately enforces
   `StrictHostKeyChecking=yes` and `BatchMode=yes`: it will not
   auto-trust an unknown server or fall back to password prompts.
4. The friend needs an independently authorized, compatible EveJS
   client installation with its own resource cache and launcher.
   **Never copy executable patches, account credentials, private keys
   or host server certificate private keys** to the friend.
5. The friend's trust chain may need the host's **public** certificate
   authority certificate, verified out-of-band; separately generated
   local EveJS certificates may not match tunneled HTTPS. Review and
   trust only the host public certificate, never its signing key.
6. Check that none of the five loopback ports is occupied on the
   friend's Windows machine. You cannot run another local EveJS server
   simultaneously with this tunnel.

## Friend's Windows commands

Use a trusted SSH key already authorized on the host. From this
orchestration repository:

```powershell
cd C:\Games\EveCoopProject
.\scripts\Start-Friend-Tunnel.ps1 -Action Check -HostVpnIPv4 100.101.102.103 -SshUser coopguest
.\scripts\Start-Friend-Tunnel.ps1 -Action Start -HostVpnIPv4 100.101.102.103 -SshUser coopguest -IdentityFile "$env:USERPROFILE\.ssh\id_ed25519"
```

### Any P2P VPN, not only Tailscale

The tunnel only needs a private IP route between the two PCs; it does not care
which VPN product provides it. Allowed peer addresses are `10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (Tailscale CGNAT). A mesh
with its own range (for example Radmin `26.0.0.0/8`) must be declared
explicitly, and public addresses need an explicit acknowledgement:

```powershell
.\scripts\Start-Friend-Tunnel.ps1 -Action Check -HostVpnIPv4 26.14.7.9 -SshUser coopguest -ExtraPeerRanges '26.0.0.0/8'
```

Some commercial "P2P" clients give every device a real public exit address and
a single forwarded port instead of a routable mesh. In that case the host
publishes **only SSH** through the client's port-forwarding feature, and the
friend still reaches EveJS through the tunnel:

| Model | Host | Friend |
| --- | --- | --- |
| A. Mesh (peers route to each other) | `-FriendAddress <friend VPN ip>` | `-HostVpnIPv4 <host VPN ip>` |
| B. NAT + forwarded port | forward `36933` → `127.0.0.1:2222`, run sshd on 2222 | `-HostVpnIPv4 159.26.120.41 -SshPort 36933` |

In model B the traffic reaches sshd from the VPN provider's relay, so scope the
firewall rule to that relay address (ask the provider) and never to `Any`.
Verify from the friend's PC before touching the game client:

```powershell
Test-NetConnection 159.26.120.41 -Port 36933
```

Host side, once (read-only by default):

```powershell
.\scripts\Prepare-Friend-Access.ps1                                  # report only
.\scripts\Prepare-Friend-Access.ps1 -Apply -FriendAddress <friend or relay ip> -FriendPublicKeyFile <his key.pub> -SshPort 2222
```

That enables OpenSSH Server, starts it, and creates one inbound firewall rule
scoped to the given address. It never publishes an EveJS port: `26000`,
`26001`, `26002`, `26003`, `443`, `5222` stay bound to `127.0.0.1`, and the
script warns if any of them is not.

Order of operations: host `CoopStart` → friend `Start-Friend-Tunnel -Action
Start` → friend `-Action Verify` → friend launches his own authorized client and
logs in with a **different** account. The friend must not run his own EveJS
server while tunnelling (the ports would collide).

**The IPv4 address and username above are examples; do not use them
unchanged.** Leave the terminal open while playing. In **another** PowerShell
window on the friend's PC, check the five tunnel ports and HTTP service:

```powershell
.\scripts\Start-Friend-Tunnel.ps1 -Action Verify
```

This verifies loopback transport only, not the login or certificate
identity. `Ctrl+C` closes
the forwarded connections. There is no public listener on the friend's
machine: each `-L` bind is explicitly `127.0.0.1`.

On the host, start the game once:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142
.\scripts\Local-Two-Client-Test.ps1 -Action LaunchOne -ConfirmClientPermission
```

Then, with the tunnel already open, the friend uses their own
lawfully configured `Play.bat` / compatible launcher against local
127.0.0.1. **Do not rerun server initialization on the friend's PC.**

## Verification stages

- **SSH:** Check tunnel exits with a host-key/authentication error if
  unknown or wrong. Confirm the five loopback ports are listening
  locally after SSH connects.
- **HTTP:** `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:26002/health`
  on the friend PC should contact the host service. This is not an
  authenticated login test.
- **Game:** The friend can complete a separate authorized login while
  host character remains online.
- **World:** Both ships are in the same scene, move, warp, attack one
  common NPC, and observe one wreck.
- **Recovery:** Close the tunnel; host character remains active. Restore
  the tunnel, reconnect the friend; no duplicate ships or lost items.
- **Security:** Verify the game/CDN/chat ports are still bound to
  loopback on the host. A non-tailnet peer must not reach host SSH.

If a TCP tunnel succeeds but the remote client fails, first inspect
certificate trust, launcher-local dependencies, XMPP/proxy redirects
and the generated sanitized diagnostics. **Do not** weaken SSH host
verification, expose public game ports, bypass EVE client security or
declare multi-device support verified.

This tunnel is an interim test approach, not a production remote
network architecture or permission to redistribute proprietary clients.

## Exact runbook: ProtonVPN forwarded port (current path to try)

Model B from the table above. Only SSH is published; the game stays on
`127.0.0.1`. Substitute the real addresses before running anything.

### Friend, before anything (VPN off, plain home internet)

```powershell
# his own public IP - send it to the host
(Invoke-WebRequest https://ifconfig.me/ip -UseBasicParsing).Content.Trim()

# one-time key (press Enter twice for an empty passphrase)
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\coop_ed25519"

# send the single line of this file to the host
Get-Content "$env:USERPROFILE\.ssh\coop_ed25519.pub"
```

The friend must **not** be connected to any VPN: the host firewall rule is
scoped to his real home address, and a VPN exit address will not match.

### Host, once, elevated

```powershell
.\scripts\Setup-Friend-Host.ps1 -Apply -ListenPort 36933 `
  -AllowedSourceIp <friend home ip> `
  -FriendPublicKeyFile C:\path\coop_ed25519.pub
```

Prerequisites: ProtonVPN connected to a P2P server with port forwarding
enabled (the client shows one port, `36933` here). sshd must listen on that
same number because the forward maps the public port to the same local port.
If the VPN reconnects and the port changes, re-run with the new `-ListenPort`.

### Friend, connect

```powershell
# accept the host key once (verify the fingerprint with the host out of band)
ssh -p 36933 -o StrictHostKeyChecking=accept-new <hostuser>@<vpn public ip> exit

# keep this window open while playing
.\scripts\Start-Friend-Tunnel.ps1 -Action Start -HostVpnIPv4 <vpn public ip> `
  -SshPort 36933 -SshUser <hostuser> `
  -IdentityFile "$env:USERPROFILE\.ssh\coop_ed25519" -AllowPublicPeer

# second window: five ports + proxy health
.\scripts\Start-Friend-Tunnel.ps1 -Action Verify
```

### Then

1. Host: `.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142`
2. Friend: launch his own `Play.bat` and log in with a **different** account.
   His own EveJS server/Docker must be stopped.
3. If the client reports a certificate error, import the host CA (public file,
   no key) and retry:
   `Import-Certificate -FilePath .\xmpp-ca-cert.pem -CertStoreLocation Cert:\CurrentUser\Root`
4. Host: `.\scripts\Local-Two-Client-Test.ps1 -Action Publish -Note "friend login result" -Next "..."`

### Honest limits

- Verified so far: script behaviour and refusals (public peers, open ports),
  not a real remote login through this tunnel.
- Only SSH is exposed, restricted to one source address, key-only.
- `26000`, `26001`, `26002`, `26003`, `443`, `5222` stay on `127.0.0.1`.
- If Proton cannot forward the port, this path is dead and the alternatives
  are a mesh VPN with endpoint advertisement (blocked by COOP-012) or nothing.
