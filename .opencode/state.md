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

### Measurement correction (2026-10-26T11:50Z)
- **The authoritative cargo store is SQLite**: `/var/lib/evejs/gameStore/gamestore.sqlite`,
  table `npcCargo`, key `cargo` holding the whole row map as JSON. The old
  `gameStore/data/npcCargo/data.json` is legacy and always looks empty.
- So `DURABLE_HAUL_ROWS 0 / rows_total 0` in `restartAcceptance3.log` was a
  **measurement bug in my script, not a failed write**. The probe now lives in
  `scripts/coop-cargo-probe.cjs` and reads SQLite read-only.
- First correct reading (11:48Z): 2 durable haul rows, `fleet1`, `sys30000145`,
  `transient:false`, `coopHaulFromMinerID` set, quantities 11340 + 18739.
  That is the write path working; the restart-survival proof is still missing
  because both rows were written *after* the restart.
- Real live events from that run: `living-hauler-loaded` (11:43:40, fleet1,
  qty 22483/22484) and `living-economy-destination CHOSEN station 60014935`
  (11:44:21) — mining and the fleet's own choice of delivery station work.
  No `station-sold` yet.

### L1 / repo corrections (2026-10-26T12:05Z)
- `git ls-files patches` was **empty**: `.gitignore` line `upstream/` also matched
  `patches/upstream/`, so the whole atomic L1 series lived only on disk while
  the docs claimed it was versioned. Fixed with an explicit exception; the
  series is now tracked and pushed.
- The applier cannot verify two patches for the same file (both directions
  pass), so the follow-up capacitor patch was folded into
  `0003-native-npc-sessionless-capacitor.patch`: sessionless advance **and** the
  hull recharge rate resolved at use. `--check` **converges** (it applies), it
  is not a dry run. Both rules are now in `docs/UPSTREAM_PATCH_SERIES.md`.
- Live after the fix (12:03Z): fleet 2 miners still report
  `NOT_ENOUGH_CAPACITOR` at ratio 0.03, but the sequence shows
  `MINER_NOT_IN_SCENE_OR_WARPING` between every attempt and a **new miner ID
  every 1-2 min** (13953 → 14058 → 14178). Ships are being re-materialised and
  re-warped in Perimeter, so recharge never gets a chance: the next blocker is
  that churn, not the curve.
- `coopWarObjectiveDirector` was never copied by the overlay, so a live world
  phase failed on every cycle; registered, and
  `tests/coop-overlay-dependencies.test.mjs` now fails if the copy list and the
  require graph disagree.

### Churn is the current blocker (2026-10-26T12:26Z)
- The capacitor sweep now really runs: `FLEET_POST_TICK` shows real
  `tau` (125000-187500 ms) and `reAt` set by the scene sweep, so patch 0003's
  advance is no longer limited to ships that happen to own an NPC controller.
- But **no ore was produced for 20+ minutes** and the miners are replaced every
  20-40 s: live IDs 14397 → 14715 → 14780 → 14864, each ship spawning at
  `cap 1` in `WARP`.
- Decisive evidence: the SQLite table `npcRuntimeControllers` has 264 rows, and
  **zero** for any entity above 980000014000 - every newly spawned miner has no
  runtime controller. The native mining tick prunes ships without a controller,
  and the startup/boot path spawns them again.
- `EVEJS_COOP_MINING_STARTUP_RETRY=0` did not stop it, and enabling
  `EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=1` did give stable fleet IDs
  (960004641 = 30000145*32+1) but the ships still had no controller, so the
  probe compose was restored to its previous state.
- `living-headless-boot-system NATIVE_SCENE_READY` fires for four systems every
  minute, so scenes are re-created repeatedly; that plus the missing controller
  is the loop to break. This is ALIFE-08 territory (owner's active area).

### Next
1. `scripts/restart-acceptance.sh` (versioned) snapshots SQLite cargo, restarts,
   and prints `VERDICT`/`RESTART_PASS`; it accepts cargo already in flight
   (`INFLIGHT_CARGO_PRESENT`) because a fleet will not load twice per trip.
   Read its log for the same-cargoID survival proof.
2. Only if the same cargoIDs vanish: the blocker is inside
   `coopDurableCargoWrite.promote()`/`setTransientPath`, not the probe.
3. Then L3 durable slot journal (`systemID, slot, fleetID, minerIDs, haulerIDs,
   cargoIDs, tripPhase, updatedAt`) + one boot `reconcile` phase, so adoption is
   journal replay instead of heuristics.
4. `docs/COOP_ARCHITECTURE_BOUNDARIES.md` now states the module roles and the
   single owner per record; the next split is `coopNativeStationArrival`
   (route / phase / commit) so the sale path becomes testable without Docker.
