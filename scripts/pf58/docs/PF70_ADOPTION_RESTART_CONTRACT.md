# PF-70 — adopted original entity and PF-69 restart verifier must agree

## Finding

PF-69 rejects a Personal Fleet original entity unless its `selectionID` equals
`personalFleetAssignmentID` and the controller has the same `selectionID`.
But PF-58's `createNativeShipAdoption` previously wrote `selectionID` only to
`nativeController`, not the persisted `nativeEntity`. Hence a valid, one-shot
adoption could commit two original native rows that PF-69's own native
materialization guard would always reject. Existing tests fabricated an
`entityRecord` with `selectionID`, hiding the incompatibility.

## Fix

- PF-58 writes `selectionKind:'PERSONAL_FLEET'` and
  `selectionID:row.assignmentID` to the **original entity** (no new itemID).
- PF-69 verifies both entity and controller `selectionKind` and `selectionID`
  before any original NPC definition load, controller register or physical spawn.
- The existing PF-58 source-pinned service patch is used; this does not add a
  separate patch to the 19-file PF-62 bundle.
- `test_pf70_real_adoption_pair.py` executes the real production CJS
  `createNativeShipAdoption()` through isolated original-shaped dependencies,
  captures both original native rows, and invokes the exact JavaScript
  `pf58OriginalNativePairValid` function from the PF-69 source patch. It tests
  admissibility and six mutually inconsistent/corrupt variants.
- Existing native adoption tests additionally assert identical selection
  ownership metadata.

## Scope and safety

This tests schema compatibility in isolated Node processes only; neither the
actual EveJS native fork nor WORK E2E is executed. No original ItemStore,
scene, wallet, ship, or production data is modified. Original side effects are
still gated by PF58/PF59/PF60/PF61/PF66 and all reciprocal writers must be
fenced in the genuine native server. Keep the feature flag OFF, PR Draft,
PLAY/main unchanged.
