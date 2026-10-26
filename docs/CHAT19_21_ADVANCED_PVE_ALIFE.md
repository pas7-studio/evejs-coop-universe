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



## Stage P0-4B-2A — original NPC profile and loot-table binding audit

**Status:** Native source-reviewed / code implemented in stacked Draft;
source-only unit regressions PASS; **live gameplay/rare drops unproven**.

The original pinned `npcData.buildNpcDefinition(profileID)` resolves the
NPC profile's `lootTableID` and its loaded loot table. The original
`nativeNpcService` copies `profileID` and resolved `lootTableID`
onto the native transient NPC. Upon original native death,
`nativeNpcWreckService.destroyNativeNpcEntityWithWreck` copies those
values into the physical `npcWrecks` record. The new read-only
`coopPveBossLootProfileAudit` checks all of those values against the
previously **physically witnessed living boss**, the exact original
wreck, the current original profile, loaded
`getNpcLootTable`, and `buildNpcDefinition`. A table that exists
in the catalog but has no profile/wreck binding fails the audit.

For `mode: "rule"`, the audit reports the number of configured
positive-weight selectors, including configured special/faction/deadspace
grades. It **does not** claim that those selectors resolve to available
native items, that an RNG roll succeeds, that rare items dropped, or
that original itemStore transferred any item to a player. Actual item
pickup remains P0-4B-1 and the original EveJS native custody path.
There are no generated items, extra rolls, spawned NPCs or new payouts.

The pinned source includes a configured
`parity_deadspace_overseer_pending_loot` rule table with overseer and
rare-item selectors. Its **binding to an actually spawned boss NPC
profile is still unverified** without a loaded native NPC table or
disposable server acceptance. The large upstream
`npcProfiles/data.json` could not be extracted through the current
source connector; this PR intentionally does not guess a profile ID
or modify any original data assets.

The audit runs only after the already existing **post-native-wreck**
callback, using the existing shared world integration, no new scheduler.
It is OFF unless
`EVEJS_COOP_PVE_BOSS_LOOT_PROFILE_AUDIT=1`,
`EVEJS_COOP_PVE_NATIVE_BOSSES=1`, and
`EVEJS_COOP_PVE_SITE_DEFENSE=1` are all enabled. A mismatch produces
a read-only diagnostic, never a loot item or reward.

### Additional native item custody fixes

P0-4B-2A also closes two gaps in the P0-4B-1 optional journal:

- The final writer-lock release/directory fsync can fail **after**
  the JSON claim has been written. The writer now waits until **after**
  that cleanup before returning success. Any ambiguous final fsync
  yields `BOSS_LOOT_JOURNAL_UNSAFE`, never pre-grant permission.
- Each settled claim's final source remainder must match the next
  native source quantity. For example, `3 → 1` may continue from
  `1`, but a resurrected `2` is blocked. Two distinct original
  item IDs may be claimed separately by two characters, whereas two
  characters claiming the same original item slice are fenced.

The live pre-grant hook also refuses permission if
`EVEJS_COOP_PVE_BOSS_LOOT_FENCE=1` is enabled without the required
native boss / original native pickup evidence flags. This cannot
retroactively make the original EveJS grant and source debit atomic.
The journal remains opt-in and a native transaction/recovery operator
is needed before enabling it persistently.

### Evidence and remaining blockers

Exact-GitHub-branch isolated V8 tests: 62/62 inherited PvE and native
loot tests, 282 assertions; 10/10 new profile audit tests, 47
assertions; 13/13 durable simulated-fs journal tests, 47 assertions.
**85/85 isolated cases, 376 assertions** total. No full Node/Rust/
SQLite, physical disk power-failure, actual connected two-client cargo
race, pinned overlay roundtrip or rare-drop acceptance was run.
The tests with two players use synthetic claims, **not** real network
clients.

**Still pending P0-4B-2B:** load actual deployed native profiles and
candidate item pools, prove an authored boss is using the configured
loot table, kill it in a disposable live game, observe a real rare
item roll and native grant/debit through two clients, and run actual
power loss + restart reconciliation. P0-5 independent lawful mission
turn-in and personal rewards is a later stage.



## P0-5A — strict native two-person PvE mission reward preflight (Draft)

**State:** code prepared, original-source semantics inspected, isolated tests
PASS; full Node/SQLite/Rust and real two-client gameplay **NOT RUN**.

The project ALREADY has `coopFleetMissionJoin` (independent native
Request/Offer/Accept for a wingman), `coopMissionInstanceProvenance`
(durable link from two different mission sequences to the original
leader-owned dungeon), `coopFleetDungeonCredit` (native site-presence
proof and stock `shareCoopDungeonObjective`), and
`coopFleetMissionTurnin` (two independent original
`agentMissionRuntime.doAgentAction` calls with native payout journals
and a separate leader pre-payout fence). P0-5A deliberately reuses
ALL of them. It does **not** introduce another wallet, reward algorithm,
mission instance store, loot roll, native agent RPC or event clock.

New `coopPveDuoNativeRewardGuard` runs only on the **opted-in native
shared turn-in path**, just before the first native payout intent:

1. Requires `EVEJS_COOP_FLEET_MISSION_TURNIN=1`,
   `EVEJS_COOP_FLEET_LEADER_FENCE=1`, and
   `EVEJS_COOP_MISSION_INSTANCE_LINK=1`. A partial rollout fails
   CLOSED before the original captain's `DoAction`.
2. Requires two distinct connected native sessions, the same actual
   creator-led fleet and agent station (already checked by
   `coopFleetMissionTurnin.prepare`), and **two independently
   accepted and completed** personal native agent missions with
   different `missionSequence`, exact `agentID`, content,
   template and mission system. GM-completed, storyline projection
   and important-mission paths cannot use automated shared PvE payout.
3. Calls the original `dungeonRuntime.getInstance` BEFORE native
   leader payout. Requires the exact original leader
   `dungeonInstanceID`, source system, original
   `missionOwnerCharacterID` or mission owner metadata,
   `missionAgentID`, and genuine native completed objective/lifecycle.
   A manually toggled `objectiveCompleted` flag on the agent record
   is not sufficient.
4. Rechecks immutable `coopMissionInstanceProvenance.verify` and the
   *independently persisted* native `coopSharedDungeon` receipt on
   the peer using `nativeSharedObjectiveMatches`.
   Matching mission names or fleet membership alone cannot authorize
   an automated second native reward.

Once authorized, the original `beginLeaderFence` writes its existing
fsynced **PREPARED** intent BEFORE native leader `DoAction`. Native
EveJS owns all actual ISK, LP, items, standing, mission history and the
original leader mission deletion. On successful native leader turn-in,
the original EveJS implementation **purges the source dungeon**.
Therefore the second-player check MUST NOT demand that same live
instance again: it retains the source proof captured before leader
payout, and instead revalidates the exact native peer mission sequence,
source identity, both connected characters, durable link and native
shared-objective receipt. Only then may the original existing
`beginPeerSettlement` journal and second native `DoAction` execute.

The existing `LEADER_NATIVE_CLEARED` and
`BOTH_NATIVE_CLEARED` fencing transitions remain untouched. Only
after both native mission records are absent does an informational
`TWO_NATIVE_PERSONAL_MISSION_RECORDS_CLEARED` event appear. This is
**mission completion evidence**, NOT a direct wallet/LP or balance
delta. A native recipient payout failure or ambiguous journal leaves
the normal manual reconciliation requirement; there are no automatic
retries or compensating synthetic payments.

The new `EVEJS_COOP_PVE_DUO_REWARD_GUARD=1` flag is OFF by default.
Without it, existing vanilla solo agent completion and previous
cooperative behavior remain unchanged. This does not impose a universal
combat-damage requirement: native same-dungeon sharing may award
non-damage support roles, and the existing `coopPlayerCombatWitness`
receipts are **not** sufficient to claim a linked dungeon contribution
unless they are additionally matched to the original encounter.

### Evidence and release blockers

- 16/16 source-executed isolated V8 tests PASS, 59 assertions,
  including original dungeon ownership/completion, unique accepted
  agent mission sequence, provenance failures, disconnects, native
  numeric content IDs and valid peer completion after the source
  dungeon is purged.
- 9/9 initial source-wiring checks passed. Additional source-hook
  regression tests are part of this PR.
- Full `node --test`, pinned installer dry-run and byte-exact
  roundtrip, actual native agent two-client request/accept/dungeon
  completion/personal ISK-LP/standing audit, restart and interrupted
  payout reconciliation were NOT RUN. The overlay is not safe to
  enable on persistent servers without those checks.
- **P0-5B next:** actual per-recipient native reward-result/balance
  evidence and identity-safe two-client acceptance. Also pending is
  P0-4B-2B real rare loot and original inventory concurrent RPC test.



## P0-5B-1 — actual original personal ISK / LP / mission-history evidence (Draft)

**Status:** source-inspected and code-prepared; isolated test PASS;
native two-client wallet/LP/inventory/standing E2E **NOT RUN**.

Original pinned EveJS \`agentMissionRuntime.completeMission\` first calls
\`applyMissionRewards\`, which writes an original **ISK wallet journal**
(\`entryTypeID=3\`, \`referenceID=agentID\`), then potentially mints
original item rewards to the station hangar, applies native issuer-corp
LP and standing changes, and finally deletes the native accepted
mission and adds a personal \`completed\` mission-history row.
\`doAgentAction\` ultimately returns an agent **conversation**;
its \`success:true\` is **not** an independent wallet receipt.

New \`coopPveDuoNativeRewardEvidence\` **only reads** the native
\`walletState.getCharacterWallet\`,
\`walletState.getCharacterWalletJournal\`,
\`lpWalletState.getCharacterWalletLPBalance\` for the real agent
corporation, \`missionRuntimeState.getCharacterStateSnapshot\` history,
\`agentAuthority.getAgentByID\` and
\`standingRuntime.getCharacterRawStanding\` for that agent/corporation.
No new wallet, reward writer, independent itemStore, retry service,
mission database, scheduler, or direct ISK/LP/standing mutation.

With \`EVEJS_COOP_PVE_DUO_REWARD_EVIDENCE=1\` (default OFF, requires
P0-5A's guard), the already authorized native duo turn-in uses these
**two different** source snapshots:

1. Before the leader native DoAction, verify that original wallet,
   LP issuer, agent and mission history sources can be read and that
   wallet transaction IDs are unambiguous. Snapshot failure denies
   native co-op payout BEFORE the existing leader payout journal.
2. After the original leader native DoAction and mission deletion,
   require a **new unique native mission journal** with the original
   agent \`referenceID\`, entryType 3, proper NPC corporation and
   actual player, and a wallet balance delta equal to that exact
   journal amount. The original reward amount must be either the
   native mission base ISK or base plus the originally configured
   bonus (the latter is not guaranteed).
3. Check exact issuer LP balance delta against the original personal
   \`loyaltyPoints\` reward. Require one new native personal
   \`completed\` mission history entry with that exact personal
   \`missionSequence\`, agent, content and template. Standing snapshots
   are reported as observations; zero standing delta may be lawful.
4. BEFORE the second native payout intent, take an independent
   native snapshot for the **wingman**. After the wingman's original
   DoAction, verify *his own* native wallet journal, issuer LP delta
   and exact new personal mission-history entry before recording
   \`AWARDED\` and the leader's \`BOTH_NATIVE_CLEARED\`.
   Only after both pass does the read-only
   \`TWO_INDEPENDENT_NATIVE_WALLET_LP_AND_HISTORY_VERIFIED\`
   telemetry event appear.
5. Any missing, inconsistent, ambiguous or partially written source
   requires manual reconciliation. After a native award starts,
   this code **never retries it**, never compensates with virtual ISK
   or LP, and never falsely marks both recipients as settled.
   The original existing leader and peer fsynced payout fences remain
   in charge.

**Critical scope:** This receipt verifies source ISK, source LP and
native per-person mission history, **not** physical original item
reward custody or a standing **transaction** receipt. Real standing
values are read and their deltas shown, but a positive standing delta
is not always expected and cannot by itself prove a mission reward.
\`itemsVerified:false\` and
\`standingMutationReceiptVerified:false\` are explicit on the
individual native receipts. Follow-on P0-5B-2 must correlate original
itemStore deltas and native standing transaction row(s) where
applicable, and run two real network clients. It must not overstate
completion from a successful agent dialogue.

**Code evidence:** 15/15 original-source isolated cases (36 assertions)
for wallet journal references, balances, bonus branches, LP issuer,
new personal history, wrong agent/character, stale or duplicate journal,
no-standing change, partial payout, and zero-LP missions; plus 7/7
wiring ordering checks (22 assertions). **22/22 isolated checks, 58
assertions**. Full Node/SQLite/Rust, pinned overlay reversibility,
real payout receipt vs mission balance, live two-person gameplay,
crashes and actual item custody **NOT RUN**. The flag remains OFF.


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
