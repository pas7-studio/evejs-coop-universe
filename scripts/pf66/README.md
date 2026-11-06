# PF-66 — original ItemStore dock + scoped scene teardown (review candidate)

**Personal Fleet OFF. No stock EveJS server code installed. Never run on PLAY.**

## The P0 lifecycle deadlock

PF56 commits `DOCK_ISSUING` and expects an injected `executeNativeDock()`.
PF59 protects player-owned NPC ships against ordinary NPC destroy/dematerialize.
PF60 terminal custody requires `sceneAbsent=true` BEFORE `prepare()`, while PF61
can remove persisted native entity/controller rows only AFTER PF60 `ISSUING`.
Therefore the physical scene actor has no authorized removal path after a
sessionless dock. This is a genuine missing step, not a matter of adding tests.

## Proposed original-writer path

`createScopedDock` is an injected PF56 `executeNativeDock(row)` adapter. It:

1. Verifies the exact original `DOCK_ISSUING` row, ACTIVE PF54 deployment, PF58
   consumed handoff + ship lock, unique PF actor claim, original ItemStore ship
   in space, verified station dwell and exclusively fenced native writers.
2. Commits immutable PF66 `dock-native-attempt-v1:<assignmentID>` to **original**
   SQLite `corporationRuntime` in a `coopAtomicNativeRows` transaction, **before**
   any external ItemStore or runtime scene write.
3. Calls the original `ItemStore.dockShipToLocation(shipItemID,stationID)` once,
   then reads the exact original ship back in that station hangar.
4. Calls a newly source-patched, capability-bound original
   `nativeNpcService.detachScopedPersonalFleetDockSceneActor()` once. This
   verifies the consumed PF66 row and matches the original persisted NPC entity,
   controller and sessionless physical actor; it removes ONLY the scene actor
   and runtime controller, with no native row cascade and no ItemStore mutation.
5. After independent scene vacancy proof, PF60 can prepare/issue; PF61 may
   remove original native entity/controller rows, followed by PF56 dock
   reconciliation and PF60 finalization. Their existing gates remain mandatory.

**Crash semantics:** any failure after the consumed PF66 token is *terminal*
for automatic execution. The permit is never deleted and cannot be reused,
including after a SIGKILL between dock and scene detach. Manual operator
readback/reconciliation is required on uncertain partial state; no recovery
algorithm may manufacture a new attempt or reset the original ship lock.

`build_native_dock_scene_patch.py` is PINNED to original EveJS
`Code/server/src/space/npc/nativeNpcService.js` Git blob
`ca039daaaad2839d17f7109de2f3834cec0373a8`. The stock service method
MUST be composed **after** PF58 and PF59 into the single PF62 review diff.
Do not apply independently. PF62 must stage the PF66 module and emit **19**
files (2 changed stock files + 17 native modules). Two explicit gates are
necessary for review-mode source: original native ship adoption and dock scene
teardown, plus a genuine installed in-process authority and writer fencing.

27 Node tests include two on-disk SQLite WAL/FULL SIGKILL scenarios, eight
JavaScript VM tests evaluating the exact inserted native service source, and
17 additional guards/recovery checks. Python has six source/patch tests.

## Isolated tests

```bash
node --test --test-concurrency=1 scripts/pf66/tests/pf66-dock.test.cjs scripts/pf66/tests/pf66-native-service.test.cjs scripts/pf66/tests/pf66-sigkill.test.cjs
python3 -m unittest discover -s scripts/pf66/tests -p 'test_*.py' -v
```

Windows manual runner: `scripts/pf66/Test-PF66-Local.ps1` (skips SIGKILL).

**No real original native checkout, original networked GameStore callbacks,
original station dwell monitor, running WORK engine, or two-client E2E has been
proven.** Original sessionless dock authority and reciprocal writers need a
separately reviewed native integration. This package is not a release approval.
