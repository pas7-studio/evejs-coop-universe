# Remote play runbook — ProtonVPN + SSH (owner + friend)

**Status 2026-10-31: endpoint is `156.146.50.8:64410` (relay verified, SSH
banner OK). The friend has to run one SSH tunnel and point his client back at
`127.0.0.1`.** This file exists so nobody has to rediscover the setup. Read §5
before touching anything when the friend reports a problem.

> **The public IP and forwarded port change on every ProtonVPN reconnect.**
> Read them fresh before telling the friend anything:
> `grep -a -o "Port pair [0-9]*->[0-9]*" "%LOCALAPPDATA%\Proton\Proton VPN\Logs\client-logs.txt" | tail -1`
> and then re-create the relay on that port:
> `powershell -File scripts/Start-Play-Stack.ps1 -Action Up -PublicPort <port>`
> (`Start-Relay` now recreates the container when its published port no longer
> matches). Old value was `159.26.120.49:61730`.

## 1. Topology

```
friend PC                              host (owner)                       docker
─────────────────────────────────────────────────────────────────────────────────
client -> 127.0.0.1:26000  ─┐
client -> 127.0.0.1:5222   ─┤
client -> 127.0.0.1:443    ─┼─ ssh -p 64410 evefriend@156.146.50.8
client -> 127.0.0.1:26001  ─┤        │
client -> 127.0.0.1:26002  ─┘        │
                                     │  Proton edge 156.146.50.8:64410
                                     ▼
                          0.0.0.0:64410  evejs-ssh-relay (alpine/socat)
                                     │
                          127.0.0.1:55346  sshd (hardened)
                                     │  PermitOpen 443/5222/26000-26002/40110
                                     ▼
                          127.0.0.1:443/5222/26000-26002  evejs-server-1
                          127.0.0.1:40110                 evejs-market-1
```

Key points:

- ProtonVPN forwards **exactly one** port. It carries SSH, never the game.
- The EVE client always talks to `localhost`: chat, market proxy, images and
  microservices are addressed as `127.0.0.1` (server config publishes
  `EVEJS_XMPP_CONNECT_HOST=localhost`). That is why the tunnel is mandatory for
  anything except flying around.
- The play stack itself never leaves loopback.

## 2. Host bring-up

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Play-Stack.ps1 -Action Up
```

It runs `docker compose -p evejs -f compose.yaml -f compose.coop-probe.yaml up -d`,
starts (or creates) `evejs-ssh-relay`, then proves the relay answers with an SSH
banner. `-Action Status` is read-only and exits `2` when the friend could not
connect. `-Action Stop` stops the stack and the relay, never the volumes.

The relay container is:

```powershell
docker run -d --name evejs-ssh-relay --restart unless-stopped `
  -p 0.0.0.0:64410:64410 alpine/socat `
  tcp-listen:64410,fork,reuseaddr tcp-connect:host.docker.internal:55346
```

sshd hardening (already in place) —
`C:\ProgramData\ssh\sshd_config.d\coop-friend.conf`:

```
Port 55346
Port 48819
PasswordAuthentication no
AuthenticationMethods publickey
PubkeyAuthentication yes
AllowUsers evefriend
AllowTcpForwarding yes
Match User evefriend
  AuthorizedKeysFile C:/ProgramData/ssh/evefriend_authorized_keys
  PermitTTY no
  PermitTunnel no
  PermitOpen 127.0.0.1:443 127.0.0.1:5222 127.0.0.1:26000 127.0.0.1:26001 127.0.0.1:26002 127.0.0.1:40110
  ForceCommand echo Access denied
```

Adding `Port 64410` there instead of relaying needs an elevated edit; the relay
exists to avoid that. If someone later adds the port to sshd, delete the relay
container so the two do not fight over 64410.

## 3. Friend bring-up

1. Tunnel (his existing key, nothing else changes):

   ```
   ssh -N -T -p 64410 evefriend@156.146.50.8 ^
     -L 443:127.0.0.1:443 -L 5222:127.0.0.1:5222 ^
     -L 26000:127.0.0.1:26000 -L 26001:127.0.0.1:26001 ^
     -L 26002:127.0.0.1:26002
   ```

2. `tq\start.ini`:

   ```ini
   server = 127.0.0.1
   port = 26000
   cryptoPack = Placebo
   ```

3. `%LOCALAPPDATA%\CCP\EVE\w_eve_online_-_3396210_tq_<server>\settings\prefs.ini`
   must have `port=26000`. **This file wins over `start.ini`.**

## 4. Verification

Host:

```powershell
powershell -File scripts/Start-Play-Stack.ps1 -Action Status     # stack + relay + SSH banner
docker logs --tail 5 evejs-ssh-relay                              # socat bridging
```

Proton (read-only):

- NAT-PMP opcode 0 to `10.2.0.1:5351` returns the external IPv4 (`156.146.50.8`).
- `%LOCALAPPDATA%\Proton\Proton VPN\Logs\client-logs.txt` contains
  `Port pair 64410->64410` while the mapping lives (renewed about every minute).

Friend: `Test-NetConnection 156.146.50.8 -Port 64410` must succeed, then the
`ssh` command must ask for **key** auth only and forward without errors.

## 5. Symptom → cause → fix

| Symptom | Cause | Fix |
| --- | --- | --- |
| Client: "Could not connect … on port 26000" while `prefs.ini` still carries an older number (or vice versa) | stale `prefs.ini` overrides `start.ini` | set `port=` in `prefs.ini` for the folder matching `<server>` |
| Client: "Error connecting to chat server at localhost:5222" | no SSH tunnel; chat is always loopback | start the tunnel from §3 |
| Market window empty, portraits missing | tunnel missing → no `443` / `26001` / `26002` | same tunnel |
| Friend: `SynSent`, `Test-NetConnection` times out | nothing listening on the forwarded port (relay container gone, or the port was bound to the game earlier) | `-Action Status`; `-Action Up` recreates the relay |
| `Test-NetConnection 156.146.50.8:64410` succeeds from the **host** but friend fails | Proton hairpin is unreliable: the host's own test proves nothing | only trust a test from outside the VPN |
| SSH asks for a password | harden config requires key only; his key missing | compare `C:/ProgramData/ssh/evefriend_authorized_keys` |
| SSH connects but `-L` fails | `PermitOpen` allows only the five game ports | forward exactly those ports |
| Client window never appears (no error) | client started as `bin64\exefile.exe` without the launcher env | start via `Play.bat`; it exports `EO_REMOTEFILECACHEFOLDER`, proxy and CA |
| Market/seed prices look old after a reseed | daemon still on the previous `market.sqlite` | stop `market`, replace the DB in the `evejs-data` volume, start it |

## 6. Dead ends — do not repeat

- **Publishing the game port on the forwarded port.** One forwarded port then serves only the
  game; chat, market and images break because the client insists on `localhost`
  for them.
- **Requesting extra NAT-PMP mappings.** Proton's gateway ignores mapping
  requests from this host (they time out); only the app's single `<port>-><port>`
  mapping exists.
- **Testing the public endpoint from the host.** The Proton client answers the
  TCP handshake itself (hairpin), so a local `Test-NetConnection` "success" means
  nothing. Earlier this masked a completely unbind port.
- **Assuming `docker compose up -d` keeps the public port.** It does not; that is
  why the relay is a separate container with `--restart unless-stopped` and the
  play stack is brought up by the script.

## 7. Rules for agents

1. Use `scripts/Start-Play-Stack.ps1 -Action Up|Status|Stop`; never recreate
   `evejs` with a bare `docker compose up -d` while a remote player is expected.
2. `-Action Status` first on any "friend cannot connect" report.
3. Never publish the market (`40110/40111`), admin bridge or agent ports, and
   never touch `evejs-agents` from this path.
4. Keep the client port question separate from the server question: the host
   server binds `26000`; the client may ask for a different number from
   `prefs.ini`.
