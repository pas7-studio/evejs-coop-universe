# Launching the game client — the only correct way

**TL;DR** — start the client **only** with the launcher, never the executable:

```powershell
C:\Games\EveCoop\upstream-evejs\Code\Play.bat
```

Then prove it once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ClientLaunch.ps1
# RESULT: PASS   <- only this line means the client was launched correctly
```

That script is read-only. It checks the five things that can silently be wrong, and it
prints the fix. If it prints `PROBLEMS`, close the client and start it again with
`Play.bat`.

This document exists because three different agent sessions lost hours to "the client is
running but X does not work", when the cause was always the launch and never the server.

---

## 1. What the launcher does that a direct launch does not

`Play.bat` does two things that are invisible from the desktop and both are load-bearing:

| what it does | why the client breaks without it |
| --- | --- |
| exports `http_proxy` / `https_proxy` / `all_proxy` (local proxy `127.0.0.1:26002`), `no_proxy=127.0.0.1,localhost,::1` | the client's HTTPS/gRPC calls to `*-public-gateway.evetech.net` are CONNECTed to the local HTTP/2 gateway. Without it that name does not resolve here and **no gRPC request ever reaches the server**: measured 0 CONNECT, 0 proxy requests, 0 HTTP/2 streams in ten minutes, while the game socket on `26000` worked fine |
| exports `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` / `CURL_CA_BUNDLE` (the EveJS CA), blanks `EVE_CLIENT_SENTRY_DSN`, sets `LAUNCHDARKLY_OFFLINE=true` | the intercepted gateway host validates, and no retail telemetry or LaunchDarkly flag fetch leaks out |
| starts `bin64\exefile.exe **noconsole** 1>>…\diagnostics\evejs-client-stdout-<id>.log 2>&1` | `packages/logmodule/__init__.py` (`Multiplex.flush`) **re-raises a Windows `EBADF`** on `sys.__stdout__`/`sys.__stderr__` unless the `noconsole` startup argument is present. Without it, any log write performed while a UI window is being built turns into `IOError: [Errno 9] Bad file descriptor` and unwinds the caller — see §3 |

## 2. The correct procedure, in order

```powershell
# 1. the server side (never a bare `docker compose up` — see docs/TWO_STACKS_PLAY_AND_WORK.md)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Play-Stack.ps1 -Action Status
#    containers healthy, SSH relay up, ssh banner OK
#    only if it is NOT running: -Action Up   (this is the owner's game; a restart needs his go)

# 2. the client
C:\Games\EveCoop\upstream-evejs\Code\Play.bat

# 3. the proof
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ClientLaunch.ps1
```

`Play.bat` shows a small console while it runs (it is the client's parent). **Do not close
that console** — closing it ends the client.

Expected verification output (a healthy launch):

```
=== EVE client launch verification ===
[PASS] client-process: 1 exefile.exe process(es)
[PASS] pid 1234 noconsole: logmodule will not re-raise IOError EBADF on stdout
[PASS] pid 1234 launcher-parent: cmd.exe "…\Code\Play.bat"
[PASS] pid 1234 launcher-stdout-log: evejs-client-stdout-123456.log, last written 3,4 min ago
[PASS] gateway-requests: 4 H2/gateway line(s) in the last 240 min from container evejs-server-1
[PASS] client-tracebacks: none in the current server log
RESULT: PASS
```

Agents that have the MCP client tools can use `client_status` (process, character, gamelog
freshness) and `client_launch` — `client_launch` starts **`Play.bat`**, so it is safe; it
refuses to start a second client.

## 3. What a wrong launch looks like — symptom → cause → fix

All of these were measured on this machine. **If you see one of them, check the launch
before touching a single line of server code.**

| symptom in the game | what the log says | cause | fix |
| --- | --- | --- | --- |
| the **overview window / selected-item panel never appears** after login; it shows up only after some later UI event (e.g. a second pilot joins the fleet) | server log: `[AlertService] SendClientStackTraceAlert char=<id> mode=Error`, then `Thrown at: tactical.py OnSessionChanged → tactical.py Open → InitSelectedItem → selectedItemWnd.ApplyAttributes → ui_hider_service.get_ui_hider_service → serviceManager.GetService`, then `EXCEPTION: IOError: [Errno 9] Bad file descriptor` | client started without `noconsole`: a log write inside the window build raised EBADF and aborted it (the IOError *is* the real error here, it is not masking one) | close the client, start it with `Play.bat` |
| Neocom strip / skill-tree panels missing or half-built | same `IOError: [Errno 9] Bad file descriptor`, frames ending in `shipTreeUISvc.OnSkillsChanged` | same | same |
| Agency → Campaigns, advantage, licences, corp goals, insurgency show a **`ServerException(500, "invalid character on request")`**, `FlatbufferContentProvider … Internal Server Error(L500)`, `CampaignRequestError` | server log has **no** `H2 … tls established` and no `eve_public.gateway.Requests/Send` for this session | launched without the proxy/CA variables, so the gRPC traffic never reached the local gateway | close the client, start it with `Play.bat` |
| `gateway request on the plain-HTTP port …` in the server log | — | the client reached the proxy but not the TLS listener (`127.0.0.1:443` → container `26003`) | relaunch with `Play.bat`; if it persists, check `Start-Play-Stack.ps1 -Action Status` |
| login works, chat and market work, but every "web" surface is empty and no client traceback appears | no H2 lines | the client was launched directly from a shortcut that only sets the port | same |

The client has exactly **one** error channel: `alert.SendClientStackTraceAlert`, which the
server logs as `[AlertService] SendClientStackTraceAlert … mode=Error` **with the client's
full Python traceback underneath**. When something is wrong in the client, read that first:

```powershell
docker exec evejs-server-1 sh -c "grep -A8 SendClientStackTraceAlert /var/lib/evejs/logs/server.log | tail -80"
```

If the traceback is itself an `IOError EBADF`, then the *launch* is the bug (see the first
row above) — do not go looking for a server regression.

## 4. Never do this

- **never** start `bin64\exefile.exe` or `bin\exefile.exe` directly, not even
  `Start-Process exefile.exe` from a script;
- **never** double-click a shortcut to the executable;
- **never** accept a client **self-restart** (graphics/settings change, "restart client"):
  that child process is started **without** `noconsole` and without the proxy variables.
  `Get-CimInstance` then shows a bare `exefile.exe` command line and the whole EBADF class
  is back — this is the trap that produced "the overview vanished again";
- do not `docker compose up -d` the play stack by hand (use
  `scripts/Start-Play-Stack.ps1`), and never restart it without the owner's go.

## 5. Verifying a launch by hand (when the script is not available)

```powershell
# a) command line must carry noconsole, and the parent must be the launcher
Get-CimInstance Win32_Process -Filter "Name='exefile.exe'" |
  ForEach-Object { '{0} parent={1} cmd={2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }

# b) a stdout log for THIS session must exist and be growing
Get-ChildItem C:\Games\EveCoop\upstream-evejs\Code\_local\diagnostics\evejs-client-stdout-*.log |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 Name,Length,LastWriteTime

# c) the gateway must see the client
docker logs --since 5m evejs-server-1 2>&1 |
  Select-String "H2 .*tls established|eve_public.gateway.Requests/Send"
```

(a) is the process truth, (b) is the launcher's fingerprint — a session with no fresh
`evejs-client-stdout-*.log` was **not** started by `Play.bat`, whatever the process tree
says — and (c) is the end-to-end proof that the gateway surfaces can work at all.

## 6. The remote player (SSH tunnel + Proton port)

The friend runs his own client, so the rule is identical and so is the failure: his
`Play.bat` must export the proxy variables pointed at **his** tunnelled ports
(`http://127.0.0.1:26002/`), with the host CA imported once
([FRIEND_PC_PRIVATE_TUNNEL.md](FRIEND_PC_PRIVATE_TUNNEL.md)). The game connection goes to
the public Proton port (`159.26.120.49:61730`), which lives in `prefs.ini`, not `start.ini`
(see [PUBLIC_ENDPOINT_PROTONVPN.md](PUBLIC_ENDPOINT_PROTONVPN.md)).

In one line: **he must start the client with his `Play.bat`, never `exefile.exe`.** If he
skips it, chat and market still work over the tunnel but every gateway surface reports
`ServerException(500, "invalid character on request")` — the same symptom as a local direct
launch. The owner can check him without touching his machine: the gateway logs every call
with the active character.

## 7. Play stack prerequisite

The stack itself is started/recreated only with
`scripts/Start-Play-Stack.ps1 -Action Up` (it always includes the public-port override), and
`-Action Status` proves the binding (containers healthy, SSH relay up, `ssh banner … OK`).
A bare `docker compose up -d` must not be used for the play stack; see
[docs/PUBLIC_ENDPOINT_PROTONVPN.md](PUBLIC_ENDPOINT_PROTONVPN.md) and
[docs/TWO_STACKS_PLAY_AND_WORK.md](TWO_STACKS_PLAY_AND_WORK.md).
