# Windows 11 localhost setup and first-play checklist

> **Upstream procedure, not yet tested by this project.** The original EVE client is proprietary. Check CCP's terms and obtain applicable permissions. Do not download unofficial client archives or bypass launcher/security measures. This document does not provide an EVE client.

## Requirements

- Windows 11, Docker Desktop running Linux containers, PowerShell and Git.
- Free local ports 443, 5222, 26000–26002, 40110.
- A **lawfully usable** full EVE 24.01 build 3396210 client copy, containing `EVE\tq`, `ResFiles`, `index_tranquility.txt`; current launcher versions may not be compatible.
- Internet on first run for container dependencies and game static data.
- Keep original game installation untouched; do not commit client/cache/certificates/database.

## Baseline: Docker route (recommended by upstream)

```powershell
mkdir C:\Games\EveCoop
cd C:\Games\EveCoop
git clone https://github.com/gameboys84/EveJS.git upstream-evejs
cd .\upstream-evejs\Code
docker info --format '{{.OSType}}'
# Must print: linux
docker compose build init
docker compose run --rm --no-deps market-tools engines
docker compose run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari
docker compose up --detach
docker compose logs --follow init market server
```

Stop log following with Ctrl+C. Backend containers remain running. Confirm `docker compose ps --all`: init exited with code 0, server and market healthy.

The upstream README locates the actual launch/setup scripts under `Code`. **Only when permissions allow** and a compatible client is available, follow the original client's setup documented upstream (`tools\ClientSETUP\StartClientSetup.bat`) and launch `Play.bat`. The setup adjusts a *separate* client copy; do not do this to an installed official client or without permission.

### Daily backend operations

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose up --detach
docker compose ps
docker compose logs --follow server market
docker compose down
```

`docker compose down` preserves named volumes by default; **never run `down -v`** without intentional backup. Keep external backup copies before changing patches or engine versions.

## Alternative native Windows (advanced)

Only if Docker is unsuitable, use Node.js 24 LTS, Rust and C++ Build Tools. Upstream README directs:

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
npm ci
npm --prefix server ci
```

Then in order: `tools\ClientSETUP\StartClientSetup.bat`, `tools\DatabaseCreator\CreateDatabase.bat`, `tools\InstallRustForMarket.bat`, `BuildMarketSeed.bat` (Jita + New Caldari), `StartMarketServer.bat`, `StartServer.bat` (Server + Play). Client modification is subject to the permission caveat above. Exact filenames and working directory should be rechecked against the pinned upstream revision.

## Local-only ports in upstream README

| Bind | Purpose |
| --- | --- |
| 127.0.0.1:26000/TCP | Game server |
| 127.0.0.1:26001/TCP | Image server |
| 127.0.0.1:26002/TCP | Local HTTP gateway |
| 127.0.0.1:443/TCP | HTTPS assets |
| 127.0.0.1:5222/TCP | XMPP |
| 127.0.0.1:40110/TCP | Market health/diagnostics |

Do **not** change these to `0.0.0.0`, publish to a router, or expose privileged market/DB ports.

## Optional X-Eve Living Universe (separate clean installation)

Source: https://github.com/kaiwren986/evejs-living-universe

It is a **patch**, not a full server. X-Eve v0.2.2 requires an independently obtained **exact** v0.12.3.1 server archive with SHA-256:

```text
1DEB61A51F808D9F2B330214DA64EC297D9EE5F96EE4B8265692A65F35EEFC1E
```

Do not assume the EveJS `main` checkout works. Obtain baseline from a legitimate permitted source, verify with:

```powershell
Get-FileHash -Algorithm SHA256 'C:\path\to\EveJS-v0.12.3.1.zip'
```

With server shut down, full backup created, and a clean extracted baseline:

```powershell
git clone https://github.com/kaiwren986/evejs-living-universe.git x-eve-patch
cd .\x-eve-patch
powershell -ExecutionPolicy Bypass -File .\installer\Install-XEvePatch.ps1 -EveJSPath 'C:\path\to\EveJS-v0.12.3.1'
powershell -ExecutionPolicy Bypass -File .\installer\Verify-XEvePatch.ps1 -EveJSPath 'C:\path\to\EveJS-v0.12.3.1'
```

Read its own `docs/INSTALL.md` first. X-Eve's normal `Play.bat` is in the patched baseline root. Do **not** mix patched native and Docker processes or combine arbitrary patches. No guarantee of client acquisition or gameplay compatibility.

## Smoke test: record PASS/FAIL, never assume

1. `docker compose ps --all` healthy and no critical errors.
2. Game login and independent character creation (only with permitted client).
3. Station -> undock -> navigate/warp -> dock.
4. Local chat, fitting, combat, basic market and persistence.
5. After clean X-Eve patch: NPC local presence, travel, economy, conflicts and restart persistence.

Collect exact git SHA, build, logs with secrets removed, SQL/DB backup metadata and pass/fail matrix. Report bugs to appropriate upstream maintainers.

**Blocking items:** lawful client/build access, compatible X-Eve baseline archive, permissions, and functional validation. Two-device VPN networking is **not included** in this installation guide.

## Runtime data that must survive a container recreate

`docker compose up -d` recreates the server container whenever `compose.yaml`
changes, and everything written to the image filesystem is lost. Two paths
therefore have to be volumes:

- `/var/lib/evejs` -> `evejs-data` (game store: characters, items, wallets)
- `/app/server/src/_secondary/image/generated` -> `evejs-images`

The second one is not obvious and cost a real debugging session: the EVE
client renders character portraits itself at creation time and the server
stores the files under `generated/Character/<id>/`. Without the volume the
directory silently disappears on the next recreate and every portrait falls
back to the upstream placeholder `_secondary/image/images/hi.jpg` (a dark
square with "hi"). A named volume is used rather than a bind mount so Docker
seeds it with the image's built-in `Faction/` and `agents/` artwork.

Symptom checklist if portraits look like placeholders again:
`docker exec evejs-server-1 ls /app/server/src/_secondary/image/generated`
must list `Character` after the first character has been created. A missing
portrait file is never regenerated by the server; the client has to save a
portrait again (new character, or the portrait editor).

### Agent portraits: the manifest is not the images

`server/src/_secondary/image/generated/agents/manifest.json` (65k entries, ~11k
agents) records where each NPC agent portrait *should* live and its
`images.evetech.net` source URL. It does not contain the pixels, and the files
are not in git, so a fresh checkout serves the `hi.jpg` placeholder for every
agent. Nothing in `server/src` reads the manifest; only the files matter.

Rebuild the cache (resumable, skips existing files):

```powershell
docker cp scripts/fetch-agent-portraits.cjs evejs-server-1:/tmp/fetch.cjs
docker exec evejs-server-1 node /tmp/fetch.cjs --sizes 64,128,256 --concurrency 8
```

Files land in `generated/Character/<agentID>_<size>.jpg`, i.e. inside the
`evejs-images` volume, so they survive container recreation. Verify one:
`Invoke-WebRequest 'http://127.0.0.1:26001/characters/3008416/portrait?size=256'`
must return more than ~4 KB (the placeholder size).

Player characters are different: their portraits come only from the client
(`EvePhoto.AddPortrait` -> `photoUploadSvc.Upload`) at character creation or in
the portrait editor. The server never renders one, and a lost file cannot be
regenerated - the client has to save a portrait again.
