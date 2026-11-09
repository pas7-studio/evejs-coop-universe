# PF108 — exact native ItemStore SQLite row contract and migration checklist

**Status:** source-inspected, PF108 foreign-writer gateway corrected; original
native feature **BLOCKED** until all other original readers/writers agree.
PR #350 Draft, no PLAY or main mutation.

## PF109 implementation update — 2026-11-09

The paths listed in the **historical PF108 findings table below** are
no longer all source-unimplemented: PF109 has changed the exact native
PF52, PF54 (both archive/staged sources), PF57 stock ship absence,
PF58 atomic ship title, handoff, permit and reciprocal custody, and
FirstPlay order witness to actual native itemID rows.

PF109 additionally migrated FirstPlay player-follow source, NPC combat,
physical recovery and terminal docking checks. It staged a 14-case
flat SQLite regression suite and updated the local first-play runner.
PF52 and PF54/PF58 onboarding fixtures were also updated.

**This does NOT close the full P0 readiness gate.** The native PF57
loss path includes other original NPC asset tables whose native
`ROW_GROUPS` layout still requires review. Other untouched original
writer owners may bypass the new ItemStore gate. Historical PF58/PF89/
PF90 test fixtures still include `items/items` and must be replaced
before a full clean original Node/SQLite gate can be claimed. PF109
source tests and manual syntax inspection are not physical gameplay.

Follow `scripts/personal-fleet-firstplay/README.md` PF109 notes for
the exact source modules and remaining acceptance gate.

## Original SQLite truth

Original `Code/server/src/gameStore/sqliteStore.js` Git blob:
`d851fb5a84added2d4527c34407879e8a009bb74`.
`ROW_GROUPS` excludes `items`; `explodeToRows('items', root)` emits a
flat SQL row `{key: String(itemID), value: originalItem}` for every item.

Original `Code/server/src/space/coopGameStoreAtomic.js` supplies:
`tx.scan('items')`, `tx.get('items', String(itemID))`,
`tx.put('items', String(itemID), originalItem)`, and
`tx.del('items', String(itemID))` under one `BEGIN IMMEDIATE`.

**Never** use `tx.get('items','items')` or `tx.put('items','items', root)` in
the ORIGINAL physical SQLite transaction. No row with key `items` exists.
The legacy source tests that fabricated one are NOT evidence of gameplay.

## Corrected in this PR — PF108

- `coopPersonalFleetOriginalForeignItemWriterGateway.js`: one original
  transaction, exact row scan, canonical itemID validation, old/new
  native PF58 custody predicate through a read-only adapter, original
  per-item put/delete, no full-root 2MB row.
- `tests/personal-fleet-original-foreign-item-writer-gateway.test.cjs`:
  now models native SQLite rows rather than a mock aggregate.
- `tools/build_original_itemstore_owner_patch.py`: pins the original
  `sqliteStore.js` blob, verifies flat item layout, fails closed on drift.

## Confirmed other legacy aggregate-root assumptions — still P0

These are **source-inspected** paths in the staged modules, not estimates:

| Original candidate module | Lines inspected | Required correction |
| --- | --- | --- |
| PF52 `coopPersonalFleetHangarBridge` | 133 | Read the original stock ship itemID row for reservation |
| PF54 `coopPersonalFleetOriginalDeployment` | 192 | Verify the physical ship per-item in the original deployment transaction |
| PF57 `coopPersonalFleetContractLifecycle` | 269, 299 | Verify loss/cargo, wreck/terminal custody using real stock item rows |
| PF58 `coopPersonalFleetOriginalNativePermit` | 107, 241, 309, 325, 378, 381, 419, 581, 698, 704, 741 | Convert all native permit, reciprocal, player activation and character writer checks; per-item writes ONLY |
| PF58 `coopPersonalFleetNativeBootstrap` | 36, 48 | Convert original atomic title transfer from aggregate put to physical itemID write |
| FirstPlay `coopPersonalFleetOriginalOrderWitness` | 43, 158 | Check native actor/target through original stock itemID rows |

Additional source owners and the rest of PF80/first-play must be scanned for
aliases (`ITEMS`, `ITEM_TABLE`, and unquoted `tx.get`/root writes). A
successful static code review is **not** a proof of installed reciprocal
writer hooks, real NPC order arbitration or physical gameplay.

## Required before declaring original WORK runnable

1. Move each affected source owner to the per-item SQLite row layout,
   with original custody checks and canonical ship item IDs.
2. Update existing PF52/PF54/PF57/PF58 tests to use actual flat SQL rows;
   synthetic aggregate fixtures must not count as acceptance.
3. Verify on-disk SQLite transactions, denial/rollback, restart recovery
   and no duplicate hull/cargo/ISK in an **isolated WORK** checkout.
4. Only then build the real original `ReciprocalWriterOwners` owner-hook
   attestation, integrate competing native writers, and run two-client E2E.

No gameplay or release claim is made by this document.
