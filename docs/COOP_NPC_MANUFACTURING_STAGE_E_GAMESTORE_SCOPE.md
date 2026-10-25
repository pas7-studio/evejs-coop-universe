# COOP-032E — NPC industry kernels inside a verified GameStore transaction

**Status: manual isolated proof only. Default-OFF. Not a live NPC factory.** This PR is stacked on #54 (GameStore bridge), #51 (offline delivery), #50 (offline installer).

## Problem closed

The existing verified COOP-032B installer and COOP-032C delivery own their transaction through SQLite `db.exec("BEGIN IMMEDIATE")` and `db.exec("COMMIT")`. Passing an independently opened SQLite connection to a running GameStore is unsafe (stale caches, debounced flushes and worker outbox). Rewriting the validation algorithms in another implementation would create a second risk of item/ISK duplication.

`integration/coopNpcIndustryGameStoreScope.cjs` solves the composition problem **without a separate SQLite connection**:

- Takes only `gameStore.coopAtomicNativeRows.transact(tables, fn)`.
- Inside its callback, provides a **restricted virtual SQL facade** over `tx.get/scan/put/del`. It supports only the exact SQL statement families already used by COOP-032B/C: native row SELECT, key-prefix industry job SELECT, INSERT UPSERT and DELETE. The facade never exposes a raw SQLite connection.
- The old kernels receive this virtual, transaction-exclusive adapter as their `db`; it fulfills the kernels' `offlineExclusive` dependency only because it is a scoped *in-process fake SQL interface*, never because the live database is offline. The original offline-only public modules themselves remain unchanged.
- The kernels' virtual BEGIN / COMMIT / ROLLBACK track intent but do **not** touch the physical DB transaction. GameStore commits **only** if a kernel returned `INSTALLED`, `ALREADY_INSTALLED`, `DELIVERED`, or `ALREADY_DELIVERED` and requested virtual COMMIT. Any thrown validation error or a kernel returning `BLOCKED` forces a thrown exception to GameStore, so its **physical SQLite transaction ROLLBACKS** any earlier writes.
- An ambiguous SQLite COMMIT or poisoned GameStore cache exception is not converted into an ordinary gameplay response. Its fatal fail-closed handling belongs to COOP-032D.

## Explicit safety gates

Two flags are required **even for the manual isolated proof**:

```
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_NATIVE_NPC_TX_PROOF=1
```

Both OFF by default. The module is **not** included in `scripts/patch-evejs-coop.cjs` runtime module list; it cannot be invoked by NPC scheduler, client, native GM code or any other shipped gameplay path. It does not export `supportsAtomicInstall:true` or `supportsAtomicDelivery:true`. No owner or quote verifiers are implemented: they must be supplied as trusted callbacks when constructing the adapter. Tests inject permissive callbacks **only in disposable test stores**, never live.

## Test cases and evidence

`tests/coop-npc-industry-scoped-sql.test.mjs`: **10/10 PASS locally** against the real new SQL-facade code on Node 22. Includes exact B/C SQL syntax, unknown SQL/table rejection, prefix-only queries and transaction-intent enforcement.

`tests/coop-npc-industry-gamestore-scope.test.mjs`: six tests committed against `node:sqlite` disposable databases for:
1. Installer exactly-once debit of real native-shaped mineral items, corporate ISK, BPO and job; never touches foreign property.
2. READY + elapsed FILETIME gating, native output stack, allocator progression, BPO return and replay safety.
3. Fault after wallet charge rolls back all install tables.
4. Fault after output issuance rolls back produced item and ID allocator.
5. Both explicit flags required.
6. SQL injection, non-manufacturing tables and unbounded LIKE scans prohibited.

These six integration tests **have not yet been executed in this conversation against the complete source tree**. The isolated GameStore/persistence-worker runtime verification from PR #54 also remains unexecuted; do not treat the above as acceptance to deploy.

## Next P0 runtime acceptance

1. Run all `tests/coop-npc-industry-*.test.mjs` in the complete repository and fix any failures, including production `better-sqlite3` integration on an attested disposable GameStore.
2. Replace permissive test verifiers with canonical native quote/SDE/material, NPC corporation and station ownership, BPO and item-ID namespace authorities; never trust a client-supplied price or fake character/session.
3. Confirm stock READY state transition and its persisted lifecycle (not merely elapsed time), in-process cached `itemStore` visibility, worker recovery and restart integrity.
4. Only after all this, register a separate feature-gated factory NPC tick that delegates to `createNpcIndustryScopedProof` logic, promote `supportsAtomicInstall/Delivery`, then build COOP-033 sell escrow and player buy.

No merge to `main`, no live Docker changes, no `evejs-data` writes, no market reseed, no unverified claim of playable native manufacturing.
