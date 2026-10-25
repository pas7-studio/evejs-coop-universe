# Chat 04 — native observer integrity (2026-10-25)

Status: **isolated implementation / LIVE_UNVERIFIED / central hook pending Chat 01**.

## Exact source audit

- Source repo: `gameboys84/EveJS`, pinned SHA `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- `Code/server/src/space/movement/dispatch/movementSceneRefresh.js` uses `runtime.getVisibleEntitiesForSession(session)` and native `sendDestinyUpdates` / `buildSetStatePayload`.
- `Code/server/src/space/movement/dispatch/movementWatcherCorrections.js` separates owner warp corrections and watcher movement updates.
- `Code/server/src/space/transitions.js`, `ensureSameSceneBoardTargetVisible` and `refreshSameSceneSessionView`, calls `scene.sendAddBallsToSession` and then adds ship IDs into the session's `visibleDynamicEntityIDs` cache without inspecting delivery acknowledgement. `sendAddBallsToSession` may enqueue asynchronously: this is a **delivery-proof gap**, not confirmed lost packets. Do not patch it here because Chat 01 owns native anchors.
- Native scene exposes `getEntityByID`, `canSessionSeeDynamicEntity`, `syncDynamicVisibilityForSession`, and owns `dynamicEntities` and `sessions`; overlay must not maintain a competing Ballpark or broadcast handcrafted Destiny packets.
- Upstream synthetic tests: `verifyMovementRemovalParity`, `verifyJoltsObserverParity`, `verifyMovementWarpParity`; repository tests: `upstream-two-observers`, `upstream-two-observer-warp`, `upstream-two-pilot-movement-and-reconnect` (requires pinned checkout). They are **not** live two-client evidence.

## New independent module

`integration/coopSceneObserverIntegrity.cjs`:

- `sampleObserver(scene,session)` compares the native visibility predicate with the session's existing native visibility cache for actual numeric entity IDs, excluding the ego ship, without altering either state.
- Requires an attached, Ballpark-ready active owner, actual native hull, matching solar system, unique live character and ship ownership, valid physical IDs and finite visible positions.
- Refuses to repair during warp/transition or on any ambiguous scene, entity identity or player ownership.
- `createReconciler({clock,confirmations,cooldownMs,maxRepairsPerPass})` reconciles only stable divergence, rate-limits repairs, and calls **only** `scene.syncDynamicVisibilityForSession(session)`. Does not fabricate NPCs, positions, AddBalls, RemoveBalls, damage or movement broadcasts. Success means native visibility *cache* converged, never actual client rendering.
- `reconcileIfEnabled(scene)` is OFF unless `EVEJS_COOP_SCENE_OBSERVER_RECONCILE=1`. No timers, persistence, network activity or top-level hooks. Max 2 repairs/pass, 2 matching observations, 5s cooldown by default.

Local test: `node --test tests/coop-scene-observer-integrity.test.mjs`. Synthetic native-dispatch doubles exercise two observers, different grids, native NPC visibility, despawn, warp, reconnect, ownership mismatch, bad positions, failure, cooldown and idempotence; only a **unit suite**.

## Required integration contract — handoff to Chat 01

Copy the repo module as `server/src/space/coopSceneObserverIntegrity.js` using the **existing** overlay copy list, and call a **single guarded statement** from the existing authoritative scene's post-native-visibility/movement tick (NOT another timer):

```js
if (process.env.EVEJS_COOP_SCENE_OBSERVER_RECONCILE === '1') require('./coopSceneObserverIntegrity').reconcileIfEnabled(scene);
```

Chat 01 must locate the exact unique pinned runtime anchor and verify this call runs **after**, not in parallel with, native `syncDynamicVisibilityForAllSessions`. It must not call from a mid-warp start or observer broadcast handler. Keep feature default OFF, verify installer `--dry-run`, apply/remove/idempotent source roundtrip, module deployment path and native two-observer contract. The same-scene ship-swap AddBalls delivery-proof issue deserves a separate native anchor review by Chat 01 rather than assuming this periodic repair fixes it.

## Acceptance that remains outstanding

Local pinned EveJS checkout, Node dependencies, game host and proprietary client are unavailable in the current container. No native integration, real Docker, actual Destiny packet capture or two-client login/flight tests were executed. Required manual cases after approved integration: A/B same grid see each other's authoritative ship IDs + same native NPC; A/B different grids do not see wrong NPC; moving/warping B sees updated position after landing; A disconnect/reconnect leaves B active; native destruction removes NPC and ship exactly once; ensure no client-side ghost remains after session change. Correlate native IDs, timestamps and source events; do not infer visual PASS from the cache result.
