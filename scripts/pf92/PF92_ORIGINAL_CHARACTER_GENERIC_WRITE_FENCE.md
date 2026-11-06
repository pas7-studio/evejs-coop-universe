# PF92 — Generic original character owner row mutation fence

**2026-11-07 · Draft PR #350 · Personal Fleet OFF · not installed in original EveJS.**

PF91 protected the specific player `activateShipForSession` transition,
but the original `characterState.writeCharacterRecord(charId,record)`
also receives writes from `updateCharacterRecord()`, normalized
`getCharacterRecord()` and `itemStore.syncCharacterActiveShip()`.
Protecting only the UI ship switch is not complete. The original
owner is still the sole writer of each `characters/<characterID>`
SQLite row; this candidate does not replace that owner or install a
runtime hook.

## Actual original code / source authority

The original writer source pins were already established by PF90:
`scripts/pf90/inspect-original-owner-writes.cjs`. PF92 **reuses** those
pins rather than duplicating a second manifest.

`scripts/pf92/tests/pf92-original-stock-character-routes.test.cjs`
reads the original owner files (when `PF92_NATIVE_WORKTREE` is set).
It verifies the normalization/write path, generic updater and
ItemStore-to-characterState handoff with original source. No fork,
PLAY, SQLite store or client modifications are made.

## Candidate PF92 owner barrier

Existing original native permit module exports:

`createOriginalCharacterRecordWriteBarrier({
   pf52,verifyOriginalSessionLease
 }).inTransaction({
   tx,characterID,expectedBefore,nextRecord,session
 })`.

The session witness is bound at **construction** (default denies),
not passed or spoofed per write. A future original
`characterState.writeCharacterRecord` integration must call this
method with the *same* original `BEGIN IMMEDIATE` SQLite transaction
that writes the canonical `characters/<characterID>` row.

The current implementation:

1. Requires the exact detached original `before` image and validates
   the caller's proposed JSON `nextRecord` and `characterID`.
   A stale original row fails closed. Unchanged rows are no-ops.
2. Detects changes to **any** of `shipID`, `shipid`,
   `activeShipID`, `shipTypeID`, `shipName` or `storedShips`.
   Generic wallet or skill updates are not misclassified as ship
   title transfers, but still cannot overwrite a newer character row.
3. Denies noncanonical/contradictory active-ship aliases. The
   PF91 original rowset inspector now rejects corrupt active fields
   or two different alias IDs in **any** character record.
4. For a protected change, demands a source-bound session lease,
   resolves both the old and the proposed physical original hulls,
   and checks every touched hull's PF52 reservation, PF actor,
   PF58 handoff and PF60 terminal custody in the same transaction.
5. Scans all original per-character rows for a competing active owner.
   A retained title undergoing metadata repair is allowed to be
   active for its **same** owner, never for another character.
6. Requires physical original `itemID`, `ownerID`, ship category
   and target `shipTypeID`; when stock `itemName` is supplied,
   the next `shipName` must match it. Never mint a second ship.
7. Gives the original session witness a **read-only** `get/scan`
   facade, not the stock `tx.put`/ `tx.del` writer. It rechecks
   the witness and custody immediately before commit. If an
   untrusted witness has nevertheless captured a direct tx and
   modified a row, the method **throws** to force outer SQLite
   rollback, even if the witness returned `false`.
8. Updates exactly the real `characters/<characterID>` row and
   checks the same transaction's readback before returning success.
   No independent `repo.write`, client notification, actor spawn,
   wallet debit or new item is performed.

The PF58 source-bound bootstrap exposes a guarded
`commitStockCharacterRecordWithinOriginalTransaction(args)` API.
That bootstrap additionally requires `enabled()===true`,
`allWritersFenced()===true` and an unpoisoned native GameStore.
The PF88 independent original writer-hook witness remains mandatory
and **is not installed in the fork**.

## Manual local evidence

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf92-character-record-barrier.test.cjs scripts/pf58/tests/pf88-sourcebound-gating.test.cjs
$env:PF92_NATIVE_WORKTREE = 'C:\Games\EveCoop\upstream-evejs'
node --test --test-concurrency=1 scripts/pf92/tests/pf92-original-stock-character-routes.test.cjs
python -m unittest discover -s scripts/pf58/tests -p 'test_pf92_*.py' -v
```

There are 26 new Node fixture cases, four original-source Node
cases and five static Python assertions, plus the updated PF88
source-bound bootstrap test. The PF58 manual tests and PF80 WORK
review preflight run PF92 before any native WORK review artifacts.
These tests are **authored, not a substitute for running the real
Node/SQLite suite**. An isolated V8 transaction stub exercised
9/9 actual candidate module behaviors; it is not real SQLite,
original WORK server or two-client gameplay.

## Still required for actual gameplay

- Original fork commit installing a single-writer
  `characterState.writeCharacterRecord` ownership hook; the GitHub
  integration currently returns HTTP 403 for that fork. Never
  monkey-patch or rewrite source at runtime.
- Preserve original GameStore item and character cache invalidation,
  stock owner repository semantics, transient row isolation,
  in-space character side effects and client notification ordering.
- Prove native session lease prevents session changes **during** the
  stock SQLite transaction, not merely with two callback reads.
- Verify every native character write route, Mining/WAR/Exploration
  writer integration, crash restart and two-client WORK E2E.
- Keep Personal Fleet OFF and PR #350 Draft until those gates pass.
