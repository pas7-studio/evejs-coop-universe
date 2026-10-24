# One Windows PC: EveJS server + two client launchers

**Experimental operator runbook.** This is a reproducible attempt, not proof that the upstream client permits two simultaneous instances. The server stays local-only. Use **two different test accounts and characters**. You must already have lawful access and permissions to use a compatible client build; this repository neither provides nor patches proprietary client assets.

## One-time setup (PowerShell on Windows 11)

Open PowerShell in the orchestration project (Docker Desktop Linux containers must be running):

```powershell
git clone https://github.com/pas7-studio/evejs-coop-universe.git C:\Games\EveCoopProject
cd C:\Games\EveCoopProject
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Preflight.ps1 -CheckPorts
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Fetch-Upstream.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action Prepare
```

The `Prepare` operation can download dependencies, initialize the game database, and rebuild the market; treat it as **one-time**, not a reset command to run before every test.

**Client prerequisite:** follow upstream `Code/doc/SETUP.md` and `Code/tools/ClientSETUP/StartClientSetup.bat` **only after** reviewing licensing and authorizations. Do not alter an official client installation; keep a separate permitted test copy. The launcher checks `start.ini`, certificate trust, client build, local endpoints and client settings. The co-op script will **not** run client setup automatically.

## Daily start, test, stop

```powershell
cd C:\Games\EveCoopProject

# 1. Start one authoritative server and market via Docker
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action Start -HealthTimeoutSeconds 240

# 2. Check server / health
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action Status

# 3. Start two separate Play.bat windows sequentially
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action LaunchTwo -ConfirmClientPermission -LaunchGapSeconds 20

# 4. Save backend evidence, then inspect/redact locally
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action Logs

# 5. Exit BOTH clients manually; stop server (retains Docker volumes)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Local-Two-Client-Test.ps1 -Action Stop
```

Results are placed in `test-results/<timestamp>/`, which must remain untracked. Save screenshots/client logs separately if collected. Never commit credentials, client files, account identifiers, certificates or personal data.

## What agents should actually validate

1. Backend starts once; no duplicate Compose project, no accidental public bound ports.
2. Both launcher windows reach two independent authorized logins. If launcher #2 fails, capture exact console output; do not automatically patch/mutate client files.
3. Separate account A and B appear at the same station / solar system.
4. A undocks, B sees A; A moves, B observes; B moves, A observes.
5. A warps, B receives correct disappearance/reappearance; test dock/undock.
6. Non-destructive combat / mutually visible PvE actions where server supports them.
7. Close A; B must remain connected and continue playing. Relaunch A; no duplicate pilot or lost ship.
8. Stop server, restart, verify character/world persistence.

For each stage use PASS/FAIL/BLOCKED, steps to reproduce, exact EveJS commit, version/build, backend status and sanitized logs. **A pair of opened cmd windows is not a multiplayer PASS.**

## Known constraints

- The real upstream `Play.bat` shares its configured client directory, CA trust and cache settings. This wrapper does **not** isolate caches or guarantee two instances are supported; investigate races if the second client refuses to launch.
- Upstream Docker Compose intentionally publishes localhost-only ports. No public Internet, router port forwarding or VPN exposure.
- X-Eve Living Universe patch requires its exact pinned EveJS baseline and is **not** applied here.
- No automatic bypass of EVE launch restrictions/DRM or proprietary client modification.

## Startup resilience (updated)

The `Start` action now polls `Check-Backend.ps1` up to `HealthTimeoutSeconds` (default 240) rather than failing on the first unhealthy Docker Compose snapshot. EveJS initializes slowly and the Compose server healthcheck has a two-minute start period. The parameter accepts 15–900 seconds.

The `LaunchTwo` action also uses the upstream `Play.bat` from an explicitly set working directory without fragile nested `cmd.exe /k cd /d` quotation. This fixes command-line quoting, **not** any upstream client concurrency restrictions.

Agent rule: if `Start` fails after the timeout, capture `-Action Logs` and report the failing service and last errors. Do not re-run `Prepare` (market rebuild) just to resolve a slow startup.

## Headless transport test while waiting for the EVE client

When Docker is healthy, check that the actual EveJS TCP game listener accepts **two simultaneous connections** without involving any EVE client. This is not an EVE handshake or login test:

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Local-Two-Client-Test.ps1 -Action Start
.\scripts\Local-Two-Client-Test.ps1 -Action Smoke
.\scripts\Local-Two-Client-Test.ps1 -Action Logs
```

The `Smoke` action uses Node.js 22+ and connects only to `127.0.0.1:26000`. It creates two overlapping TCP sockets, holds them briefly, then closes both. Expected output: `TRANSPORT_ONLY_PASS`; if a socket cannot connect or gets closed before the hold check, the command exits nonzero. The probe never sends guessed EVE protocol bytes, never logs in, and cannot by itself verify the game.

Agent acceptance: `Start` reports healthy Docker services; `Smoke` reports `TRANSPORT_ONLY_PASS`; `Logs` provides the evidence. If these pass, mark **TCP transport readiness only**, not the two-client milestone.
