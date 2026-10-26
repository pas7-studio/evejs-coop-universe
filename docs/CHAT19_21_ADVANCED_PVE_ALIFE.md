# Chat 19 + 21 — Advanced PvE and A-Life site defense

**Status:** stage 1 code prepared; no native player-vs-NPC gameplay proof. All changes opt-in, default OFF. No new native spawn, currency, loot or client protocol.

## Native authorities and prior components

- `dungeonUniverseRuntime`, `dungeonUniverseSiteService`, dungeon instance/tracking and site spawn policies own authored anomaly encounters, objectives, rotation, and waves. Avoid a second site allocator or clock.
- `coopFleetMissionJoin`, `coopMissionInstanceProvenance`, `coopFleetDungeonCredit`, and existing native agent mission settlement own two independent mission identities and objective sharing; presence alone never earns money.
- `coopNpcTactics` and the one A-Life tick own existing physical NPC retreat and reinforcement orders. The world order arbiter retains its native lease and unknown-outcome fences.
- Native `GameStore`, `nativeNpcStore`, itemStore, original wreck records, and native wallet/LP/standing writers exclusively own physical loot and rewards.

## Stage 1 — player-triggered NPC self-defense (this PR)

Existing `coopNpcTactics` had an `authorizePlayerDefense` callback but `coopVirtualWorldRuntime` never supplied one, leaving player-triggered reinforcement forbidden by default. This PR wires it using `coopNativeConsequences.resolveVerifiedPlayerID` (native global session/account/ship admission) and the new pure `coopPveRetaliationGuard`.

With `EVEJS_COOP_NATIVE_TACTICS=1` **and** `EVEJS_COOP_PVE_NPC_RETALIATION=1`, the existing tactics loop may call in **already present allied NPC ships** only after a server-owned live controller records a matching native player's aggression within 120 seconds, the same physical ships remain on the scene, the attacker is still authentically logged in, and the aggressor is within 250 km of the victim. Same-faction role checks, NPC ammo gates, cooldowns, actual native attack/warp ACKs, and the existing retreat logic remain in force. A stale session, mismatched victim, expired event, absent responder, ambiguous ownership, or no native attack is denied. There are no invented waves or player-targeting patrols.

**Known limitation:** this is retaliation for named physical A-Life ships, not yet authenticated ownership of a static pirate base. The next stage must bind those ships to original site IDs before a site can direct reinforcements.

## Stage 2 — native authored-site defensive response (this dependent PR)

**State:** SOURCE_REVIEWED / ISOLATED_V8_TESTS_PASSED / INTEGRATION_HOOK_PREPARED / NATIVE_SERVER_AND_TWO_CLIENT_NOT_RUN.

The pinned EveJS dungeon site engine stores each physical encounter's genuine ship IDs in
`instance.spawnState.encounterStatesByKey[planKey].spawnedEntityIDs` after
`npcSpawnService.spawnNpcBatchInSystem` succeeds. It also creates physical
`universeAnomalySite` / `universeSignatureSite` beacons carrying
`dungeonSiteID` and `dungeonSiteInstanceID`. These fields, the full native
`dungeonRuntime.listActiveInstancesBySystem(systemID, {full:true})`, the actual
`nativeNpcStore.getNativeEntity` entry, and the native combat controller are the
authority for the new `coopPveNativeSiteDefense`; there is **no separate site registry**.

Only an active, shared, explicitly authored anomaly or signature with a live
matching beacon and at least two physically materialized, original **transient
nativeCombat** NPC hulls can request assistance. Source identity, system,
`typeID`, original spawn timestamp, encounter wave, faction/corporation, and
native controller must agree. Collision across two sites or waves, any already
claimed named A-Life/war NPC, abandoned spawn, or reused entity ID fails closed.
No original `spawnedEntityIDs` means **no defenders**, not free ships.

When a live controller proves that a real logged-in player ship attacked one of
these defenders within 120 seconds, one other *idle* same-site allied native NPC
may receive an original `npcRuntime.issueAttackOrder`. The native NPC service
still owns targeting, ammunition, locking, Dogma damage, kill and wreck. A
strict native `success:true` is recorded only as `NATIVE_SITE_DEFENSE_ORDER_ACCEPTED`,
**not** a hit/kill/wallet payout. Orders are limited to two/site/tick and four
overall/tick, with 120-second per-NPC cooldown. Ambiguous native ACKs halt
automated retry **for the lifetime of the process**. The controller must be idle;
this module never steals an existing native or named NPC manual order.

`EVEJS_COOP_PVE_SITE_DEFENSE=1` is an additional, default-OFF gate in the
**existing 30-second A-Life phase sequence**. It requires the normal Living World
tick already running; no separate timer, spawn engine, mission RPC, wallet or
inventory mutator. It does not automatically imply the earlier named-NPC
`EVEJS_COOP_PVE_NPC_RETALIATION` gate.

**Exact-source isolated tests:** 11 cases include native site-to-wave ownership,
real NPC order ACK, active/completed lifecycle, beacon mismatch, cross-site and
cross-wave ownership collision, recycled native entity identity, stale
aggression, fake/disconnected players, occupied controllers, ambiguous ACK,
per-tick replay control and reserved named hulls. They are NOT a full local
Node suite, installed pinned-code dry run, Docker/SQLite or client validation.

**Remaining risks:** No durable post-restart native attack-order journal;
after a crash, original native controller and encounter state must be inspected
before an operator authorizes resume. A native attack order success is not
damage or observed two-client gameplay. Original dungeon encounter triggers
already own finite waves; this PR does not add artificial waves, bosses,
escalations, wreck items or mission payouts.

### Manual P0-2 gate

1. Against an untouched pinned checkout run `node --test tests/coop-pve-native-site-defense.test.mjs`,
   original crossstream installer dry-run, byte-exact overlay roundtrip and
   `node scripts/patch-evejs-coop.cjs --check --code-path <Code>`.
2. Keep the flag OFF on the persistent world. In an approved disposable world,
   confirm an authentic dungeon anomaly materializes the site beacon and two
   original NPCs with matching native entity rows/controllers.
3. Enable the flag and have **player A** attack a proven defender. Confirm
   exactly one same-instance existing ally issues a native attack with real
   lock/shot/HP evidence. **Player B** must not be targeted merely by proximity.
4. Repeat with expired damage, site rotation/completion, two different sites,
   NPC death/reused entity ID, missing native store, existing manual orders,
   disconnect and unknown ACK. No extra ships or synthetic payouts.
5. Restart while the site remains active, verify reconciliation and absence of
   incorrect replay or duplicate NPC identity. Do not clean `evejs-data`.
6. Capture client-visible entry, NPC target selection, physical warp/attack,
   native wreck custody and two-player session evidence separately.


## Stage 3A — original authored encounter-wave rally (dependent draft)

**Status:** SOURCE_REVIEWED / EXACT_BRANCH_V8_TESTED / FULL_NATIVE_TWO_CLIENT_NOT_RUN.

The pinned native `dungeonUniverseSiteService.tickSceneSiteBehaviors` already owns timer, visible_countdown, wave_cleared, battleships_destroyed and proximity encounter triggers. It owns NPC spawning, completion, reward containers and native mission progression. P0-3A intentionally does **not** call `triggerSiteEncounter` or `spawnNpcBatchInSystem`: invoking them on generic player attack could bypass original authored prerequisites. Instead it physically rallies an already spawned NPC from a distinct active encounter-wave key within the *same original native dungeon site*.

`coopPveWaveReinforcements` reuses P0-2 `siteEntries` and reads the original `nativeNpcStore` entry, transient nativeCombat controller, typeID, corporation, creation timestamp, authored waveIndex and original spawn timestamp. A helper belongs to no other instance and is not a named A-Life/war-fleet hull. The trigger is a recent exact controller player aggressor admitted by native character, session and ship authority. Reserves must be idle, 250–2,000 km from the attacker.

Tick A orders a genuine `npcRuntime.warpToEntity` (maximum two across sites per existing 30s tick). Tick B+ demands real movement over 150 km from original position, elapsed time, no active warp, same site/hull, still-authenticated attacker and new distance under 200 km before a genuine `npcRuntime.issueAttackOrder`. Warp ACK is not arrival and attack ACK is not damage/loot/reward. Unknown outcomes, native refusals, expired aggression, site completion and ship reuse block further automatic orders. The P0-2 site director now excludes P0-3A leased helpers to avoid fighting for the same native hull.

Enabled ONLY by `EVEJS_COOP_PVE_SITE_DEFENSE=1` AND new default-OFF `EVEJS_COOP_PVE_WAVE_REINFORCEMENTS=1`; uses the original Living World phase registry and overlay installer without another timer or site allocator. Any rewards remain original native custody, not handled here.

**Crash limitation:** order leases and unknown-outcome fences are process-local. After restart, only original native source state and operator reconciliation can authorize safe continuation. Do not enable on a persistent world until durable native-order reconciliation is implemented and tested.

**Evidence:** 10/10 new and 12/12 inherited site tests executed in the exact-branch V8 harness; 11 source-wiring checks verified. Full Node tests, pinned overlay roundtrip, Docker native game and two-client E2E **NOT RUN**. The feature is code-prepared, not gameplay-complete.

**P0-3B next:** authentic static pirate objective defense and NPC hold/regroup/retreat, without unauthorized target creation. P0-4 boss, original wreck/loot and P0-5 per-player lawful mission payouts remain pending.



## Stage 3B — native pirate objective defense, regroup and retreat (dependent Draft)

**Code-prepared; native server / two-client NOT_RUN.** The pinned EveJS
`dungeonUniverseSiteService.spawnEncounterKillableStructures` creates original
`siteKillableStructure` entities with original `dungeonSiteID`,
`dungeonSiteInstanceID`, `dungeonEncounterKey`, physical position and
`structureHP`, plus a record in the same encounter's `spawnedEntityIDs`.
The P0-3B `coopPveObjectiveDoctrine` uses this **exact** source ownership
with the P0-2 site ledger and the original NPC store/controller. A random
objective marker, generic container, environmental prop, dead structure or
different-site structure cannot authorize attacks, warp, or orbit.

The policy only issues ORIGINAL `npcRuntime` orders:

- **DEFEND:** a nearby healthy original NPC may attack a player ONLY when
  its original native controller records that exact recently authenticated
  player as an aggressor. The objective must still physically exist within
  150 km of the defender, and player must be within 250 km of objective.
  This is a defender aggression witness, NOT evidence the structure took
  damage.
- **HOLD:** with no authorized target/site proximity, don't override native
  NPC combat orders; no fake hold-fire command or invisible damage.
- **REGROUP:** when idle, far enough from an original physical killable
  objective (20–120 km), with a verified visitor within 200 km but NO
  recent verified aggression, issue an original `npcRuntime.orbit` request
  around the exact structure. ACK is not proof that native orbit completes.
- **RETREAT:** if actual native ship armor is below 28% or structure below
  72%, recently attacked by an authenticated player, *not* warp-scrambled,
  and a physical original station or gate exists over 500 km from attacker
  and at least 150 km from the NPC, issue original `npcRuntime.warpToPoint`
  to that actual waypoint. No invented safe location; ACK is not arrival.

The guard refuses another native order if a helper is leased by P0-2,
P0-3A, named A-Life tactics or the existing native order arbiter. It has
no independent timer. Native definitive rejection and unknown response
remain process-local nonreplayable per NPC; restart reconciliation is
**still required**. No original damage, loot, mission objective, wallet,
standing, or player ship mutation happens in this module.

Activation: `EVEJS_COOP_PVE_SITE_DEFENSE=1` plus new default-OFF
`EVEJS_COOP_PVE_OBJECTIVE_DOCTRINE=1`. The explicit phase is
`native-pve-objective-doctrine` inside the existing 30-second A-Life
combat group, and the only overlay installer registers the new module.

**Isolated verification:** 12 new original-source tests and 22 inherited
site/wave tests, 34/34 cases total with 170 assertions as first combined
check; 14 phase/installer/source-wiring checks. Follow-up validations
may update these numbers. Full Node/SQLite/Rust, pinned installer
roundtrip, native damage/warp and two-client gameplay NOT_RUN.
The minimum controlled live test must verify a destructible original
objective, authentic native controller hit, objective guard command,
actual orbit/warp motion, health-threshold retreat, no cross-site
interference, no extra spawn, no fake reward and safe restart handling.

P0-4 actual authored bosses and original wreck/loot remain pending.
P0-5 independent duo mission acceptance and native reward settlement
remain pending.


## Next stages and acceptance

| Stage | Implementation target | Must be evidenced before DONE |
| --- | --- | --- |
| P0-2 authored sites | Join native anomaly/dungeon `instanceID`, `siteID`, `systemID` and actual materialized pirate defenders; react to real player damage on the same site | Two real players find and enter an authored anomaly; no phantom sites or cross-instance NPC aid |
| P0-3 wave defense | Reuse native dungeon encounter plans for finite waves and deterministic spawn caps; A-Life chooses support posture from local supply and threat; no competing scheduler | Native wave spawned, damaged and destroyed; no extra ships after restart or re-entry |
| P0-4 boss and retreat | Boss is an original authoritative native NPC hull with actual modules, HP, fuel/ammo, behavior changes and a real wreck; fallback to retreat when scrambled/low hull | Orders, actual damage, physical warp/standdown, no scripted kill |
| P0-5 co-op objective and payout | Two separate native character mission receipts with genuine site completion, optional verified combat contribution, one-at-most settlement and original itemStore source/destination custody | Both clients independently see only lawful rewards; reconnect and crash replay never mint duplicates |
| P1 escalation | Enable only when pinned native escalating-path builder returns real authored stages; never fabricate the currently empty rowset | Durable native stage chain, objective and reward with no repeated claim |
| P1 balancing | Different pirate site doctrine, scouts, guard rotations, logistics and aggression memory through existing A-Life | NPC reactions differ by supplies, site danger and observed player actions |

## Manual gates

1. Local Node: `node --test tests/coop-pve-retaliation-guard.test.mjs tests/coop-npc-tactics.test.mjs`; then full overlay dry-run/roundtrip only against an untouched pinned test checkout.
2. Disposable world: start with new flag OFF, verify no player retaliation; flag ON, have authenticated character A damage a real named NPC and observe only pre-existing same-faction ally responding. Character B does not become a target merely by being in the same fleet.
3. Force stale aggressor timestamp, duplicate session, hull swap, disconnect, friendly fire, unavailable ammo, warp scramble, no safe retreat point and a 250-km displacement. Deny new attacks without proven original aggression.
4. Observe successful order **and** native weapon/HP outcome independently. Check retreat arrival and first-party client rendering. This module's six isolated tests are *not* native gameplay evidence.
5. No CI, remote deployment, `main` merge or live-world flag change as part of this PR. Preserve `evejs-data`.
