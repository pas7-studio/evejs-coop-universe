## Session state — 2026-10-26 (latest)

### LIVE 2026-10-26 19:5x — mining is fixed end to end; the hauler hull is the blocker
The running image was 2 h old (the "deploy" was a restart), so I rebuilt: `OVERLAY_OK`,
`BUILD_OK`, then `boot_errors=0` — no `Cannot find module ../coopMiningTargetGuard`
and no `NPC tick failed` (the guard is installed and cannot throw into stock code).

Measured in the first 6.5 minutes after the rebuild:
- `living-mining-cycle-settled` **×72**, real numbers: qty 963 (rock 38 282 → 36 356),
  qty 4 917 (rock 117 105 → 112 188), `replayed=false`. Atomic mining commits.
- `MINING_CYCLE_ATTEMPT` with `locked=true`; `MODULE_ACTIVATED present=true mining=true`.
- `living-mining-cargo-repair-cleared` is **gone** (was 52 per 5 min before `8e8bc124`).
- Loop stops at hauling: `living-haul-no-hauler ... skipped[0]={haulerID, why:"full",
  usedM3:0, capacityM3:50, needM3:9533.3}` and one `why:"out-of-range", rangeMeters:3712`.

Why: **every durable "hauler" slot is a Mining Venture**, `typeID 32880`,
`profileID ore_mining_venture`, i.e. a 50 m³ mining frigate, while the miners are
Skiff/Hulk/Retriever. Evidence: 9 durable actors in `npcEntities`, all three
`coop-mining-<system>-1-hauler` rows are Ventures; the SDE pool
`npc_mining_hauler_highsec` exists and contains only real haulers
(`ore_mining_bestower_hauler, ore_mining_badger_hauler, ore_mining_mammoth_hauler,
ore_mining_bustard_hauler`), so the wing either never used that pool or the slot was
adopted/re-labelled from a mining-ops hull. A 50 m³ hold can never take an 8 000–12 000
m³ stack, so the strict transfer correctly refuses and the fleet keeps its ore.

**Needs the owner:** repairing a durable slot destroys a persistent NPC, so either
(a) set an explicit hauler profile/pool for the fleet (`EVEJS_MINING_NPC_HAULER_PROFILE_OR_POOL=ore_mining_badger_hauler`)
and reseed the hauler slot through the documented repair path, or (b) investigate the
marker/adoption path first (no destructive action).

### Test baseline, 2026-10-26 evening (measured, not guessed)
- Loop suites (23 files, mining + haul + atomic store + overlay gates): **247/247 PASS**
  after fixing four stale fixtures; this is the gate to watch before any deploy.
- Full `node --test`: **4898 tests, ~437 failures** that predate this work and belong
  to other streams: escort/funding (`FLIGHT_FUNDING_PREPARE_UNCERTAIN`,
  `NATIVE_REFUND_FLIGHT_NOT_FUNDED_OR_ALREADY_DELIVERED`), ALIFE-13 station/payout
  journals, and installer-coverage suites that still parse a module list out of the
  old installer. Fixed today in that area: hauler fixture positions, three
  assertions that had stopped testing anything, module-list readers, and 33 missing
  repo `.js` shims that made ten files unloadable.
- `scripts/loop-verdict.cjs` (8 unit tests) is the only thing allowed to say the loop
  closed: it needs mining, a real hauler load, a delivery to a station != 0 and a
  sale, and it prints the runtime reason when a stage is skipped.

### NEEDS OWNER DECISION — `.github/workflows` exists again
`tests/coop-crossstream-overlay-roundtrip.test.mjs` fails with the explicit guard
"Owner prohibited remote GitHub CI for this game": twelve workflows are back on
`main` (`coop-native-economy-gate`, `ex03-native-npc-probes`, `fw-war-recovery-source`,
`lw04*`, `pve-chat19-21-native`), added by `e1747f2d`, `30eb6f3e`, `f3f413fa` and
siblings, which AGENTS.md forbids ("Do not add, restore, enable or run GitHub
Actions workflows... The entire `.github/workflows` directory was deliberately
removed"). Nothing here was deleted: another session's work is not mine to
remove, and the test is telling the truth. Owner decides: delete the directory
(restores the documented rule) or amend the rule.

### MINING WORKS (18:20Z) — three stacked blockers, each measured
1. **`d75dea53` overlay modules required `.cjs` siblings.** Installed as `.js`, so
   `coopMiningActivate` threw `MODULE_NOT_FOUND` on every tick and SpaceRuntime
   swallowed it (`Mining tick failed for system=...`); the activation path, gate
   included, never ran once. Extensionless requires + installer guard.
2. **`b8419823` an idle NPC controller cleared the mining ship's target locks.**
   Stack: `tickController → clearNpcCombatState → clearNpcTargetLocks →
   scene.clearTargets → clearOutgoingTargetLocks → stopTargetedModuleEffects(reason
   "target")`. Every idle think stopped the module that had just been activated, so
   no 15–45 s cycle could ever complete. `EVEJS_COOP_MINING_LOCK_GUARD=1` keeps the
   locks of a hull with an active mining effect (default OFF).
   Measured after: `MINING_CYCLE_ATTEMPT locked=true pending=0`, rock ore falling
   162502 → 151910 → 143244, ships `ORBIT|act2|cap0.94`, fleet `mining → loaded`,
   holds `q44297…q69336` and climbing.
3. **Hauling and the atomic mining commit are welded, and the commit is refused.**
   RESOLVED in `df2acdc9` (not yet deployed): cargo isolation is now a table of
   declared contracts instead of one hardcoded `npcCargo` case -
   `haul-transfer` (unchanged: one cargo root + one receipt) and `mining-cycle`
   (`miningRuntimeState`+`npcCargo`: zero or one cargo root rewrite, no other
   npcCargo row, exactly one COMMITTED journal row whose `nextCargo` equals the
   written stack). Undeclared sets still fail closed with
   `NATIVE_TRANSIENT_STATE_UNSAFE`.
   Evidence (offline, no redeploy): `tests/coop-mining-cycle-transient-isolation.test.mjs`
   10/10 including the real ALIFE-07 settler committing a cycle while transient
   stock cargo exists; `tests/coop-native-cargo-transient-isolation.test.mjs` 25/25;
   staged `.js`-only install loads the adapter through the extensionless require;
   `scripts/Verify-Coop-GameStore-Atomic-Isolated.cjs` -> `PASS
   COOP_032D_PINNED_GAMESTORE_DISPOSABLE`; `OVERLAY_OK patched 54`, `CHECK_OK series=6`.
   Also fixed in this arc: config refusals no longer poison a hull (`bc0a1009`),
   a pre-mutation refusal no longer blocks forever (`22ec6968`), yield refusals name
   the failing field (`3bba6d12`), float cycle boundaries are rounded (`f294b647`),
   the installer refuses `.cjs` sibling requires (`d75dea53`, `d9a4b629`).
   **`c7a24889` — the lock guard was never installed.** It was written, hooked into
   `clearNpcCombatState`, and missing from the install list, so every NPC think threw
   `Cannot find module ../coopMiningTargetGuard`; mining survived only because that
   throw aborted the lock clearing the guard was meant to do (right outcome, wrong
   reason, NPC controller interrupted every second). Now: module registered, the hook
   cannot throw into stock code, and `scripts/coop-hook-requires.cjs` resolves all 984
   requires of hooks and installed modules - the installer refuses
   `HOOK_REQUIRE_UNRESOLVED` / `HOOK_REQUIRE_EXTENSION`.
   Next: one deploy, then measure `loaded -> delivered -> sold` and a restart
   acceptance (`DURABLE_BEFORE>0`).

### ROOT CAUSE FOUND 17:20Z — the activation hook never ran (fixed in `d75dea53`)
`STOP|act0|cap1` for hours was not a capacitor, targeting or cycle problem.
Overlay modules are installed as `server/src/space/<name>.js` (`patch-evejs-coop.cjs`
line 345), but eight of them still did `require("./sibling.cjs")`. In the container
that is `Cannot find module './coopMiningCapacitorGate.cjs'`; `SpaceRuntime` catches
it per tick (`Mining tick failed for system=...`) and the whole activation path,
capacitor gate included, never executed once. Repro of the blindness: `MINER_TARGET`
(6/5 min) and `FLEET_POST_TICK` fired because they are separate hooks, while
`MODULE_ACTIVATED`, `CAPACITOR_WAIT` and `MODULE_ACTIVATE_FAILED` stayed at 0.
Fix: extensionless sibling requires + repo `.js` shims, and the installer now throws
`INSTALL_REQUIRE_EXTENSION` instead of silently shipping a dead hook. Guard:
`tests/coop-overlay-require-style.test.mjs` (staged `.js`-only install loads the entry).
Lesson for every future hook: a caught exception per tick looks exactly like an idle
feature; instrument the entry of a hook, not just its outcomes.

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

## 2026-10-26 15:00Z — three root causes found and patched (L1 0003/0004/0005)

1. **Durable identity** (0002 second hunk): dematerialize wrote transient:true,
   which strips the row from every later flush -> durable ships vanished from
   disk. Fixed; 9 durable rows persist across scene rebuilds.
2. **Combat dormancy** (0005): dematerializeDormantCombatControllers matched our
   durable nativeCombat controllers (operatorKind) on every no-session scene and
   unregistered them ~2x/s; the durable owner restored each one, giving 21 582
   restores and zero completed mining cycles. Dormancy now skips non-transient
   controllers.
3. **Capacitor interval** (0003 second hunk): advanceSessionlessCapacitor used the
   shared capacitorRechargedAtMs stamp for its own dt, so it advanced a few ms per
   call (53x slow: +0.0109 ratio over 121 s vs 0.0048/s). Now uses
   coopCapacitorAdvancedAtMs; test extracts the function from the patch.

Fleet retention (0004) keeps an actor whose stored controller row still exists.
Overlay: CHECK_OK series=5, OVERLAY_OK patched 54, anchorMismatch 0.
Mechanism debt is gated: hooks legacy=65 wired=48 longHooks=3 specEntries=45.
Next: confirm cap climbs at ~0.0048/s live, then look for the first
living-hauler-loaded -> living-native-haul-delivered -> living-npc-station-sold.

## 2026-10-26 15:40Z — capacitor starvation loop, measured

Probe living-capacitor-advance-values (temporary, removed) showed the advance is
correct: dt 0.535 s per call, tau 187500 ms, capacity 625, before 0.0191 ->
after 0.0225 (+0.0034 per call, ~0.006/s, matches the CCP curve).

Yet the visible ratio stayed at 0.00-0.02 and one hull reached exactly 0.000.
Conclusion: the stock loop retries the activation every tick, and the retry
consumes the charge, so a hull that falls below the 23 GJ module cost never
recovers. MODULE_TARGET_MISMATCH = 0, so it is not the target-change branch.

New co-op layer (default behaviour for players unchanged):
- integration/coopMiningCapacitorGate.cjs - shouldWait(entity, 30 GJ): only
  sessionless nativeNpc ships; player and session-owned ships are never gated.
- integration/coopMiningActivate.cjs - one attempt: wait, activate, report.
- overlay hook is now a single call (338 -> 171 chars); mining has zero hooks
  longer than 400 characters.
Both modules are unit-tested (4/4 + 4/4).

Also fixed infrastructure: the overlay now treats a file changed by a pinned L1
patch as its install baseline (runtime.js + 0006 no longer trips OVERLAY_DRIFT).

Next: after the deploy, read CAPACITOR_WAIT / caps: caps must climb to ~0.5, then
expect living-hauler-loaded -> living-native-haul-delivered ->
living-npc-station-sold, then scripts/restart-acceptance.sh.

## 2026-10-26 15:55Z — after the capacitor gate deploy

Live facts (read-only):
- 3 slots ACTIVE in the witness, 9 durable coop-mining controllers in the store
  (3 per system: 30000144, 30000145, 30100032).
- living-native-durable-slot: RESTORED m2/h1 live m2/h1, then ALREADY_ACTIVE.
- living-mining-fleet-state per system: 30000144 mining m2h1, 30000145 mining
  m2h1, 30100032 depleted m2h1.
- TICK_mining: 5 ticks per system per 10 min -> the fleet thinks once per ~2 min.
- CAPACITOR_WAIT 0 and MODULE_ACTIVATE_FAILED 0 in the last windows: the new gate
  is installed (hook + both modules verified in the container) and is not blocking,
  i.e. the hulls are above 30 GJ when the tick runs.
- Ore is still 0 in every fleet (q0) and there is no living-hauler-loaded.

Interpretation: durable identity, dormancy and the capacitor reset are fixed and
verified, but the yield step still never lands. With a 2-minute think interval and
a 45 s module cycle, the cycle boundary has to be crossed by the runtime effect
loop between ticks; the earlier probe proved executeMiningCycle was never called.

Next experiment (one probe, then remove): re-arm living-mining-cycle-result at
executeMiningCycle and living-mining-effect-state for one ship, and check
whether an effect survives a full 45 s between ticks. If effects survive and the
cycle still never runs, the boundary code path is the target for the next L1 patch.
Also note FLEET_POST_TICK almost never fires (its anchor is the module-assignment
path), so cap/act telemetry needs a different anchor for a slow tick.
