# PF82 — Physical NPC FOLLOW for friendly player ships

**Candidate source code in PR #350; not a live original EveJS server acceptance.** The original engine must remain disabled until independent writer fences, authentication, wallet/ItemStore authority and E2E acceptance are proven.

## Reproduced original-engine mismatch

Original unmodified `pas7-studio/EveJS coop/pas7std` source pins:

- `Code/server/src/space/npc/npcRuntime.js`: `8ee3d4f82db1600094df8de1060a9aa8e575af1a`
- `Code/server/src/space/npc/npcBehaviorLoop.js`: `43225cd72240e98e480e94088d3a457377eb5af6`

PF55 used `npcRuntime.issueOrder(ship,{type:'follow',targetID:...})`. In the stock `npcBehaviorLoop.resolveDesiredTarget` implementation, **any ship** targeted by a manual FOLLOW passes through `isValidCombatTarget`, and a friendly/noncombat target may be rejected. `issueManualOrder` still returns success, meaning the NPC can silently fail to follow. In other contexts the same code may classify a friendly ship as a valid combat target. Either behavior is wrong for a pure movement command.

`npcRuntime.follow(shipID, targetID, range, {wakeController:false,...})` instead invokes `spaceRuntime.followDynamicEntity`, the native physics movement API. It does not apply this combat-hostility filter, does not allocate a hull, cargo, equipment or character, and does not create a fighting manual order. The original runtime source proves this callable exists and uses the physical scene.

## Changes

- The PF55 runtime executor now requires the original native `follow()` method and invokes it for `FOLLOW`, after its PF78 original actor+controller/target checks and PF55 durable single-dispatch/arbiter admission.
- It never treats `issueOrder({type:'follow'})` as equivalent to physical movement.
- A live `nativeCombat` controller fails FOLLOW with `PF82_FOLLOW_COMBAT_CONTROLLER_NOT_QUIESCED`; silently mixing ongoing ATTACK intent with movement is not permitted. A separate crash-fenced combat-quiescence API is still needed to switch from combat back to FOLLOW safely.
- PF78 original *live* controller proof now accepts legitimate `nativeCombat` after the stock `issueManualOrder(ATTACK)` transition, allowing subsequent authorized HOLD and PF56 RETURN. The PF58 *persisted* pair/restart validator remains strictly `nativeAmbient`.
- Repaired PF75 cross-module SQLite fixture with the original PF58 actor/controller marker set, rather than the pre-PF78 itemID-only representation.

## Evidence and test gate

`pf82-friendly-follow-native.test.cjs` reads the **actual** source-pinned original `npcRuntime.js` and `npcBehaviorLoop.js` from `PF82_NATIVE_WORKTREE`, validates their exact Git blob SHA1, and evaluates only the corresponding original movement/target-selection functions with isolated dependencies. This avoids loading the live game server while still testing the original code, not copies of its semantics.

From the fully patched 22-path WORK checkout:

```sh
PF82_NATIVE_WORKTREE=/absolute/path/to/native-work \
  node --test scripts/pf55/integration/pf82-friendly-follow-native.test.cjs
```

The `scripts/pf55/tests/pf55-native-executor.test.cjs` and `pf75-runtime-durable-contract.test.cjs` regression tests also require the real executor to invoke `follow()` and verify that a friendly target never goes through the manual `issueOrder` API. Their actual physical scene/runtime are still isolated test adapters.

**NOT PROVEN:** A live server/client command, after-combat FOLLOW transition, stock physics movement across bubbles/gates, actual two-player fleet behavior, original GameStore writer fencing, wages, combat and stock ammo.

No main/PLAY writes, flags remain OFF. CI must show green results before advancing readiness.
