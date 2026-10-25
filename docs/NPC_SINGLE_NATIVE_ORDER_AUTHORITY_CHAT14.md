# Chat 14 - Native NPC single-owner arbitration hardening

Status: **CODE_READY / LIVE_UNVERIFIED**, pending Chat 01 central scheduler integration. Not a claim of complete NPC AI director or source-level universal ordering.

## Source provenance

- Repository baseline at start: `bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb`; last observed main: `ec400ebe0a334f9e6bc6565611ce63cf345f662e` (no overlap with the two owned modules or their regression suite at that observation).
- Native pinned EveJS: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- Native review: `Code/server/src/space/npc/npcRuntime.js` (`issueAttackOrder`, `warpToPoint`, `warpToEntity`, `orbit`, `follow`), `Code/server/src/space/npc/npcRegistry.js` (`getControllerByEntityID`), `Code/server/src/space/npc/npcBehaviorLoop.js` (`issueManualOrder`), and `Code/server/src/space/movement/commands/movementSubwarpCommands.js` (`orbitShipEntity` sets `entity.mode='ORBIT'` without `controller.manualOrder`).
- Existing integrated overlay: `integration/coopVirtualWorldRuntime.cjs` reuses `coopNpcOrderArbiter` and `coopNpcOrderBridge` when the OFF-by-default `EVEJS_COOP_NPC_ORDER_ARBITER=1` or `EVEJS_COOP_ALIFE=1` flag is present. No new source hook is required **for this guard**.

## Confirmed defects in the original bridge and lease logic

1. A `120s` lease expired solely by wall clock; a ship could still be in a native Destiny warp, orbit, follow or manual attack. Another planner could issue a contradictory order.
2. On process restart, a native controller might still hold a manually issued command, but the overlay's in-process lease has vanished; other planners treated the NPC as available.
3. An executor could recursively invoke the bridge while the first `issue()` was still executing. The arbiter created its lease **after** `execute()`, allowing overlapping native commands for one ship.
4. The bridge did not validate that the physical `scene.getEntityByID()` returned an entity with the exact requested `itemID`.
5. The native `orbit`/`follow` APIs do **not** necessarily set `manualOrder`. A guard based only on the controller or `currentTargetID` cannot classify physical route activity correctly.

## Implemented in this isolated bundle

- `coopNpcOrderArbiter` now inserts an `ISSUING` fence *before* verification/execution. A definitive native rejection restores the previous lease. Throws, promises and unknown results become permanent `OUTCOME_UNKNOWN` until operator repair, as before.
- New `retainWithNativeProof` extends active lease expiry *only after* the bridge has verified a unique, real NPC hull, matching controller, same system and assigned named pilot, and observed native busy state. It cannot clear uncertain outcomes.
- `coopNpcOrderBridge` recognizes `WARP`, `pendingWarp`, `warpState`, `isWarping`, and native subwarp `ORBIT`, `FOLLOW`, `GOTO`, `ALIGN`, `APPROACH` plus native `manualOrder`. Active warp blocks every new conflicting order, including an immediate second warp.
- If a controller already holds an attack/route/manual command and no matching arbiter owner can be verified (e.g. after restart), a new raid/gate/civilian/patrol command fails closed. TACTICS remains permitted to attempt emergency intervention *after the current warp has ended*, subject to the real native engine.
- The `blocksForSystem` read path now checks live native occupancy, not just timer leases, to keep the existing civilian/market selection guard aligned with actual controllers.
- Neither the native controller nor any cargo, item, wallet, NPC, scene, or database record is modified directly by these modules.

## Reproducible checks

```
node --check integration/coopNpcOrderArbiter.cjs
node --check integration/coopNpcOrderBridge.cjs
node --test tests/coop-npc-order-arbiter.test.mjs
```

Executed on Node v22.16.0 in an isolated local folder: **25 tests PASS, 0 FAIL**, including the eight existing original regression cases, with additional uncertain-acknowledgement, physical warp, stale owner, manual controller, native orbit, reentrancy, two-ship, permanent unknown-outcome and failed-preemption cases. No full upstream Checkout, Docker, source patch roundtrip, GameStore, actual controller tick or live client was available. Those are **NOT_RUN**, not PASS.

## Chat 01 central integration contract (do not duplicate another director)

Owner file: `integration/coopVirtualWorldRuntime.cjs` and installer `scripts/patch-evejs-coop.cjs`. Our module exports are backward-compatible (`issue`, `blocked`, `blocksForSystem`, `snapshot`), so installer registration already in place does not require a new native hook. The arbiter adds only `retainWithNativeProof` for the existing bridge.

The current 30-second tick orders `native-raids` before `native-tactics`, and schedules asynchronous `advanceNativeMarket` after movement directors. This is **not** an atomic perception -> decision -> one native action cycle; the bridge guards calls, but cannot decide cross-director priorities before the first call. Chat 01 should:

1. Snapshot/read physical entity, controller and named pilot identity once per NPC, with per-action re-verification. Run survival/ammo retreat, then current native warp, confirmed combat/retaliation and tactics, existing raids/hunting, committed delivery/recovery, then gate/patrol/civilian routes, finally social. Do not create another 30s timer or AI director.
2. At most one *new* native command per ship per decision epoch; existing raid/tactics/gate directors remain execution owners. Do not fake native effects from planned decisions.
3. The current `addNpcOrderBlocks()` is only a prefilter for market decisions. Async market/industry/delivery operations need their OWN existing GameStore/Rust durable claim and exact item/wallet outcome fence before the next order. An in-memory 120s lease is not a transaction lock. Coordinate with COOP-043/048/049 and pending PR #120; do not duplicate these engines.
4. Stock EveJS background NPC orders may bypass this bridge entirely. A universal native order boundary requires an owner-approved single source hook into the pinned native controller-order and movement paths, or clear evidence that stock calls cannot conflict. Keep that new hook OFF by default. No hand-edit of upstream or another parallel scheduler.
5. Do not rewire `coopNativeGateTransfer` (its recovery journal is a separate source of truth) or other PR-owned files until the relevant PRs are reconciled. Never mark gate arrival, combat hit, market settlement or item transfer from a lease/command acceptance alone.
6. For restart, inspect original durable native controllers and controller `manualOrder`/ship movement BEFORE any automatic `issue()`; quarantine unknown outcomes; do not replay payment, travel or attack from an expired timer.

### Remaining acceptance gates

- Full local repository baseline and pinned EveJS source-mounted integration tests: **NOT_RUN**, source unavailable to this container (GitHub read-only connector was used for review).
- Real native NPC battle vs NPC, interruption by survival retreat while in/after warp: **LIVE_UNVERIFIED**.
- Two independent logged-in clients see and interact with those exact physical NPC entities: **LIVE_UNVERIFIED / BLOCKED_CLIENT_UNAVAILABLE**.
- Cross-system gate, restart during transit, durable commerce/custody and fault injection: **BLOCKED** pending Chat 01 runtime integration and existing owner PRs.
- No production flags changed; no persistent volume or client binaries touched; no CI added.
