# ALIFE-12 — native mining hauler physical station route after crash / cold restart

**Status: Draft, feature OFF.** Implemented original source code, tests, disposable filesystem/SQLite gates; **12 real game/two-client E2E scenarios NOT_RUN**. Protected Docker volume `evejs-data` never modified.

## Native defect proven on current main

Original `coopNativeMiningFleetDurable` ALIFE-08/09 reconstructs original native ship IDs and stable `fleetID`, but the station director held `fleet.coopStationArrival` and per-hauler arrival dwell exclusively in process memory. A crash after a native successful station warp lost the route, while original `createMiningFleetRecord` returned to a newly initialized mining state. Naively rerunning route start could issue another warp / start another manifest.

## Native solution

- New `integration/coopNativeStationTripJournal.cjs`: after each original native `warpToPoint` returns a positive ACK and **all** real hauler warps succeed, fsync an immutable `trip-departure-acks/<systemID>-<fleetID>-<startedAt>.json` witness. Source manifest is already durably PREPARED before the warp. Exact source hash, original cargo IDs, hauler IDs, system, station owner and original start time are included. A failed ACK journal write leaves the fleet blocked for operator repair; never infer success or rewarp.
- With `EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=1`, manifest enabled, persistent native mining enabled, and **paid escort flag OFF**, the station director may reconstruct exactly one pending route from the original immutable `trip-manifests` record, its separate fsynced departure ACK, exact current native cargoID source rows or committed native warehouse receipts, original native hauler entities and canonical station. **No warp command, cargo allocation, ISK grant or warehouse credit occurs during recovery.**
- The original physical station director starts a new dwell period after cold restart. A recovered ship must actually reach the original native station, stop, and satisfy the original 2-second dwell before any real warehouse deposit. The original deadline is not extended.
- Restored ALIFE-08 persistent haulers carrying original fleet-stamped ore return to native `loaded` state, not another mining cycle, and original `checkReturn()` attempts read-only recovery instead of declaring no active route.
- Read-only recovery fails closed on missing warp ACK, unsupported manifest, duplicated route, changed owner, different cargo quantity/type, missing warehouse receipt, lost native ship, foreign cargoID, wrong system, changed station or expired original route.

## Feature gates — disposable world only

    EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1
    EVEJS_COOP_NATIVE_HAUL_MANIFEST=1
    EVEJS_COOP_NPC_STATION_DELIVERY=1
    EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=1

ALIFE-07/10/11 source, atomic hauling and transient-isolation flags are still independently required for the complete original asteroid→warehouse economic chain. Paid escort routes already have their own financial/route witness system; ALIFE-12 does **not** activate in that mode.

## Automated verification

- `tests/coop-alife12-station-trip-journal.test.mjs`: 17 real temporary directory filesystem tests, with the original `createManifest.read` validator and a separate native ACK journal. Cover immutable identity, wrong receipt/source, missing ACK, duplicate trips, absent native actor, partial and fully committed original cargo, read-only restart.
- `tests/coop-alife12-station-trip-recovery.test.mjs`: 8 station director integration cases using real director source and injected original native domain mocks. Cover no second warp, physical arrival/dwell, lost ACK quarantine, lost station and unchanged original deadlines.
- `tests/coop-native-mining-fleet-durable.test.mjs`: 2 extra restored original cargo/fleetID cases (existing suite retained).
- Isolated JS harness performed: 17/17 FS mock-injected source cases PASS, 8/8 director integration cases PASS, and 17/17 original durable fleet mock cases PASS. **Full Node suite not yet run on user's machine**.
- `scripts/Run-Alife12-Native-Station-Restart-Tests.ps1` runs the new and existing native mining, ALIFE-10/11, station, warehouse and original GameStore SQLite tests. Source pin check is optional and read-only.

Windows command (clean pinned upstream, no Docker or game DB mutation):

    pwsh -File scripts/Run-Alife12-Native-Station-Restart-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

`tests/scenarios/alife12-original-station-route-restart-e2e.json` contains 12 **NOT_RUN** physical local scenarios for original native mining, source→hauler→station itemStore proof, two clients, two crashes and repair gates.

## Unresolved release restrictions

1. A cold restart **after the last native cargo row disappears but before its warehouse COMMITTED receipt** can leave no cargo on the hauler. The normal ALIFE-08 startup cargo check may not inspect a pending earlier manifest until it next enters the station route. Do **not** claim a fully proven fail-closed end-to-end restart in this interval; requires a startup audit of all historical pending receipt chains.
2. Original NPC actor PREPARING→ACTIVE creation remains a separate crash boundary; no single multi-table whole-world transaction exists.
3. True physical warp continuation after native sessionless warp restart, two live clients, station sale-path, cross-process writer isolation, durable warehouse proof and power loss across every storage boundary are **NOT_RUN**.
4. A missing or uncertain ACK cannot be automatically repaired, acknowledged retrospectively or rewarped; it requires original native operator reconciliation.
5. Do not enable on protected `evejs-data` until disposable physical evidence passes.
