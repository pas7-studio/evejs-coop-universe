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



## Stage P0-4A — source-authored native overseer/boss, real HP phases and wreck witness

**State:** Source-reviewed / implementation in dependent Draft / isolated tests PASS;
full server and two-client live **NOT_RUN**. This is not yet the complete P0-4
boss-and-loot gameplay acceptance.

Pinned EveJS `dungeonUniverseSiteService` is the **only** authority to
materialize a dungeon encounter. It writes original `encounterStatesByKey`
with `spawnedEntityIDs`, `spawnedAtMs`, `waveIndex`, `label` and
`lootTags`. This P0-4A module selects only a uniquely identified native
combat ship in an explicitly boss-, overseer-, officer- or commander-tagged
original encounter. Ambiguous multi-NPC waves, missing tags, foreign
instances and missing native transient controller/ship/store evidence are
NOT interpreted as bosses. No self-allocated NPC, new encounter trigger,
manual spawn, loot table edit, synthetic HP or bonus bounty.

`coopPveNativeBossDirector` samples genuine
`damage.getEntityCurrentHealthLayers` against native maximum HP and
recognizes **GUARD** (healthy), **PRESSURE** (armor/structure at or below
65%) and **LAST_STAND** (armor/structure at or below 30%). These are
A-Life threat-policy *observations*, not alterations to native hull
resistances, firing rate, shield repair or authored dungeon wave
progression. When in PRESSURE/LAST_STAND and the original controller has
a fresh, independently authenticated attacker nearby, an otherwise
idle native boss can receive at most one
`npcRuntime.issueAttackOrder` per phase. A receipt means
**native order ACK only**. In-progress or ambiguous orders are not retried
automatically. Protected original boss hulls are excluded from overlapping
site, wave and objective directors.

For a boss actually witnessed alive in the current process, disappearance
of both physical hull and native entity record is NOT proof of a kill.
The module searches **nativeNpcStore.listNativeWrecks** for exactly one
physical `nativeNpcWreck` whose stored `sourceEntityID`,
`sourceTypeID`, `launcherID`, `systemID`, `transient` state and
creation time match the original observed boss. It then reads
`listNativeWreckItemsForWreck` and verifies unique native item IDs,
source wreck IDs, locations, item types and positive quantities.
An original wreck with **zero** items is explicitly reported as
*empty*; unknown, duplicate or inconsistent records are NOT promoted to
loot proof. There are no item grants, wallet transfers, LP/ISK credits,
or special rare drops in this module. Only original engine
`nativeNpcWreckService.destroyNativeNpcEntityWithWreck` can create
such a wreck with its actual source-backed native loot.

**Gates:** `EVEJS_COOP_PVE_NATIVE_BOSSES=1` (default OFF) and
`EVEJS_COOP_PVE_SITE_DEFENSE=1`; otherwise no P0-4A work.
The new phase `native-pve-boss-wreck` is part of the existing Living
World combat group, with no independent timer and one overlay installer.

**Terminal instance reconciliation:** a source-verified boss may die and
cause the native instance to complete or rotate immediately. A previously
witnessed original boss is still eligible for native wreck reconciliation
in the SAME process after that site leaves the active list. A completed
site with no prior live witness is never newly accepted as proof. This
is a read-only terminal check; it cannot recreate the original boss.

**Limitations:** Original boss wave must explicitly expose its source
label/loot tags and uniquely identify a single live ship; existing
multi-ship overseer waves cannot be guessed. Wreck witness history and
order fences are process-local; a server restart needs stronger original
persisted kill/event reconciliation. Observation of a wreck is not
item custody or a verified loot transfer to either player. Loot table
coverage, actual native boss behavior, destruction events and two-client
payouts still require tests and further stages.

**Evidence:** Exact-branch isolated V8 original-source verification
48/48 cases across P0-2, P0-3A, P0-3B and P0-4A, 232 assertions, and
14/14 source-wiring checks PASS. Full `node --test`, pinned overlay
roundtrip, Node/SQLite/Rust native gameplay and real two-client E2E
NOT_RUN. Do not enable in persistent game before those checks.

**Next P0-4B:** original loot table coverage and owned item pickup E2E,
proving one death -> one actual wreck -> exactly the native items
available through original inventory service, no cloned drop or repeat
grant. Then P0-5 lawful separate two-player reward eligibility.



## Stage P0-4B-1 — original boss wreck → original player cargo pickup

**Implementation:** dependent Draft; **safe to deploy only after** full
native Node, pinned overlay, actual two-client inventory and restart
acceptance. There are NO new spawns, loot rolls, item grants, ISK/LP
payouts or invented item types.

### Source of truth

Pinned EveJS `nativeNpcWreckService.destroyNativeNpcEntityWithWreck`
creates the original wreck + item rows, then deletes the source NPC,
spawns its actual physical wreck, and calls the existing co-op destruction
hook. The P0-4A `coopPveNativeBossDirector` now uses that **native post-death
hook** to capture the exact original item manifest as soon as it is
available, after a prior live authored-boss witness. The boss witness
requires the exact original dungeon encounter, transient nativeCombat NPC
and its source hull/type/site IDs. A never-seen boss or unmatched wreck
cannot be retroactively certified.

The existing `nativeNpcWreckService.transferNativeWreckItemToCharacterLocation`
uses the game's real `grantItemToCharacterLocation`. Its existing
`coopNativeLootPickupEvidence.verify` checks the post-transfer source
debit, destination inventory delta, a physical original wreck, exact
character session and current in-space ship. P0-4B-1 reuses that
existing verified result and checks `wreckItemID`, `typeID`, exact
source NPC/wreck and quantity against the *original pre-loot boss manifest*.
Only this complete chain produces
`ORIGINAL_BOSS_ITEM_PICKUP_VERIFIED`. Item pickup is never inferred
from a kill, reward-container creation or a player opening the wreck.

### Durable pre-grant replay fence (separate OFF gate)

The original native transfer grants a new inventory item BEFORE it
removes/decrements the wreck's source row. It is not a single atomic
debit/credit transaction. To avoid a second blind grant of the same
original boss item after a crash/unknown debit, this PR adds an optional
`coopPveBossLootClaim` pre-grant hook in the single pinned native
`nativeNpcWreckService`. The hook is source-literal checked and
reversible through the existing overlay installer.

The claim is keyed by `wreckID:wreckItemID:sourceBeforeQuantity`,
written to a persistent, fsync'd journal and directory with an
interprocess non-stealable writer lock **before** the original itemStore
grant. A PENDING or ambiguous claim cannot be replayed, even after
restart or by another pilot. On an independently verified native source
debit and authenticated destination inventory delta, the exact claim is
marked SETTLED. A legitimate subsequent partial pickup can use the
next, smaller actual source quantity; the first source slice cannot
be issued again. A disk error, stale lock, incomplete temp file,
journal corruption or unknown outcome blocks the claim pending
explicit operator inspection. The claim module never manipulates
original EveJS items or player wallets.

**Limitations:** this is fail-closed replay prevention, **not** a native
atomic transfer or rollback. If an original initial grant succeeds
but the source debit fails, one already-granted mismatch may still
exist; the fence prevents another retry but cannot restore inventory.
A boss dying before any live A-Life witness, or a world restarted before
a boss death receipt, is **not** protected by the boss-specific claim:
such unclassified wrecks stay on the original native transfer path.
A durable, original transaction boundary and replay-recovery tooling
remain release blockers. Do not sell this as global item dup protection.

### Flags

All default OFF, with exact `"1"` enablement:

- `EVEJS_COOP_PVE_SITE_DEFENSE=1`
- `EVEJS_COOP_PVE_NATIVE_BOSSES=1`
- `EVEJS_COOP_NATIVE_LOOT_EVIDENCE=1`
- `EVEJS_COOP_PVE_BOSS_LOOT_PICKUP=1` (observation only)
- `EVEJS_COOP_PVE_BOSS_LOOT_FENCE=1` (durable pre-grant barrier; requires the observation gates)
- Recommended existing `EVEJS_COOP_NATIVE_LOOT_QUARANTINE=1`, to block known original source mismatches

Journal path defaults to
`/var/lib/evejs/coop-pve-boss-loot-claims.json`; override only
with a persistent, writable absolute path via
`EVEJS_COOP_PVE_BOSS_LOOT_FENCE_FILE`. Do not auto-delete
`.writer.lock` or `.tmp-*` after a failure.

### Evidence / next acceptance

62/62 **isolated V8** exact-branch PvE / boss / original-loot-witness
test cases, 282 assertions, plus 10/10 isolated durable-claim tests,
34 assertions with a simulated fsync-capable filesystem; total
72/72 and 316 assertions. Pinned upstream source confirmed one
original `grantItemToCharacterLocation` anchor, post-native wreck
spawn-before-death hook, and one original source-debit order.
No full local Node suite, actual disk power-failure test, pinned
overlay roundtrip, real inventory RPC, two-client play or restart
acceptance has run.

Pinned source includes the genuine
`parity_deadspace_overseer_pending_loot` rule table with nonempty
overseer/faction selectors. This does **not** establish that the
requested NPC profile binds to it or that any rare item actually
dropped. Native item IDs and loot rolls remain unchanged.

**Next:** P0-4B-2 original profile/loot-table coverage and two-client
item pickup E2E, native GameStore atomic settlement or recovery operator
verification. P0-5 independent mission acceptance and lawful
per-player reward are still pending.


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
