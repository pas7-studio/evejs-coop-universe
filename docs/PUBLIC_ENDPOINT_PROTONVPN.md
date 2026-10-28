# Public endpoint for the remote player (ProtonVPN + SSH, 2026-10-29)

**Status: implemented and locally verified; the friend's tunnel is the remaining
check.**

The owner's friend plays over **one** ProtonVPN-forwarded TCP port,
`159.26.120.49:61730`. That port carries **SSH**, not the game: the friend opens
one SSH connection and forwards the five client ports to his own `127.0.0.1`.
This is the same shape the pair used before — only the transport changed from a
private VPN to the Proton forward.

## Why SSH and not the game port

The EVE client needs five loopback services:

| port | service |
| --- | --- |
| 26000 | game server |
| 443 | TLS proxy |
| 5222 | chat (XMPP) |
| 26001 | image server |
| 26002 | microservices |

The client asks for chat/market at `localhost:5222`, `localhost:26001`,
`localhost:26002` (the server publishes `EVEJS_XMPP_CONNECT_HOST=localhost`), so
every service must appear on the friend's own loopback. A single forwarded port
cannot serve five services directly — but it can carry one SSH session that
forwards all of them.

## Host side

```
Proton edge                 host
159.26.120.49:61730  -->  0.0.0.0:61730   (evejs-ssh-relay container, alpine/socat)
                                  |
                                  v
                          127.0.0.1:55346 (sshd, hardened)
```

- Proton logs confirm `Port pair 61730->61730` while the session is alive.
- `evejs-ssh-relay` is a container (`--restart unless-stopped`) that bridges
  `0.0.0.0:61730` to `host.docker.internal:55346`. It exists because adding
  `Port 61730` to sshd needs an elevated edit; the relay does not.
- sshd hardening lives in `C:\ProgramData\ssh\sshd_config.d\coop-friend.conf`:
  key-only (`AuthenticationMethods publickey`), `AllowUsers evefriend`,
  `PermitTTY no`, `ForceCommand echo Access denied`, and `PermitOpen` limited to
  `127.0.0.1:443 127.0.0.1:5222 127.0.0.1:26000 127.0.0.1:26001 127.0.0.1:26002
  127.0.0.1:40110`. Nothing else can be reached through the tunnel.
- The play stack itself stays loopback-only: `127.0.0.1:443/5222/26000-26002`,
  market `127.0.0.1:40110`.

Bring the stack and the relay up with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Play-Stack.ps1 -Action Up
```

`-Action Status` is read-only, prints the stack, the relay container and the SSH
banner read from `127.0.0.1:61730`, and exits 2 when the friend could not connect.

## Friend side

1. One SSH session (his key is already in
   `C:/ProgramData/ssh/evefriend_authorized_keys`):

   ```
   ssh -N -T -p 61730 evefriend@159.26.120.49 ^
     -L 443:127.0.0.1:443 -L 5222:127.0.0.1:5222 ^
     -L 26000:127.0.0.1:26000 -L 26001:127.0.0.1:26001 ^
     -L 26002:127.0.0.1:26002
   ```

   `scripts/Start-Friend-Tunnel.ps1 -Action Start -SshUser evefriend -HostVpnIPv4 <host> -SshPort 61730`
   does the same when the host address is passed explicitly.

2. Client target is **`127.0.0.1` again**, not the public IP:

   ```ini
   ; tq\start.ini
   server = 127.0.0.1
   port = 26000
   cryptoPack = Placebo
   ```

3. The login port is persisted in
   `%LOCALAPPDATA%\CCP\EVE\w_eve_online_-_3396210_tq_<server>\settings\prefs.ini`
   (`port=26000`). `start.ini` supplies only `server`; a stale `prefs.ini` wins
   over `start.ini` and is the usual cause of "connects to the wrong port".

## Rules for agents

1. Never recreate `evejs` with a bare `docker compose up -d`; use
   `scripts/Start-Play-Stack.ps1 -Action Up`, then `-Action Status`.
2. If the friend reports a timeout, run `-Action Status` first: `ssh relay
   container : MISSING` or a non-SSH banner means the relay/port is the problem,
   not Proton.
3. Proton exposes exactly one port. Do not publish the game, market
   (`40110/40111`), admin bridge or agent ports publicly.
4. Reading Proton state without changing it: NAT-PMP opcode 0 to `10.2.0.1:5351`
   returns the external IP; `%LOCALAPPDATA%\Proton\Proton VPN\Logs\client-logs.txt`
   shows `Port pair 61730->61730`. Mapping requests from this host time out —
   only the app's single mapping exists.
