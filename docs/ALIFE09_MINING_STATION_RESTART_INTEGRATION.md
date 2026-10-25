# ALIFE-09 — native mining → hauling → physical station compatibility

**Status:** source fixes committed; isolated JS checks PASS; full local Node and two-client physical E2E NOT_RUN. Default OFF. Tracks P0 native economic chain.

## Confirmed faults in merged ALIFE-07 / ALIFE-08

1. **Installer conflict.** ALIFE-08 replaces stock `spawnFleetWing` `transient: true` with a conditional persistent-miner branch. The physical-station layer (`coop-native-station-arrival-patch.cjs`) searched only the old stock line and threw `STATION_ARRIVAL_ANCHOR_DRIFT`, preventing overlay installation on the pinned mining source.
2. **Restart breaks cargo custody.** Original `createMiningFleetRecord` assigns `fleetID: nextMiningFleetID++` from an in-memory counter (reset on restart). The persistent ALIFE-08 slot witness previously saved native ship IDs but NOT `fleetID`. Original cargo delivery and station manifests require the exact `coopHaulFleetID`, so after a restart an unchanged original cargoID might never match the newly numbered fleet.

## Native source fixes

- `coop-native-station-arrival-patch.cjs` now preserves ALIFE-08 native miner/hauler identity and combines it with the independent real-station hauler flag: `durableHauler || (coopDurableNative && EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE)`. When disabled, ordinary NPCs stay transient. Uninstall restores precisely the ALIFE-08 expression instead of vanilla stock.
- `coop-native-mining-stable-fleet-id-patch.cjs` introduces a startup-only stable ID `systemID * 32 + slot`, checked as a safe positive integer, and uses that native fleetID in the original `createMiningFleetRecord` rather than allocating a new ID every restart. Ordinary GM fleets continue to use the original sequential counter.
- `coopNativeMiningFleetDurable.cjs` saves the stable fleetID in the original `npcEntities.coopMiningFleetSlots` ACTIVE witness, verifies it before any materialization on restart, rejects duplicate runtime fleet IDs and rejects legacy ACTIVE witnesses without a durable fleetID. It does not silently migrate old cargo/warehouse receipts or create new cargo.
- The original installer removes the physical-arrival overlay first, then the stable-ID shim, then validates/reinstalls ALIFE-08 and earlier overlays. This is necessary both on repeated installs and complete uninstall.

## Verification and reproducibility

- Full `patch-evejs-coop.transform` of the exact pinned original EveJS mining source: **LF PASS, CRLF PASS**, with JS parse, repeated install producing byte-identical content, and full byte-exact revert to pristine source. Tested through an isolated JavaScript execution of the actual installer and its native mining patchers.
- ALIFE-08 persistent NPC lifecycle mocked checks: **15/15 PASS**, including hauler cargo stamp preserved after restart and rejection of old/tampered slot witness.
- ALIFE-09 station/fleet compatibility checks: **7/7 PASS** (source transformation/logic in injected JS sandbox).
- Physical local server, SQLite database crash tests, two real clients, original NPC mining/hauler/station arrivals: **NOT_RUN**.

Safe Windows command (only isolated tests and clean pinned source inspection):

    pwsh -File scripts/Run-Alife09-Native-Mining-Station-Gate.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

The original `Code` path must be a **clean pinned source** for SHA preflight, not a previously patched copy. No Docker command or protected `evejs-data` write is performed by this runner.

Six physical scenarios with evidence requirements remain NOT_RUN in `tests/scenarios/native-mining-station-restart-alife09-e2e.json`.

## Activation guardrails

Use **only on disposable EveJS data and a single original authoritative GameStore process**. Do not enable these together on protected game data until real local crash/restart/physical arrival evidence passes:

    EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY=1
    EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION=1
    EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
    EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC=1
    EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1
    EVEJS_COOP_NATIVE_HAUL_CARGO=1
    EVEJS_COOP_NPC_STATION_DELIVERY=1

**Known limitations:** the ALIFE-08 actor slot PREPARING→ACTIVE flush is not a single FULL-power-loss-atomic transaction; crash-ambiguous slots remain `NEEDS_OPERATOR_REPAIR`. The station warehouse credit uses a separate durable receipt and physical arrival proof; cross-process authority and true crash-at-every-boundary have not been established. A legacy ACTIVE slot created before this change is deliberately quarantined rather than silently replayed with the wrong fleetID.

## Release criteria

Full local Node tests green; pinned overlay preflight green; physical miner and hauler retain same native IDs and stable fleetID over two cold restarts; ALIFE-07 source and cargo records match one original ore debit and cargoID; real hauler physically arrives and unloads only after the station arrival gate; one native warehouse COMMITTED receipt and one stock credit; no duplicate goods or phantom ISK; both co-op clients observe the same hulls.
