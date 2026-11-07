# PF75 — Native PF55 executor object is now callable from durable orders

Status: committed candidate, NOT live EveJS bootstrap. Feature remains OFF.

## Root cause

`createNpcRuntimeExecutor()` in `coopPersonalFleetNpcRuntimeExecutor.cjs` returns an immutable object: `{execute, probe, supports}`. The PF55 durable `createPersonalFleetNativeOrders()` constructor checked `typeof nativeExecutor === 'function'` and `issue()` invoked `nativeExecutor(row)` directly. Thus the real production pair could not be constructed, despite separate SQLite order and native executor tests passing using a handcrafted callable fixture.

## Change

The PF55 durable orders module now requires an explicit `supports()` plus **either** an `execute()` method (preferred real native adapter) **or** a legacy callable with `supports` (for compatibility with existing reference tests). It invokes the object method with the original frozen, durable-ISSUING order row and retains the existing no-automatic-reissue, failed-native-ACK and independent proof requirements.

No additional authority, combat permission, client entrypoint or ownership claim is minted. `DEFEND` still requires a separately proven combat policy and returns a pre-ISSUING block by default.

## Evidence / scope

New `scripts/pf55/tests/pf75-runtime-durable-contract.test.cjs` binds **both actual PF55 native modules** against the existing real SQLite PF53 hire -> PF52 reservation -> PF54 ACTIVE fixture; the `npcRuntime`, scene actor and orderBridge remain isolated native-shaped adapters. Tests include FOLLOW, HOLD, ATTACK, WARP, unsupported DEFEND, foreign actor, invalid executor object and legacy callable compatibility. They assert a single durable ISSUING and never replay on the same operation ID.

Run on a complete PR #350 checkout with Node 22+:

```
node --test --test-concurrency=1 scripts/pf55/tests/pf55-orders.test.cjs scripts/pf55/tests/pf55-native-executor.test.cjs scripts/pf55/tests/pf55-sqlite-sigkill.test.cjs scripts/pf55/tests/pf75-runtime-durable-contract.test.cjs
```

The PF74 native WORK CI gate must include PF55 cross-contract regression, otherwise an apparent all-green PF58-PF73 run proves nothing about user fleet orders.

## Not solved by this fix

The original EveJS server still needs explicit native bootstrap wiring, a real `PERSONAL_FLEET` order arbitration patch, session/target authorities, persisted native order acknowledgement and actual two-player E2E. No native engine PR write or WORK service boot has occurred.

## PF74 integration gate expansion

The PF74 branch workflow now source-pins the original `coopNpcOrderArbiter.js` and `coopNpcOrderBridge.js`, applies the PF55 owner/claim patch on the same isolated WORK worktree **after** the existing PF62 19-path patch, validates both JavaScript files with `node --check`, and runs all PF55 Node/Python tests. Thus the temporary WORK preview contains 21 changed native paths (19 from PF62 plus 2 independent PF55 original patches). The authoritative review artifacts remain two separately named source-pinned patches; the original engine checkout is not changed, and no deployment takes place.
