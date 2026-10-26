## Restart resilience (path B) — implemented 2026-10-26

### The gap, precisely
Startup mining fleets run in the proven **transient** mode. On a restart the
native rows (`npcEntities`, `npcRuntimeControllers`, `npcModules`, `npcCargo`)
are gone, the slot is re-seeded with new hull IDs, and the fleet starts its
cycle from zero.

The hauled ore itself is already durable: `coopNativeHaulCargo.transferCargo`
writes the hauler row with `transient:false`, `coopHaulFleetID` and
`coopHaulFromMinerID`, then flushes `npcCargo`. After a restart that row keeps
its native `cargoID` but still points at the **old** hauler entity, so it
becomes an invisible orphan and the new fleet never sees it.

### What is now implemented
`integration/coopHaulCargoAdoption.cjs` (default **OFF**, flag
`EVEJS_COOP_HAUL_CARGO_ADOPTION=1`), hooked once per `tickMiningFleet`:

1. `plan()` selects only durable, non-module rows where
   `coopHaulFleetID` and `coopHaulSystemID` both match this exact fleet slot,
   the row is younger than `EVEJS_COOP_HAUL_CARGO_ADOPTION_TTL_MS`
   (default 45 min), and its original `entityID` is neither a live ship in the
   scene nor still present in the native entity registry.
2. `adopt()` requires one live hauler, an idle `mining` fleet and a hauler that
   carries no durable haul cargo yet, then re-points each row to that hauler,
   preserving `cargoID` (so manifests, receipts and the ALIFE-13 audit keep
   their identity), stamping `coopHaulAdoptedAt` / `coopHaulAdoptedFrom`.
3. The write is only accepted after `flushTableSync("npcCargo")` succeeds;
   otherwise every row is restored to its original owner (no partial state).
4. The fleet is handed back to the normal `loaded -> routeFromHaul -> checkReturn
   -> warehouse -> sell` pipeline with `lastHauledVolumeM3` set from the real
   adopted volume, and `living-haul-cargo-adopted` records rows/quantity/volume
   with `invented:false`.

Never: new cargo IDs, granted station stock, invented destination, double
adoption (per-slot attempt counter, terminal after success).

`coopHaulSystemID` is now written at load time in both haul paths
(`coopNativeHaulCargo.transferCargo` and `coopNativeHaulTransferAtomic`).
Rows written before this change have no system field and are deliberately
skipped — provenance is not guessed.

### Measured restart behaviour (before this change)
`docker compose -p evejs restart server`, 10:34 UTC: all 4 systems
`NATIVE_SCENE_READY` within ~2 s, slot re-seeded (`fleet 1 mining miners 2
haulers 1`), warehouse receipts 18 before → 18 after, but
`lastHauledVolumeM3=0` and new ship IDs (in-flight state lost).

### Deploy note
The overlay installer is idempotent when the checkout contains *our* previous
overlay, but refuses a file that still carries an older overlay revision
(`DRIFTED`). The revert step is now:
`git -C <checkout> checkout -- server/src/services/mining/miningNpcOperations.js`
(only the drifted file), then `node scripts/patch-evejs-coop.cjs --code-path ...`
and confirm `OVERLAY_OK` (`patched 54`, `anchorMismatch 0`) before building.

### Tests
`tests/coop-haul-cargo-adoption.test.mjs`: 10/10 — disabled flag, real adoption,
registry-guard, cross-system/cross-fleet refusal, once-only, active-trip refusal,
already-loaded hauler, flush rollback, TTL expiry, hauler uniqueness.
