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

## 2026-10-26 13:10Z — mining capacitor root cause FIXED (double activation)

- The overlay inserts lines *before* an anchor, so the traced
  `activateGenericModule` in `miningNpcOperations` was added in front of the
  stock call instead of replacing it. Every fleet tick without a cached effect
  spent the module capacitor TWICE. Live CAPTRACE showed dt≈0.5 s, one drain of
  18 GJ (= type 482 capNeed) per ~1.8 s against a recharge of 0.012/s, so a
  250 GJ hull sat at ratio 0.003-0.013 vs the 0.092 a Miner I needs.
- Fix: the traced call now ends with `continue;` (stock call unreachable).
  After rebuild: miners hold 0.72-0.96 with both strip miners active.
- Durable slot status was invisible: `start()` was called without `log` and its
  result discarded. Each slot now emits `living-native-durable-slot` once per
  status change; live output SPAWNED/RESTORED with `miners=2 haulers=1`.
- The earlier `haulers:0` fleet records are gone: both fleets now report
  haulers=1 with the hauler in STOP mode next to the rocks.
- Deployed: OVERLAY_OK patched 54; commit 20aca65 (+ worklog 70f8c7c).
- Modules: type 482 capNeed 18 GJ / 15 s; type 17482 capNeed 23 GJ / 45 s;
  hull 250 GJ tau 125 s -> theoretical equilibrium ratio ~0.88, which is what
  the live telemetry now shows.
- Next: wait for `living-hauler-loaded` -> `living-native-haul-delivered` ->
  `living-npc-station-sold`, then run scripts/restart-acceptance.sh.

## 2026-10-26 14:10Z — mechanism audit (owner question: why patch instead of a real module)

- Live: fleet keeps m2 h1, prunes 27/4.5min -> 0-1/5min, miners orbit a real
  rock with 2 active strip miners and cap 0.57-0.73. Ore still q0.
- Durable identity fixed (L1 0002 second hunk) + fleet self-heal hook.
- Measured with the new probe: `tickController` drops ZERO controllers, so the
  behaviour loop is NOT the cause of the remaining churn; no patch there.
- Mechanism audit: deploy path = L1 patches + overlay-spec (45 entries) +
  `scripts/patch-evejs-coop.cjs`, which itself runs **~70 hardcoded
  `coop-*-patch.cjs` modules** (65 files, only 2 delegate to the spec). Those
  edit stock files with bespoke string surgery, e.g.
  `coop-native-npc-fire-debit-patch.cjs` adds 172 unmanaged lines to
  `runtime.js`. Consequence: `runtime.js`/`miningRuntime.js` have no spec entry,
  so the gate cannot see (or check) their content, and adding an entry turns a
  passing check into OVERLAY_DRIFT immediately.
- Decision: no new `coop-*-patch.cjs`; new behaviour goes to the spec (one-line
  call + module) or an L1 patch. Migration of the legacy 70 is the next
  architecture task, tracked with a visible count.
- Gate note: `--check` is currently blocked by another session's
  `server/src/space/coopHaulCargoAdoption.js` = STALE (their in-flight file),
  not by our overlay. Do not delete or reset it.
- Next: read `living-mining-cycle-result` (temp probe in runtime.js, reverted
  after measurement) to name why the stock yield never commits for NPCs.
