# First co-op play session (one host, two authorized local clients)

**Goal:** actually fly two independent pilots, see each other, fight one
shared native EveJS NPC, loot its wreck and save the world — without
installing X-Eve or enabling the experimental full virtual economy.

## Before playing

- Windows 11 host with Docker Desktop (Linux containers), Git and Node 22+.
- Pinned EveJS checkout `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`
  at `C:\Games\EveCoop\upstream-evejs\Code`.
- Separate lawful, compatible EVE 24.01 build 3396210 client copy with
  any required permissions and already completed upstream client setup.
- Two **different accounts and characters**; do not share session credentials.
- No networking ports opened publicly.

**Friend on a different PC:** pinned EveJS is localhost-only by
default. An **experimental private SSH loopback tunnel** is now available
for an independently authorized client: see
[FRIEND_PC_PRIVATE_TUNNEL.md](FRIEND_PC_PRIVATE_TUNNEL.md).
It forwards only game, image, proxy, CDN and XMPP ports over a
Tailscale-restricted SSH connection; it does not expose Docker's
market or admin interfaces. Actual remote client login and TLS
compatibility remain unverified.

## First-time bootstrap only

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Local-Two-Client-Test.ps1 -Action Prepare
```

Only do this once on a new world. Do **not** rebuild the market or reset
the database each time you play.

## Game-night startup

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Install-Coop-RuntimeProbe.ps1 -DryRun
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142
.\scripts\Local-Two-Client-Test.ps1 -Action Status
```

`CoopStart` validates the pinned source, updates the reversible
co-op overlay, builds the image and starts one authoritative Docker server.
It does **not** enable experimental virtual-world economics or faction
spawns. It enables **repeatable native NPC encounters**: no new enemy
batch while a prior encounter NPC is still alive, 12-minute default
cooldown between successful batches, and a persisted limit of 20 batches **per 24-hour window**.
The actual spawn requires two distinct Ballpark-ready characters
within 250 km in the selected system. A server-side coordinator
keeps checking proximity after both have logged in, so you may
warp to each other *later* without logging out to start combat.

If the intended play system is different, supply its numeric EveJS ID
via `-NpcSystemID`. Both ships must physically fly to that system and
come onto the same grid. The first character alone will not trigger combat. Both players can
fly separately and later rendezvous; the game server rechecks the grid
every four seconds.

## Two clients and gameplay

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action LaunchTwo -ConfirmClientPermission
```

This opens two upstream `Play.bat` launchers. It does not bypass client
concurrency limitations or isolate proprietary client caches. If you
have a second permitted standalone client setup, use it as appropriate.

After both independent logins:

1. Choose two different characters. Confirm both appear in their own
   separate accounts without displacing one another.
2. Bring them into the same solar system, undock, warp to the same grid.
3. Run `-Action Party` below. The latest server-scene snapshot should
   list two distinct character IDs and ship IDs. Mutual ship visibility
   should be corroborated by both client overviews.
4. Target and fight the same native NPC with the regular client modules.
   Check that the shield/armor/structure changes agree for both players.
5. On NPC death, look for one common wreck. Loot the last item with A
   and confirm B sees its empty-state change.
6. Disconnect only A. B must remain connected, move and interact.
   Reconnect A and verify ship state is restored without a duplicate.
7. Quit both clients, stop and restart the backend **without deleting
   Docker volumes**, then check persistent characters and items.

Live evidence:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action Party
.\scripts\Local-Two-Client-Test.ps1 -Action Logs
```

The `Party` report reads recent `coop-events.jsonl` from the real
server and outputs whether two character IDs were observed in a shared
authoritative scene, plus server-side mutual ship visibility. It is
not proof that both client windows render the scene correctly.

If the Party report only shows one pilot, check both characters' system
IDs, ship undock state and whether the clients initialized Ballpark
(`coop-client-not-ready` events). Do not infer a playable game from
a two-TCP-socket smoke result.

## Shutdown without losing progress

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action Stop
```

This runs `docker compose down`, **not** `down -v`. Your named EveJS
volume stays intact. Before major upstream upgrades, back up persistent
data independently and preserve the pinned code revision.

The co-op source overlay may be removed using:

```powershell
.\scripts\Install-Coop-RuntimeProbe.ps1 -Remove
```

Then rebuild the server image before launching it again. The new overlay
performs a full source preflight and syntax check and supports repeatable
install/remove operations across Windows CRLF and upstream LF files.

**Unverified boundaries:** A compatible working client, two full
authenticated logins, cross-PC play, PvE/loot visibility and reconnect
persistency have not been proven on the user's machine. Keep those
acceptance checks explicit rather than claiming a successful session.


### Change combat difficulty without changing code

The first-play defaults to **one enemy ship per encounter**. For a more
challenging cooperative fight, select two or three:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142 -EnemyCount 2 -EncounterCooldownMinutes 8 -MaxEncounterBatches 30
```

Allowed enemy count is 1–3. The cooldown is measured in minutes and the daily limit counts successful
spawn batches (not killed ships), automatically renewing every 24 hours.
Cumulative successful spawns remain recorded for operator diagnostics.
The authoritative EveJS NPC runtime determines which targets the enemies
attack, damage, drops and available salvage. There is no artificial combat
damage or invented inventory.

An existing encounter must disappear from the authoritative scene before
the next batch may start; this prevents two logins or repeated grid checks
from multiplying live enemies. If an encounter ends, stay together on the
same grid and the next one may spawn once its cooldown expires.

`-Action Party` also reports a `cooperativeWreckKillsObserved` count
from actual EveJS native wreck creation. It does not automatically mean
that loot was transferred successfully; check both clients' cargo state.

For other commands (`Start`, `Stop`, `Party`, `Status`, `Logs`),
the game-night script now uses the installed co-op Compose override too.
Running `Start` should not silently drop your co-op environment flags.
