## Session state — 2026-10-26 (latest)

### Change layering (binding, also in AGENTS.md)
We own every change in this repo; the EveJS checkout is never the source of truth.
- **L1** stock bug/omission → `patches/upstream/NNN-*.patch`, applied by
  `scripts/apply-upstream-patches.cjs` (pin + sha256 enforced, idempotent, `--repeat-safe`,
  `--only`, `--reverse`).
- **L2** co-op rule → `integration/*.cjs` + one hook line in `scripts/overlay-spec.cjs`.
- **L3** stateful mechanism → runtime phase/module, never a string patch.
Order is L1 → L2 → `OVERLAY_OK` → build. `docs/UPSTREAM_PATCH_SERIES.md`.

### Capacitor root cause (settled 11:30)
`MODULE_ACTIVATE_FAILED ... NOT_ENOUGH_CAPACITOR` was **not** a data problem only:
- `0002` gives native NPC hulls a real `rechargeRate` (SDE has 500000–1000000 ms).
- but the only code that advances capacitor is runtime.js **module-cycle
  bookkeeping**; a sessionless NPC that failed one activation has no cycle, so its
  capacitor never moved. Chicken-and-egg.
- `0003` advances the CCP curve `dC/dt=(10*Cmax/tau)*(sqrt(r)-r)` (1% floor) in the
  NPC controller tick (`npcBehaviorLoop`), both tick loops.
Live proof after deploy: fleet 2 miners `cap1 capmax900`, fleet 1 climbing from
`0.035` with module `17482` needing `capacitorNeed=23` of `capmax 250` (9.2%), so
mining resumes instead of stalling forever.

### Restart resilience (path B)
- Haul cargo persists for transient haulers only when
  `EVEJS_COOP_HAUL_CARGO_ADOPTION=1` (otherwise the old conservative behaviour).
- `integration/coopHaulCargoAdoption.cjs` is now the **owner's** version (batch
  `ownerID` validation, rollback of every attempted row + re-flush,
  `ADOPTION_RECOVERY_UNVERIFIED` operator hold) plus: shared telemetry
  (`coopObserve`), once-per-slot status lines, and a rolled-back batch no longer
  consumes the once-only slot (16/16 tests).
- Store caveat: the pinned `nativeNpcStore` does not export `listNativeCargo`;
  patch `0001` fixes it, and the module still falls back to
  `gameStore.read("npcCargo","/cargo")`.
- L1 row provenance: `coopHaulSystemID` is written at load in both haul paths.

### Ops notes
- The overlay installer is idempotent for *our* overlay; a checkout that still
  carries an older overlay revision must be restored with
  `git -C <checkout> checkout -- <drifted file>` before reinstalling.
- The patch applier is idempotent: re-running on an applied series prints
  `PRESENT` and never re-applies.
- `docs/WORKLOG.md` is the traceable log: `node scripts/log-change.cjs --layer …
  --why … --evidence …`; `--check` audits.

### Next
1. Read `restartAcceptance3.log`: needs `DURABLE_HAUL_ROWS > 0` with
   `coopHaulSystemID`, then `living-haul-cargo-adopted` after the restart, then a
   normal trip/sale.
2. If the durable table stays empty after a real load, the blocker is the
   `db.setTransientPath` + `flushTableSync` path (`living-hauler-cargo-persist-failed`).
3. Then L3 durable slot journal (`systemID, slot, fleetID, minerIDs, haulerIDs,
   cargoIDs, tripPhase, updatedAt`) + one boot `reconcile` phase, so adoption is
   journal replay instead of heuristics.
