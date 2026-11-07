# PF55 native-order integration / review gates

**This is a candidate, not a playable feature.** All work below must occur on
WORK and requires the repository owner to grant write access to `pas7-studio/EveJS`.
Original `coop/pas7std` blobs are listed in README. No CI or PLAY deployment.

## 1. Identity and exclusivity

- Confirm PF53 paid hire and original NPC employer; PF52 stock ItemStore
  reservation; PF54 original ship `itemID` equals scene entityID and controller
  entityID; matching `coop-pilot-*`, owner, system, assignment, generation.
- Bind PF55 `verifyExclusiveOwnership` to original PF44/PF46 Mining leases,
  active WAR registry (including transfers), Exploration, and native writer
  ownership. A callback that returns hard-coded `true` is forbidden.
- Bind stock item `flagID=0`, stock `locationID`, item owner and stock category
  6 to the original source inside the same GameStore read transaction.
- Bind `allWritersFenced()` to real reciprocal stock ItemStore, AI planners,
  WAR, Mining and Exploration original writers. No source means feature OFF.

## 2. Original arbiter and bridge

The pinned patch generator proposes native changes to:

- `coopNpcOrderArbiter.js`: register `PERSONAL_FLEET`, do not let TACTICS
  preempt an existing PF lease.
- `coopNpcOrderBridge.js`: add exact durable `pfShipClaim` lookup. Any owner
  OTHER than PERSONAL_FLEET must refuse ASSIGNED / UNKNOWN PF claims, even if
  the original ephemeral arbiter lease expired. PERSONAL_FLEET must refuse
  missing/unverified claims, including an unbound `pfShipClaim`.
- Expand `assignments()` with the original native PF actor roster; do not
  overwrite existing WAR / Exploration registered links or fabricate pilots.
- Wire the PF55 runtime adapter using `createNpcRuntimeExecutor` and pass
  `executor.execute.bind(executor)` with `nativeExecutor.supports` property:
  ```js
  const nativeExecutor = row => originalExecutor.execute(row);
  nativeExecutor.supports = action => originalExecutor.supports(action);
  ```
- Stock directors bypassing `coopNpcOrderBridge` must independently fence
  original PF actor claims (separate P0 requirement).

## 3. Each native command

- `FOLLOW`: original `npcRuntime.issueOrder({type:'follow'})`, movement-only;
  target must be authenticated friendly entity in original same-system scene.
- `HOLD`: original `npcRuntime.stop(..., {allowSessionlessWarpAbort:false})`;
  reject any warp already in progress.
- `ATTACK`: original `npcRuntime.issueAttackOrder`, verified legal hostile,
  security and PvP rights; `allowPodKill:false`. No arbitrary target IDs.
- `WARP`: original `npcRuntime.warpToEntity` to an authoritative target in the
  original same-system scene, with safety, collision and travel rules verified.
- `DEFEND`: original follow-to-friendly is not protective combat. Require a
  separate native defensive escort policy and hostile selection rules;
  `nativeExecutor.supports('DEFEND')===false` until it is implemented.

## 4. Durability and concurrency

- BEGIN IMMEDIATE + synchronous FULL + original GameStore cache invalidation.
  `ISSUING` is committed BEFORE original NPC command execution.
- The original `npcBehaviorLoop.issueManualOrder` mutates an in-memory
  controller. A single `success:true` does not survive process death. Create
  an ORIGINAL native persisted order record with opID, original controller,
  assigned pilot, action, generation, target, timestamp and commit receipt.
- Only that independent persisted record may satisfy
  `verifyPersistedNativeOrder` and move PF55 into durable `ACKED`.
- After crash from ISSUING: no automatic dispatch/retry/lease expiry.
  Operator/source reconciliation must prove the original effect or repair.
- Global operation index prevents reuse of an opID after subsequent orders.
  When its capacity is reached, refuse new orders until audited compaction.
- First dispatch / reconcile re-check original owner, session, claim,
  physical ship, native controller, target, and competing writers inside
  the original serializable read transaction.

## 5. WORK acceptance

Two real player sessions must prove hire, original ISK movement, stock hangar
reservation, one original ship + controller, commands FOLLOW / HOLD / ATTACK /
WARP, confirmed defensive escort, crash recovery at each durable boundary,
source-wallet-and-item conservation, return-to-base and docking. `node:test`
source/synthetic SQLite tests do NOT satisfy this gate.

**Never report PF55 as PLAY-ready or merge to main while these native gates are
unproven. Personal Fleet remains default OFF; PF42 exclusion is preserved.**