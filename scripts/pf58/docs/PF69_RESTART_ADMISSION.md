# PF-69 — original native ship/controller pair admission

**Review-only; gameplay remains OFF.** This is a source-pinned correction to
`scripts/pf58/build_native_stock_fittings_patch.py`, not a deployed engine edit.

## P0 finding

The PF58 guard inside `materializeStoredNativeController()` previously entered
its original-ship authorization path only when the native **entity** contained
`personalFleetOriginal: true`. A stored **controller** with Personal Fleet
markers but a missing/unmarked/mismatched entity could be routed through the
ordinary NPC materializer. It could register/spawn or mutate a runtime ship
without proving a coherent original ownership pair. This matters after a
partial native row write, crash, or orphaned/foreign native record.

## PF69 correction

Before NPC definition lookup, runtime registration or scene spawn:

- If **either** entity or controller has a PF original marker (explicit flag,
  operator kind or entity type), require **both** records to identify the
  same original ship (`entityID`, `systemID`), assignment, pilot and generation.
- Require the expected server-written PF58 operator kind and entity type on
  **both** rows, `nativeAmbient` controller kind, matching nonempty profile,
  loadout and behavior IDs, and matching selection assignment IDs.
- Require a valid positive original owner ID on the entity. Continue to call
  the existing **original** PF58 GameStore permit verifier; no pure marker or
  local flag grants permission. A missing or mismatched pair fails CLOSED.
- Unrelated ordinary native NPC rows without any PF markers keep their
  original startup behavior and do not contact the PF permit verifier.
- Retain original `ca039daa...` service source pin, all PF59/PF66 source
  transforms, feature OFF, and no automatic partial-adoption repair.

This gate **does not** prove the absence of an unmarked stock ItemStore ship
collision, establish any global writer fence, or connect a real server bootstrap.
Original GameStore/ItemStore/native scene readback still must be tested on WORK.
Do not use this fix to enable Personal Fleet on PLAY.

## Evidence

The existing PF58 Python patch-builder tests remain 7/7 PASS. New
`tests/test_pf69_restart_pair.py` adds 3 PASS (including Node 22 VM execution of
the exact patched `materializeStoredNativeController` entrypoint with 26
identity, marker, feature, binding and ordinary-NPC assertions). All are
**isolated tests**, not an original EveJS native WORK run.

From the PR #350 checkout, the existing `Test-PF58-Local.ps1` automatically
includes the PF69 Python tests via `unittest discover`.
