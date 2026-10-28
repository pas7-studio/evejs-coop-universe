# Launching the game client correctly

**Always start the client through the launcher — `Play.bat` — never `exefile.exe`
directly.** The launcher is not a convenience wrapper: it is what connects the client to
the local gateway at all.

```powershell
# the only supported way
C:\Games\EveCoop\upstream-evejs\Code\Play.bat        # or scripts/Start-Play-Stack.ps1 -Action Up first
```

## What the launcher does that a direct launch does not

`Play.bat` runs `:ApplyClientNetworkPolicy` before starting `bin64\exefile.exe`, and exports
for that child process only:

| variable | why it matters |
| --- | --- |
| `http_proxy` / `https_proxy` / `all_proxy` | the client's HTTPS/gRPC calls to `*-public-gateway.evetech.net` go through the local proxy on `127.0.0.1:26002`; the proxy CONNECTs that host to the local HTTP/2 listener (`127.0.0.1:443` → container `26003`) |
| `no_proxy=127.0.0.1,localhost,::1` | keeps the game connection to `127.0.0.1:26000` direct |
| `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` / `CURL_CA_BUNDLE` | the EveJS CA, so the intercepted gateway host validates |
| `EVE_CLIENT_SENTRY_DSN` (blanked) + `LAUNCHDARKLY_OFFLINE=true` | keeps retail telemetry/LaunchDarkly out of the process |

Without the proxy variables the client tries to resolve `public-gateway.evetech.net`
directly. On this machine that name does not resolve, so **no gRPC request ever reaches the
server**: measured `0` `CONNECT`, `0` proxy requests and `0` HTTP/2 streams in ten minutes of
a direct-launched session, while the game connection on `26000` worked normally.

## How a wrong launch looks from inside the game

- `ServerException(status_code=500, status_message="invalid character on request")` while
  logging in, from user licences / neocom, insurgency corruption or suppression, corporation
  goals, or campaigns.
- `GenericInternalServerError: FlatbufferContentProvider: fetchRequest for flatbuffer data
  raises Internal Server Error(L500)`.
- `CampaignRequestError`, and empty **Agency → Campaigns** / advantage panels that never fill.

These are reported by the client itself through `alert.SendClientStackTraceAlert`, and the
server logs them as `[AlertService] SendClientStackTraceAlert … mode=Error` with the full
traceback underneath — that is the only client-side error channel available (the in-game
gamelog stays empty).

## How to prove the launch was correct

```powershell
# 1. the client's parent is the launcher, not explorer
Get-CimInstance Win32_Process -Filter "Name='exefile.exe'" |
  ForEach-Object { '{0} parent={1}' -f $_.ProcessId, $_.ParentProcessId }
# expect the parent to be a cmd.exe running Play.bat

# 2. the gateway actually receives the client
docker logs --since 3m evejs-server-1 2>&1 |
  Select-String "H2 .*tls established|eve_public.gateway.Requests/Send"
```

Expect `H2 tls established … ALPN=h2` followed by
`POST /eve_public.gateway.Requests/Send host=dev-public-gateway.evetech.net type=application/grpc`.
If the log shows `gateway request on the plain-HTTP port …`, the client reached the proxy but
not the TLS listener — relaunch through `Play.bat`.

## The remote player (SSH tunnel + Proton game port)

The friend runs his own client, so the rule is identical and so is the failure: his `Play.bat`
must export the proxy variables, and it must point at **his** tunnelled ports
(`http://127.0.0.1:26002/`), with the host CA imported once
([FRIEND_PC_PRIVATE_TUNNEL.md](FRIEND_PC_PRIVATE_TUNNEL.md)). The game connection goes to the
public Proton port (`159.26.120.49:61730`), which `prefs.ini` carries, not `start.ini`.

What the friend must do, in one line: **start the client with his `Play.bat`, never
`exefile.exe`**. If he skips it, his login chat and market still work over the tunnel but the
gateway surfaces (advantage, campaigns, licences, corp goals, insurgency) report
`ServerException(500, "invalid character on request")` - the same symptom as a local
direct launch.

The owner can verify a friend's launch without touching the friend's machine: the gateway logs
every call with the character that made it.

```powershell
docker logs --since 5m evejs-server-1 2>&1 |
  Select-String "Requests.Send type=|H2 .*tls established"
# a correct launch from the tunnel shows Requests.Send lines with his activeCharacterID
```

## Play stack prerequisite

The stack itself is started/recreated only with
`scripts/Start-Play-Stack.ps1 -Action Up` (it always includes `compose.play-public.yaml`, which
carries the Proton public port `61730 → 26000`), and `-Action Status` proves the binding. A bare
`docker compose up -d` must not be used for the play stack; see
[docs/PUBLIC_ENDPOINT_PROTONVPN.md](PUBLIC_ENDPOINT_PROTONVPN.md).
