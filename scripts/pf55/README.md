# EveJS Personal Fleet — PF-55 Native Orders (inert integration candidate)

**NOT GAMEPLAY READY. Default OFF. No WORK/PLAY deployment or merge.**

PF55 adds a crash-fenced original-NPC command bridge. It requires the exact
PF53 paid-hire / PF52 original player ship reservation / PF54 ACTIVE original
entity+controller+PF actor claim before an order can be admitted.

## What is implemented

- Durable `ISSUING` before one original NPC runtime action. No automatic
  redelivery after a crash, timeout, transient error, or ambiguous native ACK.
- `ACKED` requires an independent ORIGINAL *persisted controller order* witness.
  The stock `npcRuntime.issueOrder` return value is insufficient.
- Atomically writes the latest ship order and a global operation ID index in
  the original `corporationRuntime` SQLite table (source ItemStore read-only).
- Orders: FOLLOW -> original `npcRuntime.issueOrder({type:'follow',...})`,
  HOLD -> original `npcRuntime.stop`, ATTACK -> original `issueAttackOrder`,
  WARP -> original `warpToEntity`. DEFEND requires a separate verified native
  combat-protection policy; stock follow is NOT equivalent to protecting a ship.
- `build_native_owner_patch.py` produces a **read-only, source-pinned** patch
  for original `coopNpcOrderArbiter.js` and `coopNpcOrderBridge.js` from a
  real native worktree; it refuses changed sources and runs `git apply --check`.
  This repository does not contain an applied original engine patch.

## Local isolated tests

Node.js 22+:

```sh
node --test tests/pf55-orders.test.cjs tests/pf55-native-executor.test.cjs tests/pf55-sqlite-sigkill.test.cjs
python tests/pf55-patch-builder.test.py
```

The SIGKILL tests run on Linux/macOS; they skip on Windows. They use **synthetic
native actor/controller proof** but a real SQLite database and actual killed
child processes; no claim of original EveJS gameplay E2E is made.

Windows local runner from this folder: `./Test-PF55-Local.ps1`.
Optional original read-only source preflight:

```powershell
./Test-PF55-Local.ps1 -NativeWorktree 'C:\path\to\EveJS'
```

Manual original patch generation (DO NOT apply on PLAY):

```sh
python build_native_owner_patch.py --native-worktree /path/to/EveJS --output /tmp/pf55-original-owner.patch
git -C /path/to/EveJS apply --check /tmp/pf55-original-owner.patch
```

## Important original source pins (Git blob SHA-1)

- `Code/server/src/space/coopNpcOrderArbiter.js`: `aa5447ada4015b1ac8262d14bae5cd975af6ec6b`
- `Code/server/src/space/coopNpcOrderBridge.js`: `c0f93af3e5a67703a84dc03cab8da29a65afdf3b`
- `Code/server/src/space/npc/npcRuntime.js`: `8ee3d4f82db1600094df8de1060a9aa8e575af1a`
- `Code/server/src/space/npc/npcBehaviorLoop.js`: `43225cd72240e98e480e94088d3a457377eb5af6`
- `Code/server/src/space/coopGameStoreAtomic.js`: `2b28b48145f3fbc989ce7346384487ee75e52280`

## Critical blockers

1. Original EveJS GitHub fork write is 403 (repository integration permissions).
2. No actual PF54 original-ship handoff, PF52 ItemStore reciprocal writer fences,
   or real PF55 runtime bootstrap are installed in the game engine.
3. `coopNpcOrderBridge.assignments()` must include authenticated PF actor links,
   and its `pfShipClaim` must read actual PF actor claims transactionally. The
   original arbiter must recognize PERSONAL_FLEET as nonpreemptive owner.
4. Native `issueManualOrder()` currently mutates in-memory controller state;
   a separate persisted order ID, controller proof, and post-crash reconciliation
   are needed before `ACKED` can be safely trusted on WORK.
5. Defensive response requires explicit, tested native combat rules.
6. Return-to-base, docking, wages, command UI, and full two-player E2E are not
   in this PF55 slice.

Read `docs/INTEGRATION_GATES.md` before touching original runtime or PLAY.