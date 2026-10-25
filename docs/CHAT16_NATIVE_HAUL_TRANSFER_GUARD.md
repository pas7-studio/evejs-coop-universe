# CHAT-16 - Native NPC miner-to-hauler physical cargo custody

Status: CODE_READY, LIVE_UNVERIFIED. Pinned upstream: gameboys84/EveJS c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f.

## Boundary
Existing EveJS miningNpcOperations mines asteroids into original nativeNpcStore cargo rows. ALIFE-07 commits asteroid debit and miner cargo together through original SQLite. ALIFE-08 makes mining NPC ships persistent. The separate ALIFE-09 work covers stable fleetIDs across restart and compatibility with physical station routing. This change does NOT repeat those systems. Existing coopNativeStationArrival + coopNativeHaulManifest + coopNativeWarehouse already own warp, station surface arrival, full-trip manifest and tagged itemStore station credit.

This change only tightens the already existing `integration/coopNativeHaulCargo.cjs:transferCargo` path, without allocating cargo, spawning ships, creating markets, or changing director scheduling. Enable explicitly in a disposable test world with `EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD=1` AND `EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC=1`, `EVEJS_COOP_NPC_STATION_DELIVERY=1`, `EVEJS_COOP_NATIVE_HAUL_CARGO=1`. Defaults OFF and preserves old native transfer when OFF.

## Strict transfer rules
- Both NPC ship identities and ownership corroborated by physical scene and nativeNpcStore; same system and mining fleet, alive, not warping, persistent; source/destination within 2.5 km of surface distance.
- Original cargoID must have exactly one store row with positive typeID, quantity and ownerID equal to miner; moduleID 0; ore category 25, with exact cached miner quantity and pinned-SDE ore volume.
- Hauler capacity must come from authoritative resolved hull type (or injected native capacity resolver); existing persistent hauler cargo also consumes capacity. Never split a source cargoID or invent a virtual stack to make space. Skip the full stack when no suitable hauler exists.
- Re-parent the SAME cargoID through existing nativeNpcStore.upsertNativeCargo, clear transient path, flush original GameStore npcCargo, check exact identity readback; move in-memory cache only after confirmation.
- Ambiguous ACK/flush/readback: mark both scene actors and fleet for operator repair, do not automatically replay. No isolated ledger or parallel economic stock created. Existing original station manifest/warehouse remains the only permitted physical delivery mechanism.
- A successful handoff does not itself imply arrival, unloading, market availability, salvage rights, or player-visible success. Damage/destruction during transfer and post-crash repair require physical acceptance.

## Limitations and required gates
This is not a cross-database crash-atomic transfer: the nativeNpcStore row and GameStore flush are used, but no full independent crash journal is added. If a process dies exactly between the row update and flush, a read-only operator comparison of native asteroid receipts, original cargo row, source/destination actors and the existing full-haul manifest is mandatory before re-enabling. Any legacy preexisting transient cargo, corporate mixing or unsupported resource types fail closed in opt-in mode. Do NOT enable on the preserved evejs-data volume before actual disposable-world source and restart tests.

Tests: `node --test tests/coop-native-haul-transfer-physical.test.mjs` (12 local tests). Test fixtures are isolated in-memory nativeStore shapes; not actual server or client gameplay. Also run existing `tests/coop-native-hauler-persistence.test.mjs`, ALIFE07/08/09 tests, physical station/manifest tests, and a pinned installer roundtrip with the new module file. Do not use remote CI.

Physical acceptance cases not performed: asteroid physical depletion -> native miner cargo -> hauler physical approach -> original cargoID exact transfer with capacity -> native warp/dwell -> warehouse COMMITTED and tagged itemStore owner stock -> consecutive restarts -> destruction & wreck provenance -> return and new mining cycle -> two independently authenticated players and headless operation. Never report these as PASS on isolated Node tests.
