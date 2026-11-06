# PF90 — original ItemStore and characterState single-writer integration gate

**Draft PR #350, default OFF.** This is candidate native custody code,
not a deployed original-engine modification. GitHub App cannot write to
`pas7-studio/EveJS` (`Resource not accessible by integration`, HTTP 403).
Do not change PLAY or merge main; native WORK acceptance is NOT RUN.

## Exact original source evidence

On `pas7-studio/EveJS@coop/pas7std`:

| Original file under `Code/server/src` | Git blob SHA1 |
| --- | --- |
| `services/inventory/itemStore.js` | `e992d56ee9cff1911d54247bf46d44d01e5d8060` |
| `services/character/characterState.js` | `8a002d190899b6cb1e1068a565451e6d1d808401` |
| `gameStore/index.js` | `a982b8a3d607cb9487a65336bcfdcbba929797b5` |
| `gameStore/tableRepository.js` | `f3fbd1ed17223f601ba1c145b13fb77bcd98c27f` |
| `space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` |

The **original** `itemStore.readItems()` returns a shared
`itemsTableCache` reference. A typical original mutator edits this
reference before calling `itemStore.writeItems(data)`. That writes
through `repo.write('items','/',...)`. Original GameStore's
full-table `write()` mutates its shared cache, marks it dirty and calls
`scheduleFlush(table)`; the write is not the same original SQLite
transaction as a separate read-only PF88 guard. In a direct test of
the two actual original ItemStore functions with a fake failed
`repo.write`, `writeItems()` returned false **but the modified item
was still visible in `readItems()`**. This is the alias/cache risk.

`characterState.writeCharacterRecord()` independently invokes its
`repo.write('characters', '/<characterID>', record)` owner seam,
including the original `setActiveShipForCharacter` path. A separate
PF88 check followed by this write would permit a competing PF87 handoff
between the check and this write.

## Added candidate API, not yet wired into original engine

The same already-bundled native module
`scripts/pf58/native/coopPersonalFleetOriginalNativePermit.cjs`
now implements:

`createReciprocalWriterFence({pf52})
.commitOriginalOwnerSnapshot({tx,writer,expectedBefore,nextItems,declaredItemIDs})`.

The **original owner** must capture a detached `expectedBefore`
*before any mutation*. The candidate method rejects malformed/non-JSON
snapshots and compares `expectedBefore` to the original
`tx.get('items','items')` **inside a single BEGIN IMMEDIATE**.
If another writer has changed it, returns
`PF90_ORIGINAL_OWNER_STALE_SNAPSHOT` without touching physical rows.

When equal, it delegates to PF89's actual before/after item diff,
original ship ancestry, PF52 reserved-hull/PF actor/PF58 handoff/PF60
terminal custody checks, and a single `tx.put('items','items',next)`
prior to durable commit. The API receives **plain snapshots**, not
an untrusted callback with access to `tx`. It is exposed by the
candidate source-bound bootstrap as
`commitStockOwnerSnapshotWithinTransaction`.

**This does not mean original ItemStore is calling the API!**
Normal ItemStore still owns its `items` table, and `characterState`
still owns `characters`. A real single-writer refactor in the
original engine fork must preserve those domain owners, original
cache/index invalidation, event ordering, transient cargo protections,
client notifications and original inventory `itemID`. Do not add
a second runtime owner, monkey patch `repo.write`, or invoke a
read-only check followed by a later asynchronous write.
Stock mutation sites that already mutate shared caches before commit
must be refactored to use detached draft state or must rollback their
cache on failure. This must be tested locally against real GameStore.

## WORK review gate (never gameplay activation)

The manual PF80 `-ApplyToWork` PowerShell preflight now:

1. Executes the new PF90 snapshot and original-source Node tests.
2. Source-pins the five original stock ownership/cache/transaction modules.
3. Executes a **read-only** original-owner audit which must report
   `BLOCKED_FOR_ACTIVATION` and exit 2. Its verified baseline is
   the unchanged original source with missing custody hooks, not
   fake markers or a silent success.
4. Continues only to a review-only WORK bundle with Personal Fleet OFF.
   Missing, modified/unreviewed, unreadable or forged original source
   is blocked until owners intentionally re-review and re-pin.

Tests on a local Windows agent (Node 22+, Python):

The combined launcher also verifies the PF90 SHA256 archive and preserves the
native checkout unchanged:

```powershell
./scripts/pf90/Test-PF90-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

Individual commands:

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf90-owner-snapshot.test.cjs
$env:PF90_NATIVE_WORKTREE = 'C:\Games\EveCoop\upstream-evejs'
node --test --test-concurrency=1 scripts/pf90/tests/pf90-original-owners.test.cjs
node scripts/pf90/inspect-original-owner-writes.cjs --fork-root $env:PF90_NATIVE_WORKTREE
# Source audit deliberately exits 2: NOT gameplay-ready.
python -m unittest discover -s scripts/pf58/tests -p 'test_pf90_*.py' -v
```

## What still blocks release

- Original ItemStore owner integration and rollback/index/cache proof.
- Original character active-ship transaction / player-session fencing.
- Mining/WAR/Exploration reciprocal write coverage with original process.
- Native WORK server boot, SQLite crash/restart, two-client observed
  ownership, fitting/cargo, commands, wallet/payroll, docking and combat.
- Written authorization for activation/merge from the owner.

This file is a contract and risk record. It is not an installed
server patch and must never be described as completed gameplay.
