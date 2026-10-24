# Live co-op event integration

This integration modifies **only your local pinned EveJS checkout**. It adds
nonblocking instrumentation to upstream's real disconnect and space-login
attachment paths. No parallel session registry, physics, or persistence is used.

## Prepare on Windows

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Install-Coop-RuntimeProbe.ps1
```

The two modifications are small `observe(...)` calls in:
- `Code/server/src/services/_shared/sessionDisconnect.js` before persistence
- `Code/server/src/space/transitions.js` after live attach attempt

The installer is pinned to EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`,
idempotent, and supports rollback using `-Remove`. It does not alter the
underlying login, logoff, emergency warp, or Destiny implementation.

**You must rebuild the EveJS image**, because `compose.yaml` does not mount
`server/src` into the container:

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose build
```

To activate event logging, provide `EVEJS_COOP_EVENTS_FILE` to the `server`
container via a Compose override file (for example:
`EVEJS_COOP_EVENTS_FILE: /var/lib/evejs/coop-events.jsonl`).
This path belongs to EveJS's existing data volume. Restart the server:

```powershell
docker compose up -d
docker compose exec server sh -c 'tail -n 30 /var/lib/evejs/coop-events.jsonl'
```

No events are emitted unless the environment variable is set. The log records
only characterID, shipID, systemID, clientID, event type, timestamp and
attachment success; no credentials or packet payloads. Protect event logs as
operational data. For a private demo, do not publish additional ports.

## Remove

```powershell
cd C:\Games\EveCoopProject
.\scripts\Install-Coop-RuntimeProbe.ps1 -Remove
cd C:\Games\EveCoop\upstream-evejs\Code
docker compose build
docker compose up -d
```

**Acceptance still requires a real run:** the probes demonstrate the code paths
were reached, not that the client successfully rendered a ship or that
persisted state survived a full database restart.

## Optional first native NPC encounter (no X-Eve patch)

The pinned main EveJS already contains `space/npc/npcRuntime.js`, including
`spawnBatchInSystem`. The integration now includes
`integration/coopNativeNpcDemo.cjs`, installed into
`Code/server/src/space/coopNativeNpcDemo.js` and invoked after a successful
ship attach. It uses the **real** EveJS native NPC spawn API, once per selected
system per server process, with at most three NPC. It does not create fake
player sessions. The NPC are from upstream's default hostile pool and may
attack; use only on a dedicated demo world.

Run on Windows from the project root:

```powershell
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableNativeNpcDemo -NpcCount 1 -NpcSystemID 30000142
```

Without `-EnableNativeNpcDemo`, no NPCs are added by this integration.
The demo setting is regenerated per deployment by
`compose.coop-probe.yaml`; removing the flag disables new encounters.
`-Remove` reverses the source hooks, removes the demo adapter and override,
then rebuilds the image.

**This is not X-Eve Living Universe.** X-Eve v0.2.2 requires an exact
v0.12.3.1 baseline archive with SHA-256
`1DEB61A51F808D9F2B330214DA64EC297D9EE5F96EE4B8265692A65F35EEFC1E`.
Our current pinned `gameboys84/EveJS` commit is not a verified copy of that
archive, so blindly applying the X-Eve patch would be unsafe. This demo
integrates directly with the pinned upstream's native NPC features instead;
persistent 5,000-pilot X-Eve economics and population are **not** installed.

Live verification still required: Docker rebuild, NPC spawn, two ship
observers and combat/visibility correctness.

## Two-pilot NPC visibility evidence

After the first eligible ship attaches, the native NPC demo logs
`native-npc-spawn` with NPC entity IDs and the number of initialized
observers in the authoritative scene. Approximately 2.5 seconds later it logs
`native-npc-visibility` with the NPC IDs each still-connected pilot has in
their server-side `visibleDynamicEntityIDs` set. This is observational only:
it does not forge Destiny updates, overwrite visibility, or force an NPC into
either player's client.

For the first manual multiplayer acceptance, connect two distinct characters
in system `30000142` before triggering the first encounter, then inspect
`coop-events.jsonl`. A useful result is one `native-npc-spawn` with two
observers, followed by `native-npc-visibility` where **both** character IDs
show at least one matching NPC entity ID. This verifies server-side observer
state; it does not prove client rendering or the outcome of combat.

The native NPC demo currently spawns once per server process. Restarting
the server allows a fresh demo encounter, so use only a disposable test
universe. The integration is not a substitute for X-Eve Living Universe.
