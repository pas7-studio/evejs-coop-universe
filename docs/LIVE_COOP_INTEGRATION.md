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

## Native combat observation

With `-EnableNativeNpcDemo`, the integration installs the opt-in
`coopCombatProbe.js` in the actual EveJS server. Once native spawn succeeds,
the probe samples for **at most 60 seconds, once per second**. JSONL events
`native-npc-combat-sample` include each tracked NPC and pilot ship's current
`conditionState.shieldCharge`, `armorDamage`, `damage`, movement mode,
presence/absence and which observers currently see each entity.

This does not synthesize damage, force targeting, issue illegal PvP commands or
claim NPC kills. The **server engine remains authoritative** for targeting,
module timers, damage, wreck generation and loot. To see an actual fight,
both players should use normal client controls to attack the same NPC.
A disappearing NPC entity is reported as missing, not automatically as a kill;
compare the actual server killmail/wreck evidence before claiming victory.

The observational sampler also handles a missing NPC entity without crashing
the game, uses unref'd timers, and stops after the configured window.

## Native NPC destruction, wrecks and shared loot visibility

The pinned EveJS wreck pipeline is `destroyNativeNpcEntityWithWreck()`
in `space/npc/nativeNpcWreckService.js`. It writes native wreck and
wreck-item records, removes the destroyed NPC from the authoritative scene,
and spawns its wreck entity. The co-op adapter **does not invoke this function
itself** and does not roll loot twice.

The combat sampler now tracks native wrecks by their `launcherID` matching
the spawned NPC entity ID. In `native-npc-combat-sample` records,
`wrecks` lists the confirmed in-scene wreck entities and
`observers[].visibleWreckIDs` reports which wrecks each player can see
server-side. A destroyed or missing NPC is **not** considered a kill unless
the expected wreck or separate canonical kill evidence appears.

This still does not prove either player can open the wreck inventory, move
items, salvage, or that both clients render the wreck. Those actions must be
exercised against the real EveJS loot/inventory flow in the eventual manual
game test, without using a synthetic item generator.

## Shared wreck loot-state synchronization

The pinned EveJS transfer routine already performs the authoritative operation
`transferNativeWreckItemToCharacterLocation()`: it validates wreck/item IDs,
available quantity and inventory grant, then removes or decrements the source
item. We do **not** duplicate that workflow.

One specific upstream defect affects two observers: after a successful
transfer, `nativeNpcWreckService.js` calls
`refreshNativeWreckRuntimeEntity(...)` without `{ broadcast: true }`.
That updates `isEmpty` on the server, but does not explicitly publish the
slim-item change to the other connected clients. The pinned integration
installer now changes this single call to
`refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });`.
The native service then uses its existing
`scene.sendSlimItemChangesToAllSessions([entity])` mechanism.

This affects **state propagation only**. Item transfer authorization,
inventory location validation, server-side item grants, quantity adjustment
and salvage continue to be handled by upstream. If the native service rejects
the transfer, this broadcast path is not reached. The installer checks that
the old call occurs exactly once and supports `-Remove` to restore it.

For acceptance: after both pilots see the same wreck, loot the final item as
pilot A; verify that the wreck's emptied state updates for B without
reloading the system. This is not yet proven with a client and live database.

## Restart-safe encounter director — larger functional milestone

The optional `integration/coopEncounterDirector.cjs` is a durable,
bounded encounter schedule for **native EveJS NPCs**. It is **not** the
incompatible X-Eve patch and does not create fake online players.

The director persists a per-system record in
`/var/lib/evejs/coop-encounters.json`, which lives on the existing
`evejs-data` volume. Each eligible in-space login can request one
native NPC batch only when a cooldown has elapsed. The scheduler writes
the next allowed time **before** invoking the native spawn, to prevent
rapid retries if a spawn fails. A per-system lifetime spawn cap avoids
unbounded accumulation. Restarting the server reloads this schedule.

To enable it on a disposable test universe:

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnablePersistentEncounters -NpcSystemID 30000142 -NpcCount 1 -EncounterCooldownMinutes 60 -EncounterMaxSpawns 24
```

Without `-EnablePersistentEncounters`, this director is disabled. The
legacy `-EnableNativeNpcDemo` still performs a one-time process-local
encounter. The two flags should not be combined; use the persistent flag
alone for this scenario.

State entries contain the next eligible timestamp, visit attempts and
successful spawn-batch counts. They do **not** hold authoritative ship
health, positions, market assets or client identities. Spawned NPCs still
belong to upstream's native NPC controller/runtime and native wreck/loot
systems.

**Deliberate scope limit:** this is a persistent *encounter schedule*,
not a persistent 5,000-NPC living universe. It does not yet model
off-grid interstellar travel, economic supply/demand, NPC factions'
strategic decisions or independent simulation while no pilot logs in.
Those features require a separate world-simulation service compatible
with this pinned EveJS revision. No claims of that functionality are
made by this feature.

Local deterministic tests:
`node --test tests/coop-encounter-director.test.mjs`.
Full Docker/gameplay tests still require the user-owned Windows setup.

## Virtual NPC world: persistent identities and offline routes

The optional `coopVirtualWorld.cjs` is a separate **virtual** world layer.
It creates a bounded set of persistent named NPC identities, with faction,
current system, route index, scheduled departure, and cumulative journeys.
Travel is advanced by elapsed wall-clock time, including catch-up across
server restarts, rather than replaying every intermediate simulation tick.
No player connection is necessary *after the first initialization*: its
30-second timer continues advancing while the server process remains alive.
The initial runtime is currently started by the first successful in-space
login; this is **not yet a standalone boot-time background service**.

Virtual NPCs do not automatically materialize as physical ships. The new
records are therefore not combat-capable native entities and do not appear
in client Local/chat or overview. The integration reports local virtual
residents through the opt-in JSONL `virtual-world-presence` event only.
Do not mistake this milestone for a finished Living Universe.

Enable on the disposable Docker test instance:

```powershell
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableVirtualWorld -VirtualPopulation 16 -VirtualTravelSeconds 120
```

The state is stored in EveJS's existing `evejs-data` volume as
`/var/lib/evejs/coop-virtual-world.json`. The default demonstration route
is `30000142,30000144`. The implementation caps population at 100.
Routes must be two or more positive system IDs. Run module tests locally:

```powershell
node --test .\tests\coop-virtual-world.test.mjs
```

Next integration frontier: native scene materialization of *specific* virtual
pilot identities with de-duplication, and then server-owned faction/economy
activity. Avoid equating these virtual records with real NPC ships until that
bridge is implemented and verified.

## Optional materialization of virtual identities

The virtual-world adapter can now create *actual* native EveJS NPCs for
virtual pilots resident in the system when an in-space pilot arrives.
The process-local `coopNpcMaterializer.js` maps virtual pilot IDs to
native NPC entity IDs, prevents duplicate spawning on a second login and
limits active materializations per system. If a tracked native entity is
destroyed, its mapping can be reused at a later player arrival.

```powershell
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableVirtualWorld -MaterializeVirtualNpcs -VirtualPopulation 16 -MaterializeLimit 2
```

This is explicitly **opt-in**. Mapping is not yet durable across container
restart. Native NPCs retain their *own* stock EveJS names/behavior; the
virtual pilot name, faction, memories, and itinerary are **not yet
projected into the actual physical ship**. Virtual NPC routes update in
the background, but an NPC already spawned into a scene does not
automatically jump systems with the virtual record. This is a first
materialization bridge, not the completed autonomous Living Universe.

No physical NPC spawn happens just because time advances; a player in
the target system triggers the bridge. The native combat and loot engine
continues to own all physical interactions.

## Durable identity links for physical NPCs

The materializer now uses `coopIdentityRegistry.js` and stores virtual
pilot -> native entity ID links in
`/var/lib/evejs/coop-npc-links.json` on the existing EveJS data volume.
A second materializer instance or server restart will **reuse an existing
native ship only when the authoritative scene actually contains that entity**.
Stale links are pruned instead of resurrecting phantom NPCs. If the
authoritative scene cannot recover the original physical NPC after restart,
a subsequent player visit may create a replacement native NPC.

Each link records the virtual pilot's identifier, name and faction for
auditing. The current native EveJS spawn API is still responsible for the
physical NPC's displayed name, faction/standing metadata, loadout, AI and
combat. These virtual identity attributes are **not** yet pushed into the
stock NPC definition or client UI, and the registry is not an independent
physical-NPC persistence engine.

`node --test tests/coop-identity-registry.test.mjs` exercises restart reuse,
duplicate suppression, and invalid link rejection. This remains unverified
on the real two-client Docker server.

## Autonomous virtual NPC production and faction pressure

An optional `coopVirtualEconomy.js` advances once per minute alongside
the virtual world timer. Pilots receive stable roles (miner, hauler, trader,
patrol) in the separate, durable virtual simulation. Mining adds ore,
hauling converts available ore into goods, trading consumes goods and
records credits/demand, and patrols raise system security. A `recordLoss()`
API records bounded hostile losses, reduces security and increases demand.

All values live in `/var/lib/evejs/coop-economy.json` on the existing
EveJS volume. The elapsed-time catch-up is capped at 1440 ticks per
invocation to avoid large single-tick stalls after long downtime. Resource
balances are bounded and never negative.

Enable with the current virtual population and materialization overlay:

```powershell
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableVirtualWorld -EnableVirtualEconomy -MaterializeVirtualNpcs -VirtualPopulation 16 -MaterializeLimit 2
```

This is a **closed virtual accounting model**, not the authoritative EveJS
market or inventory. It does not issue player market orders, create real
mineral items, spawn physical transporters, debit player wallets or update
corporation standings. Its loss-event API is not yet connected to native
killmails, so battle outcomes do not automatically feed faction demand.
The virtual runtime still first initializes on a player's in-space login.
Native client/gameplay validation has not been performed.
