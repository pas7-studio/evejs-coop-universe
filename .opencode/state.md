## Session state — 2026-10-26 (latest)

### Change layering (binding, also in AGENTS.md)
We own every change in this repo; the EveJS checkout is never the source of truth.
- **L1** stock bug/omission → `patches/upstream/NNN-*.patch`, applied by
  `scripts/apply-upstream-patches.cjs` (pin + sha256 enforced, `--apply|--reverse|--branch`).
- **L2** co-op rule → `integration/*.cjs` + one hook line in `scripts/patch-evejs-coop.cjs`.
- **L3** stateful mechanism → runtime phase/module, never a string patch.
Order is L1 → L2 → `OVERLAY_OK` → build. `docs/UPSTREAM_PATCH_SERIES.md`.

Series now: `0001` export `listNativeCargo`, `0002` native NPC capacitor recharge rate
(replaces the deleted `coopNpcCapacitor` top-up hack; last good check: `OVERLAY_OK`,
patched 54, anchorMismatch 0, `tests/upstream-patch-series.test.mjs` 4/4).

### Restart resilience (path B)
- Haul cargo is now persisted for transient haulers too **only when**
  `EVEJS_COOP_HAUL_CARGO_ADOPTION=1`; without the flag the old conservative behaviour stays.
- `integration/coopHaulCargoAdoption.cjs`: `plan()` accepts only durable rows whose
  `coopHaulFleetID` **and** `coopHaulSystemID` match the slot, younger than TTL (45 min),
  whose old entity is neither live in the scene nor in the native registry. `adopt()`
  needs one live hauler, idle `mining` fleet, empty hauler; re-points preserving `cargoID`,
  requires `flushTableSync("npcCargo")` success (else rolls back), then hands the fleet to
  `loaded -> station -> sell`. One line per status (no tick spam), 2 s throttle, 120 tries.
- Store caveat: the pinned `nativeNpcStore` does **not** export `listNativeCargo`; read the
  table via `gameStore.read("npcCargo","/cargo")` (patch `0001` fixes the export).
- 11/11 tests in `tests/coop-haul-cargo-adoption.test.mjs`.

### Evidence so far
- Restart (10:34): 4 systems `NATIVE_SCENE_READY` in ~2 s, slot re-seeded, warehouse
  receipts 18 → 18, but `lastHauledVolumeM3=0` (in-flight state was lost).
- First adoption attempt (10:53): `INVALID_AUTHORITIES` every tick → root cause found
  (missing export) and fixed. Second attempt (11:01) proved `living-hauler-loaded`
  happens but the durable table was still empty **before** the persistence change.
- Acceptance run in flight (`restartAcceptance2.sh`): deploy → wait for a real load →
  restart → assert `living-haul-cargo-adopted` and durable rows with `coopHaulSystemID`.

### Next
1. Read `restartAcceptance2.log`: if `DURABLE_HAUL_ROWS 0` after a real load, the
   `db.setTransientPath` flush path is the blocker (`living-hauler-cargo-persist-failed`).
2. Then L3 `durable slot journal` (`systemID, slot, fleetID, minerIDs, haulerIDs, cargoIDs,
   tripPhase, updatedAt`, fsync per phase change) + one boot `reconcile` phase, so adoption
   becomes journal replay instead of heuristics.
