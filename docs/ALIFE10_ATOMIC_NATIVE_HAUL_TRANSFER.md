# ALIFE-10 P0 — atomic original native NPC ore handoff

**Status:** native code and regression tests committed; physical EveJS E2E NOT_RUN; feature flags default OFF. Protected evejs-data untouched.

## Confirmed original defect

The historical coopNativeHaulCargo.transferCargo reparented native cargo via upsertNativeCargo and only afterward cleared a temporary transient path and flushed the GameStore cache. On failure the cache could show ore in a hauler without a confirmed durable record, while the miner could continue mining.

## Native cargo transaction

1. Confirm original persistent NPC miner + hauler scene, same system, exact durable slot, original stable fleetID, native entity/controller and owner roles.
2. Read one original non-transient cargoID and source quantity from the authoritative original nativeNpcStore. No cargo allocation or new ore.
3. In one original GameStore coopAtomicNativeRows SQLite transaction, CAS source native cargo row and reparent the SAME cargoID to the hauler in the npcCargo cargo root.
4. In that same transaction, write an immutable coopNativeHaulTransfer:<cargoID> COMMITTED receipt with SHA-256 beforeHash and afterHash and original owner/source/fleet/target identity. No prior receipt may be overwritten.
5. Enforce and verify SQLite synchronous=FULL before BEGIN IMMEDIATE, then check original native cargo readback. Update both live ship cargo lists only after all validations pass.
6. For any unknown outcome, mark miner/hauler/fleet for operator repair and block further ALIFE-07 mining on that miner. Never mint a new stack or blindly retry after ambiguous COMMIT.

## Rollout

Strict path is selected only for original persistent ALIFE-08 startup fleets. Standard transient and GM routes retain historical behavior. If durable fleet mode is enabled but atomic handoff is not enabled, persistent hauling is BLOCKED instead of falling back to cache-before-flush transfer.

Enable only in an isolated disposable world:

    EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
    EVEJS_COOP_NATIVE_HAUL_CARGO=1
    EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1
    EVEJS_COOP_NPC_STATION_DELIVERY=1
    EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC=1

Prior ALIFE-07 atomic source/cargo flags remain mandatory for the complete asteroid-debit-to-market pipeline.

## Safe local tests

    pwsh -File scripts/Run-Alife10-Native-Haul-Atomic-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

The runner tests mock atomic custody, route selection, real disposable node:sqlite WAL/rollback/reopen, existing station/warehouse/mining regressions and optional read-only pinned original-source verifier. It does not start Docker, mutate live data or touch evejs-data.

Nine physical game-world scenarios in tests/scenarios/native-haul-transfer-atomic-alife10-e2e.json remain NOT_RUN.

## Known release blockers

- The original GameStore atomic bridge currently rejects any active npcCargo transientPaths in the table, including unrelated transient NPC cargo. This is fail-closed; mixed persistent/transient isolation needs separate proof before safe relaxation.
- ALIFE-08 slot PREPARING→ACTIVE actor creation is not one FULL-durable multi-table transaction; ambiguous recovery remains operator-repair.
- Only one authoritative GameStore owner process has been supported; multi-process writers are not proven.
- Miner→hauler is NOT station settlement. Actual physical canonical station arrival, native warehouse item credit, two-client state and multiple real cold restarts must be demonstrated before enabling on preserved worlds.
