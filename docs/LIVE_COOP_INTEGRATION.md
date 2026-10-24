
## Native EveJS industry and emergent piracy — current preferred path

Instead of programming a second mining engine, LivingCoop now enables the
**existing pinned EveJS NPC mining fleets**:

- \`EVEJS_MINING_NPC_STARTUP_ENABLED=true\` with **one fleet per configured
  system**, **two native miners and one native hauler**. Mining modules
  select real mineable asteroid entities, deplete rocks using native mining
  runtime, and produce actual ore stacks in \`nativeNpcStore\`.
- Available durable virtual miner and hauler identities are bound to
  **those real EveJS ships**, and no generic hostile-profile NPCs are
  spawned as substitute workers. The virtual world continues to own
  names, histories, injuries and faction bookkeeping; EveJS remains
  authoritative for the physical ships, real ore, weapons and wrecks.
- \`coopNativeHaulCargo.js\` changes the pinned native haul handoff:
  instead of simply erasing ore at pickup, the SAME cargo item IDs are
  transferred from the miner's native NPC cargo record to the
  hauler's native NPC cargo record. A destroyed loaded hauler therefore
  carries lootable ore through EveJS's unchanged wreck service.
  Once the hauler reaches its origin, cargo unloads into a
  **virtual depot sink**. Stock EVE station inventory, wallet and market
  transactions are not yet credited.
- \`coopNativeRaids.js\` periodically notices miners/haulers already
  carrying ore and commands **existing named pirates** to warp to the
  target and, when in range, attack using native \`npcRuntime\` orders.
  These orders never create new NPC enemies, force destruction, or
  change ship HP directly. The pinned mining fleet AI independently
  tracks aggression and can dispatch its stock response wing.
- \`coopWorldSignals.js\` reports organically triggered piracy through
  the existing EveJS local chat system, informing players in-system
  about a real conflict they can investigate. It does not spoof an
  NPC speaker or announce fictional wins.
- To fit a brief co-op session, the stock hauler is eligible after
  3 minutes rather than its 90-minute default; minimum trip spacing
  is 10 minutes, with the stock ore capacity threshold tuned to 20%.
  These are pacing settings on existing EveJS behaviors, NOT arena waves.

The current configuration remains opt-in under \`-LivingCoop\`.
\`-Action CoopStart\` chooses that mode by default. The legacy scripted
encounter director remains a separate explicit developer-only option.

**Current realism boundary:** ore extraction, finite rocks, NPC cargo
handoff, native combat, native wreck loot and fleet aggression response
are integrated in source. The simulated depot is not connected to the
EveJS market or real station inventory. Stock native mining fleets are
transient and must be restored by the EveJS startup rules when scenes
load. Real remote-client/TLS and two-client battle behavior still
need live Docker verification before gameplay can be declared proven.



## Current preferred mode: free-roaming Living Universe (supersedes arena mode)

**The game-night CoopStart mode intentionally does not create NPC waves.**
The two human pilots join one shared native EveJS server and encounter a
pre-existing population of durable named NPC pilots. The NPC population
includes miners, haulers, traders, patrols and **native hostile pirates**.
These entities live under their own virtual economy, faction policy and
occupation; their physically materialized ships are created only through
the authoritative EveJS NPC runtime.

On an already visited solar system, the server maintains up to six
materialized pilots under the current default configuration. NPC ships
execute native movement toward real belts, stations and gates; when a
pirate is engaging a combat target, scheduled work-route orders defer to
its authoritative NPC controller. Names shown in space include role
labels such as [Pirate] or [Miner].

After a confirmed native NPC wreck, the named pilot receives a
persisted 30-minute clone/ship recovery cooldown in the coop-npc-life.json
state file. This applies even without the optional virtual economy
enabled. Every native wreck is deduplicated. Background reconciliation
revisits previously observed systems every two minutes, making
recovered NPCs eligible to return without a player relog.

An active physical NPC ship stays pinned to its actual EveJS system:
the virtual clock can no longer teleport that pilot to another system
while the physical ship is alive. Off-screen virtual pilots still plan
inter-system travel; a full physical stargate transition for NPCs
remains unfinished.

The *old* developer-only native NPC demo, proximity-gated co-op arena
and encounter wave director are **not enabled by CoopStart**. Their code
remains for explicit internal testing only. Follow
[PLAY_COOP_NOW](PLAY_COOP_NOW.md) instead.

**Honest simulation boundary:** autonomous worker routing, native combat,
wreck creation and loss recovery are integrated in code; real mining
resource transfers, physical item-bearing hauler cargo and market orders
are still not hooked to EveJS authoritative inventory/market systems.
Real two-client gameplay has not yet been confirmed on the host.
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
rapid retries if a spawn fails. A persisted per-system 24-hour spawn cap avoids unbounded accumulation
without permanently exhausting encounters for players returning on later days. Restarting the server reloads this schedule.

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
The 30-second virtual-world tick now starts from the pinned EveJS TCP server
startup hook. It advances even if no player has logged in.

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
The virtual runtime now initializes on the game server startup path.
Native client/gameplay validation has not been performed.

## Confirmed NPC losses affect the virtual economy

When a demo NPC is actually destroyed and its matching native EveJS wreck
appears, `coopCombatProbe` passes the authoritative `wreckID` and source
`NPC ID` to `coopNpcLossBridge`. The bridge stores a durable processed
wreck ledger in `/var/lib/evejs/coop-loss-ledger.json` and invokes
`coopVirtualEconomy.recordLoss` once. A restart or repeated wreck
observation cannot normally double-count the same wreck. The economic
effect raises virtual demand and reduces system security.

Enable both `-EnableNativeNpcDemo` and `-EnableVirtualWorld
-EnableVirtualEconomy` on a disposable local instance to exercise
this path. No direct EveJS market orders, wallets or ship inventories
are changed.

The ledger deliberately reserves a wreck before updating the economy:
a crash between the reservation and the economy update can leave a
`PENDING` record requiring manual reconciliation. It favors preventing
duplicate loss accounting over promising exactly-once atomic commits
across two separate JSON files. This is not a full transactional system.
The materialized virtual-pilot NPC path is not yet wired to this
callback; the integration currently observes demo NPC combat only.

## Materialized virtual NPC → confirmed wreck → virtual economy

The `coopVirtualWorldRuntime` materialization path now attaches the same
native combat/wreck observer used by demo encounters. Each unique
materialized NPC ship ID receives a bounded 180-second observer; when the
actual native EveJS scene contains a matching wreck, it passes the
source NPC and wreck IDs to `confirmedWreck()`, which records the loss in
the persisted virtual economy when enabled.

This connects materialized virtual pilots' **physical ship destruction**
to the existing economic loss accounting. It does **not** yet mark the
virtual pilot permanently dead or prevent a future ship replacement;
the virtual identity registry currently prunes destroyed physical
links. A kill after the 180-second observation window is not captured
by this instrumentation. The next engineering step should replace
time-limited sampling with a lifecycle event hook in the native NPC
destruction service, plus durable per-pilot death/recovery state.

## Direct native destruction hook (replaces time-limited loss dependency)

The reversible installer additionally patches the pinned
`nativeNpcWreckService.js` immediately after successful native wreck
creation, before the dungeon encounter callback. This invokes
`coopVirtualWorldRuntime.confirmedNativeNpcWreck(systemID,npcID,wreckID)`.
The handler reads the durable identity registry and **only** accepts a wreck
whose ship ID and system match a materialized virtual NPC identity. It then
uses the existing durable wreck loss ledger and virtual economy.

Unlike the temporary 180-second combat observer, this direct hook can
capture deaths that occur later while the server is running. Damage,
loot, wreck generation and client notifications remain owned by EveJS.
The hook is optional/fail-open and removed by the same installer with
`-Remove`.

The older combat observer remains useful for diagnostic state samples;
it is no longer required to capture a later native wreck in the
materialized NPC path. Actual runtime execution is not yet verified.

## Durable faction response to native NPC losses

The `coopFactionDirector.js` runs as part of the optional virtual economy.
A confirmed native wreck from a registered virtual NPC drives one
deduplicated faction incident: system-level threat and patrol priority rise,
and faction replacement-ship demand increases. These values survive restarts
in `/var/lib/evejs/coop-factions.json` on the existing EveJS data volume.

The director periodically advances virtual replacement plans. A system must
report sufficient **virtual goods** to fulfil demand. Completed plans increase
virtual faction readiness; they do **not** yet create physical replacement
ships or debit actual EveJS inventory. The virtual goods snapshot currently
acts as a *supply gate*, not a stock debit, so treat readiness as a planning
metric rather than completed resource-conserving production.

Enable using both `-EnableVirtualWorld` and `-EnableVirtualEconomy`.
Materialized native NPC casualties are linked by the existing identity
registry and loss ledger; unrelated stock EveJS NPC kills are not attributed
to our virtual factions. The real EveJS reputation, crimewatch, and market
remain unchanged. The module must still be validated on the running server.

## Faction strategy → native physical patrols

The opt-in `coopFactionPatrolRuntime.js` reads faction plans when a
pilot enters a system. For factions with `patrolPriority >= 20` and at
least one virtual readiness unit, it may create an actual NPC ship
through pinned EveJS `npcRuntime.spawnBatchInSystem`.

Deployment is bounded: **at most two observed live patrol ships per
system per game-server process**, with a five-minute spawn cooldown.
It checks existing native entity IDs before replacing destroyed ships.
The module does not bypass native damage, NPC controllers or wreck
creation.

```powershell
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableVirtualWorld -EnableVirtualEconomy -EnableFactionPatrols -VirtualPopulation 16
```

This is intentionally a limited bridge, **not yet a production faction
military service**: physical patrol ship IDs are process-local, virtual
readiness is a planning signal rather than inventory debit, stock
`npc_hostiles` is used regardless of faction, NPCs do not escort actual
haulers or traverse gates, and deployment only occurs upon a player's
in-space arrival. It is disabled unless explicitly enabled. Validate
client combat/faction behavior in Docker before treating these NPCs as
persistent strategic assets.

## Native patrol movement orders

Earlier versions of the faction patrol bridge issued `npcRuntime.orbit()`
orders around the arriving player's ship. **This behavior is superseded**
by POI-based native warps under `coopPatrolNavigator.js`. This is not a persistent patrol
route, convoy escort, target selection, or attack command. The default
orbit distance is 10 km. A per-NPC two-minute cooldown prevents repeated
logins from spamming movement commands. Dead/despawned entities are
ignored. The command never applies synthetic damage or bypasses EveJS
movement/visibility.

Patrols now navigate real stargates/stations/belts instead of choosing
players as movement anchors. The default pool is still `npc_hostiles`, meaning the native
AI can engage according to its own settings. Do not enable this opt-in
mode on a shared production game server before live gameplay validation.
A later revision should anchor patrols to native stargates/POIs instead.

## Native routes and working NPCs — October 24 integration

This milestone replaces the earlier **player-centered orbit** demonstration.
The pinned EveJS `npcService.spawnNpcBatchInSystem()` requires a valid
`anchorDescriptor` or `anchorEntity`; previously some co-op spawns supplied
neither, yielding `ANCHOR_REQUIRED` instead of real NPC ships. All three
co-op spawn paths (demo encounters, virtual pilots, and faction patrols)
now resolve actual stargate, station or celestial anchors from EveJS's
authoritative `scene.staticEntities` via `coopNpcTopology.js`.
If a system lacks a valid anchor, the module refuses to spawn there;
it never falls back to fictional zero coordinates.

### Gameplay behavior
- Native faction patrols now rotate between real stargates/stations/belts
  using `npcRuntime.warpToPoint` where the next POI is at least 250 km
  away, or orbit an actual in-scene POI when nearby. Their route is advanced
  on the **server's 30-second world tick**, after the initial scene encounter,
  even with no players connected.
- Materialized virtual NPC workers receive real movement orders: miners
  approach asteroid belts; haulers alternate between belts, stations and
  gates; traders follow station/gate circuits; ordinary patrol-role pilots
  visit gates and stations. EveJS executes the physical warp and orbit.
- Newly initialized virtual populations have reproducible, unique
  callsign/surname pairs (100 unique names for the supported 100-pilot cap).
  Existing saved world files retain their established identities and names.
- `coopNpcPresentation.js` writes the saved name onto the native EveJS
  ship entity and uses the same slim-item notification channel as the
  upstream wreck service to update connected observers.
- Virtual miners/traders/patrols have native auto-aggression disabled in
  their spawn behavior overrides, so merely entering their system does not
  intentionally issue a hostile player attack.
- The reversible patch adds delayed presence handling for actual **undock**
  and **stargate arrival**, not only login-in-space. The world simulation
  itself now starts in the TCP server's startup path (after the existing
  TiDi initialization) and continues ticking without player logins.

### What these changes do not simulate
A physical hauler moving to a station **does not automatically transfer
items**, and a miner orbiting a belt **does not mine actual ore yet**.
Virtual economy production remains a separate bookkeeping model.
Physical NPC gate jumps between star systems, sustained NPC memory,
true security/crimewatch responses, faction-specific loadouts, escort
contracts and real EveJS market orders still need native integrations.
Old NPCs spawned before this patch will not automatically gain their
missing native anchors. Full client behavior remains unverified.

To use the broader local demo on the pinned EveJS revision:

```powershell
cd C:\Games\EveCoopProject
git pull
.\scripts\Deploy-Coop-RuntimeProbe.ps1 -EnableVirtualWorld -EnableVirtualEconomy -MaterializeVirtualNpcs -EnableFactionPatrols -VirtualPopulation 16 -MaterializeLimit 2
```

There is no need to run a new test suite after every feature to author
more functionality. The new modules' JavaScript syntax and a mocked
native-API route/anchor smoke run were checked; **Windows PowerShell,
Docker startup and two real EVE clients have not yet been validated**.

## October 24 co-op gameplay corrections

The first-play `CoopStart` mode uses **two-player live grid matchmaking**
(`coopDuoCoordinator.js`), rechecking server-owned ship positions every
four seconds after login/undock/jump. Both clients may warp to the same grid
later without relogging. The native NPC only spawns for two distinct,
Ballpark-ready pilots within 250 km, and no new batch is created while a
previously tracked enemy NPC remains in-scene.

Repeatable encounters have a durable cooldown (12 minutes by default)
and a renewable 24-hour spawn budget (20 batches by default). A failed
native spawn retries no more often than once per minute. The native EveJS
wreck creation hook releases the tracked NPC and logs
`coop-encounter-kill`, so kills remain observable even when the temporary
combat sampler has ended. The `Party` action reports co-op wreck kills
alongside scene presence and reciprocal visibility.

Docker operations in the game-night script now consistently include
`compose.coop-probe.yaml` whenever it exists. Loopback-only port checks
also apply to the merged Compose configuration. Real client gameplay
is still not certified until the authorized EVE clients are run.
