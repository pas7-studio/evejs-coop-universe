# PF85 — source-pinned original NPC command API (manual-only WORK preflight)

**PR #350 remains Draft. No activation, server boot, market/wallet writes,
remote CI, client changes, PLAY restart, or main merge.**

## Why

Earlier PF55/PF56 tests used injected functions named `follow`, `stop`,
`issueAttackOrder`, `warpToPoint`, and `warpToEntity`. Passing those tests
did not establish that the corresponding **original EveJS** runtime has
compatible signatures or honors the requested options.

PF85 reads the actual `Code/server/src/space/npc/npcRuntime.js` from a
specified clean engine checkout and checks its Git blob ID:

`8ee3d4f82db1600094df8de1060a9aa8e575af1a`

The source pin was independently verified against
`pas7-studio/EveJS@coop/pas7std` on 2026-11-06. Source changes fail closed
until separately reviewed and re-pinned.

PF85 runs the exact checked-in original NPC runtime code in an isolated Node
VM using explicit, non-persistent stand-ins for its two dynamic dependencies.
It checks the exported functions, friendly physics FOLLOW without combat
manual order, ATTACK without pod kill, STOP without warp abort, WARP_ENTITY's
real target point and notification flags, WARP_POINT, and failure propagation.
**The dynamic dependencies are controlled doubles**: this is an original
source-bound API compatibility test, **not** a live physics, weapon, session,
wallet, ItemStore, crash, docking, or gameplay test.

## Local manual run (Node 22+)

On Windows PowerShell:

```powershell
$env:PF85_NATIVE_WORKTREE = 'C:\Games\EveCoop\upstream-evejs'
node --test --test-concurrency=1 scripts/pf55/integration/pf85-original-npc-runtime.test.cjs
Remove-Item Env:PF85_NATIVE_WORKTREE
```

On Linux/WSL:

```sh
PF85_NATIVE_WORKTREE=/absolute/path/to/EveJS \
  node --test --test-concurrency=1 scripts/pf55/integration/pf85-original-npc-runtime.test.cjs
```

The `Prepare-PF80-CompleteNativeWork.ps1 -ApplyToWork` wrapper now executes
PF85 automatically **before** any PF80 review output or WORK worktree
is created. Failure aborts safely, with no workaround flag. The standalone
Python `prepare_complete_native_work.py` command does **not** include this
PowerShell gate; run PF85 explicitly first when using Python directly.

## Still required

PF85 does not create real PF claims, install bootstrap, furnish persisted native
order witnesses or prove player session/ItemStore/wallet authority. The 22-path
PF80 original native patch and PF77 test still need actual local WORK execution.
The engine repository still returns 403 for App writes. Complete source-bound
writer arbitration and two-client E2E have not been performed. Keep Personal
Fleet OFF.
