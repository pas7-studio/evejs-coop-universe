# ALIFE-04 — Proof that stock EveJS NPC miners actually extract native ore

**Status: implemented source-level witness; live physical gameplay NOT RUN.**
No new mining scheduler, cargo/ISK writer, owner, crew, asteroid generator, mine-command interceptor or spawned NPC. This is an opt-in read-only observer on the existing EveJS stock mining and 30-second co-op world tick.

## Root-cause correction

Earlier live diagnostic for Perimeter 30000144 reported a stock native fleet with state="mining", rock distance 18–20 km, and combat controllerTarget=0. **That metric alone cannot prove mining failure**. Pinned upstream EveJS miningNpcOperations.tickMiningFleet uses *scene target locks* via scene.getTargetsForEntity and scene.finalizeTargetLock, assignedAsteroidIDsByMinerID, and native ship.activeModuleEffects, rather than just npcRegistry.currentTargetID. The previous coopNativeIndustry observer traced the combat controller field and could make the fleet look idle despite native extraction targets.

Still, state="mining", visible hulls, nearby belts or previously accumulated cargo do NOT prove live extraction either. Verify a same-miner, same-target physical ore change.

## New witness

integration/coopAlifeNativeMiningWitness.cjs accepts a verified loaded scene, stock native mining fleet records and nativeNpcStore getters. It reads:
- Real SpaceRuntime.scenes Map. The original pinned runtime has **no getScene(systemID) method**. Do not create scenes with ensureScene from read-only diagnostics.
- Active native NPC ship, durable nativeNpcStore entity and owner, not attached to player session.
- Actual asteroid itemID, isMineableStaticEntity + original getMineableState, one activeModuleEffects targetID on the rock, matching scene lock, and matching per-miner assigned rock if present.
- Native durable ore cargo (categoryID 25, moduleID 0), exact cargoID, ownerID, typeID, quantity.

**NATIVE_ORE_GROWTH_CONFIRMED** is emitted only when two consecutive eligible samples from the same native miner and same rock target have a positive cargoID quantity delta. It is evidence of same-hull physical ore growth across sampling, not a new item grant and not proof of all future haul/manufacturing steps. First sample, old preloaded cargo, zero delta, a transferred/shrunk stack, missing target lock, no effect, wrong system/owner, transient cargo, duplicate cargoID, or player ship do NOT count.

Bounded at 12 miners and two already loaded native systems each existing 30-second tick; no additional timer. Quiet active-but-no-delta samples are logged once every ten ticks. Named blockers are emitted on other observed statuses; source payload includes fleetID, miner entityID, asteroid target, active module IDs and cargoID deltas. Optional feature flag **EVEJS_COOP_ALIFE_MINING_PROOF=1** is OFF by default and additionally requires EVEJS_COOP_ALIFE=1, EVEJS_COOP_NATIVE_MINING=1 and the preexisting virtual world setup. All feature flags remain as before.

## World gate

The existing script now supports an additive *explicit* flag, with unchanged default semantics:

    node scripts/coop-world-report.cjs --system-id 30000144 --require-mining-yield < copied-coop-events.jsonl

The gate returns AWAITING_NATIVE_MINING_YIELD until a credible positive cargoID/rock/effect event appears within the same system, topology and evidence window. It exposes nativeMiningYield (samples, confirmed sample count, ore quantityDelta, latest blocker) separately from combat and NPC movement.

### Safety and limitations

- A positive cargo delta is an *observation of physical source cargo*, not a receipt proving the exact extraction engine invocation. Full production causality requires original mining cycle/asteroid resource consumption receipts and live visual verification.
- This observer **does not fix** any genuine underlying miner target-lock, fitted mining module or spawn problem. It identifies the actual missing proof or blocker so we can patch native code after reproducing it.
- This is in-memory consecutive-sample evidence, not a durable replay-protected stock ledger. After restart it re-baselines and cannot claim prior yield.
- The system does not create native escrow, warehouse stock, items or ISK and does not authorize a sell/buy action.
- This new standalone PR is based on current main. Existing #107 and #110 each modify the one-line overlay module copy list; preserve all three independent helpers when merging.

## Tests and verification

In this development session, **25/25 focused source-level tests passed in isolated JavaScript execution**:
- 15 mining witness / native cargo identity and negative target-lock scenarios.
- 6 strict world report / false success and system-isolation scenarios.
- 4 wiring, bounded read, manifest and pinned overlay assertions.

For full native Node regression locally (not executed here):

    pwsh -File scripts/Run-Alife-Native-Mining-Tests.ps1

Six physical local E2E cases are defined as NOT_RUN in tests/scenarios/alife-native-mining-physical-e2e.json. They cover real mining module lock/asteroid, two-tick cargo delta, fail-closed effects, source owner identity, miner→hauler→warehouse same cargo ID and two clients. Test on disposable local world and preserve evejs-data.

**No full Node suite, physical EveJS server or two-client mining gameplay was run in this remote GitHub workflow.**
