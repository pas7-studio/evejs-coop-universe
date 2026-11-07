# PF-71 — protect both native materialization entrypoints

## P0 discovery from original `pas7-studio/EveJS`

The source-pinned original `nativeNpcService.js` contains **two callsites** for
`materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition, options)`:

1. `materializeStoredNativeController` — already checked by PF-69/PF-70 before
   resolving an NPC definition.
2. `spawnNativeNpcEntityInContext` — calls the same lower-level writer directly,
   without passing through the PF-69 stored-controller guard.

That low-level writer can either register the controller of an **existing**
physical scene actor or create a **new** physical scene actor. Checking only
`materializeStoredNativeController` therefore did not protect every path to
materialization of a damaged, replayed, or incorrectly tagged original ship.

## Fix

The **same source-pinned PF-58 transformer** now injects a second fail-closed
guard at the beginning of `materializeNativeRuntimeEntity`, before either
physical side effect. The guard requires:

- Consistent original native entity and native controller identity (PF-69
  `pf58OriginalNativePairValid`), including assignment, pilot, system,
  generation, profile, loadout, selection metadata and ambient runtime;
- A loaded scene whose system matches the original PF entity;
- Explicit original PF feature flag;
- Successful `coopPersonalFleetNativeBindings.authorize(...)`, which must read
  the **real durable original GameStore** authority, not a client-provided flag.

The common marker detector now also treats stale `selectionKind`,
`personalFleetAssignmentID`, `personalFleetPilotID` and
`personalFleetGeneration` as PF identity indicators, preventing an incomplete
record from silently flowing through the ordinary NPC path. Ordinary unmarked
NPCs do not require the PF authorization and continue through their original
path.

The stored-controller guard remains in place, because it must reject a
compromised row **before** definition resolution or startup pruning. The shared
low-level guard is the mandatory second fence for both callsites.

## Evidence

- Inspected exact original service blob `ca039daaaad2839d17f7109de2f3834cec0373a8`
  from `pas7-studio/EveJS`, branch `coop/pas7std`, and verified the low-level
  signature and both actual callsites.
- New `test_pf71_common_native_entrypoint.py`: 3 Python tests PASS, including
  18 Node VM scenarios; verifies both fresh and preexisting scene-actor paths
  refuse mismatched/corrupt PF rows **before** spawn/register side effects.
- PF-69/70 existing 3 Python VM tests PASS with the common entrypoint present;
  PF-58 original synthetic source fixture also updated for the new pinned
  function signature.
- Does NOT constitute an original game server boot or two-client E2E.

## Pending WORK gate

Source-pinned builder and all modules must be synchronized from PR #350, then
`Test-PF62-Local.ps1` and PF68 isolated WORK installation must be run on a
real clean native EveJS checkout. The full PF70 real adoption contract still
requires the synchronized native `.cjs` dependency; it was not available in
this isolated patch-only container.

No PLAY change, no deployment or feature enablement. PR remains Draft.
