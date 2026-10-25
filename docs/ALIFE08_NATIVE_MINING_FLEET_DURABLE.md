# ALIFE-08 — Durable native miner / hauler startup identity and recovery

**Status:** DRAFT / implemented source patch and guarded restorer; local physical E2E **NOT_RUN**. Tracks #125. Complements ALIFE-07 PR #124 (not merged as of initial preparation).

## Observed pinned EveJS

- Original miningNpcOperations.spawnFleetWing sets transient:true for every stock fleet. Original nativeNpcService already supports transient:false and stores original native entity, controller, modules and cargo.
- The EveJS restoration entrypoint is nativeNpcService.materializeStoredNativeController(scene, originalEntityID, {broadcast:false}). It reconstructs the same hull from nativeNpcStore.
- Original startup mining fleet bookkeeping is in-process; simply turning transient false would respawn another miner/hauler after a process restart.
- Original cleanupStaleNativeStartupControllers destroys records with startupRuleID. Durable mining uses operatorKind (not startupRuleID) to tag physical native actors.

## Opt-in behavior

Enable **only in a disposable local test world**:

    EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1

1. Original startup scene handler defers to coopNativeMiningFleetDurable when opted in. It bypasses legacy retry and convoy renewal; GM spawns and ordinary NPC encounters are unchanged.
2. Before any spawn, original GameStore gets npcEntities.coopMiningFleetSlots[systemID-slot] = PREPARING; synchronous flush is required.
3. A true original miner wing and original hauler wing spawn with transient:false, tagged operatorKind coop-mining-systemID-slot-miner or -hauler. Their entity, controller, fitting and cargo rows remain authoritative in nativeNpcStore.
4. Verify each native ID, owner, system, operatorKind, controller and cargo custody, and flush original native GameStore tables.
5. Set the durable slot witness ACTIVE with exact original entityIDs, then register the original mining fleet exactly once.
6. On restart, require ACTIVE witness and all listed real native records; restore missing physical hulls with original materializeStoredNativeController. No allocator or spawn on recover.
7. PREPARING, orphan marked actors, missing controllers, forged actor owner, invalid cargo, missing hull or extra marked actor produce NEEDS_OPERATOR_REPAIR and **no automatic replacement**.
8. On an ACTIVE destroyed fleet, recovery remains blocked until a separate proved destruction/replenishment design is implemented. Never auto-spawn based on a missing ship.

## Safety boundaries and known limitations

- This is **one authoritative GameStore owner process** mode. In-process duplicate callbacks are guarded. Parallel independent GameStore processes are **not supported** and can bypass the cache-level slot-preparation lease.
- A GameStore synchronous flush is not a guarantee of full power-loss durability under the pinned SQLite synchronous=NORMAL config. ALIFE-07 requires FULL for its source/cargo commit, but stock actor/slot creation is not yet in a single cross-table FULL transaction.
- A crash during partial spawn permanently quarantines PREPARING; it does not automatically destroy or reclaim physical NPC entities or cargo. Operator repair is required.
- Source patch is pinned to EveJS commit c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f and must be rejected on a different pinned source.
- Restore only reconstructs state that the original nativeNpcStore persisted. Prove actual asteroid, module, owner and cargo conservation in local gameplay.
- Preserve Docker volume evejs-data. Do not enable/merge as production-ready until tests confirm restart and single native physical custody.

## Safe validation

    pwsh -File scripts/Run-Alife08-Native-Mining-Durable-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

The runner includes ALIFE-08 isolated tests and non-destructive existing mining/recovery checks. Source preflight only reads pinned upstream. It does not start Docker or mutate game data.

Physical acceptance: 12 scenarios listed in tests/scenarios/native-mining-fleet-durable-e2e.json, all NOT_RUN.

**Release gates:** Real original miner -> ALIFE-07 SQLite atomic source/cargo -> native hauler transfer -> #110 warehouse COMMITTED receipt -> restart twice with unchanged owner, hull IDs, one cargo chain, no duplicates, two clients; real WAL power-loss testing and single-writer deployment proof required.
