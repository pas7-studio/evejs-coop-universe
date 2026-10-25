# COOP-032D — In-process native GameStore atomic row bridge

**Status:** code-complete infrastructure prototype, **NOT live production-authorized**. Stacked on COOP-032C PR #51 (which itself depends on COOP-032B #50). No NPC job installer/delivery adapter enabled.

Pinned upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Native integration
The single existing `scripts/patch-evejs-coop.cjs` overlay now registers `integration/coopGameStoreAtomic.cjs` as `server/src/space/coopGameStoreAtomic.js`. The reversible `scripts/coop-gamestore-atomic-patch.cjs` inserts exactly one native export statement into each of:
- `server/src/gameStore/sqliteStore.js`: grants internal, same-connection `createSqliteAdapter(() => requireDb())`;
- `server/src/gameStore/index.js`: binds its **private live** cache, dirty flags, flush timers, SQLite baselines, in-flight persistence map, and inventory invalidator to the GameStore adapter;
- `server/src/services/inventory/itemStore.js`: adds a flag-gated index invalidation export, clearing stale item indexes and reserved item ID batches on commit.

The API `gameStore.coopAtomicNativeRows.transact(tables, syncMutation)` requires `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`; **default OFF**. Only allowlisted native tables are accessible: `items`, `corporationRuntime`, `industryBlueprintState`, `industryJobs`, `identityState`.

The transaction wrapper:
1. Reconciles buffered/worker writes via existing `flushTableSync` for **each declared affected table**; rejects failed flushes, remaining dirty/in-flight work, and transient state.
2. Verifies the inventory index invalidator is available *before* any durable commit.
3. Uses the pinned SQLite connection and `BEGIN IMMEDIATE`. The synchronous mutation receives only `get/scan/put/del` for declared native tables; raw DB handle never escapes. Exception or asynchronous return causes ROLLBACK.
4. After COMMIT, reloads affected native tables, reconciles the mutable cache **in place** (preserving existing table/record references), advances each SQLite baseline and invalidates native inventory indexes and ID prefetch.
5. On any post-COMMIT refresh failure, marks the bridge poisoned and invokes a fatal process exit code 70. The emulator must restart/recover rather than serve stale GameStore state.

This bridge **does not make legacy player industry calls atomic**. It does not export `supportsAtomicInstall` or `supportsAtomicDelivery`; both remain false. Neither the COOP-032B installer nor the COOP-032C delivery kernel is connected to it yet. No scheduler, market order, NPC stock mint or user-facing code path changed.

## Test evidence
Local Node 22 disposable SQLite prototype: **15/15 PASS** `tests/coop-gamestore-atomic.test.mjs`; reversible patch helper fixture proof: **5/5 PASS** `tests/coop-gamestore-atomic-patch.test.mjs`. Regression cases: four-table commit, rollback, default OFF, allowlist, reentrant call, rejected Promise, stale worker, flush failure, transient cache, identity ID mutation, post-commit poisoned state and unchanged references. The project test files are committed to the PR; no remote CI or GitHub Actions.

**Important limitations:** these tests use `node:sqlite` and injected GameStore-shaped fakes. They do not prove the exact pinned `better-sqlite3` production connection, in-flight worker timing, full project overlay roundtrip, client inventory UI or Docker restart. The code cannot safely be enabled on `evejs-data` until independent runtime tests cover those gates.

## Next P0
- Test the *actual pinned upstream* `sqliteStore` + `gameStore` in an **attested isolated store** (`npm run test:isolated`); verify `--dry-run`, reversible full overlay roundtrip and `--check` without touching live Docker.
- Inject real worker acknowledgment/recovery faults and concurrent stock item/wallet writes. Confirm the pending outbox contains no late stale write after a native atomic transaction. Exercise cache references and actual `itemStore.findItemById/listOwnedItems`.
- Port COOP-032B install and COOP-032C settlement operations onto the restricted transaction `tx.get/scan/put/del` API rather than passing an externally opened SQLite handle; re-bind canonical SDE quote, owner/facility verification, and item metadata/ID allocator.
- Only once isolated crash/restart tests and owner-controlled live gameplay gate pass, opt in and allow the COOP-032A coordinator to schedule NPC factories; then implement COOP-033 real NPC escrowed sell orders and player purchases.

Safety: no main merge, no CI, no Docker, no player or NPC wallet changes on the deployed server, no market reseed, no `evejs-data` modification.


## P0 hardening, 2026-10-25

After reviewing the first implementation, two fail-closed defects were corrected on the same draft branch:

- The low-level SQLite writer now has a `claimTransactor()` one-time ownership handshake. The GameStore adapter acquires the claim once during initialization. A second caller cannot directly transact behind the GameStore cache, and the low-level writer separately checks `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`.
- A thrown error during SQL `COMMIT` is treated as **ambiguous durability** even when the SQLite driver may have committed the transaction before returning an error. The error is marked `coopCommitOutcomeUnknown`; GameStore poisons the bridge and invokes fatal termination, just as it does for post-commit cache/metadata failures. Restart/reconciliation must establish actual DB state.

Three new local regression scenarios confirm lost COMMIT acknowledgement, exclusive writer claim and lower-level default-OFF rejection. Updated `tests/coop-gamestore-atomic.test.mjs` now contains **18 cases**; `tests/coop-gamestore-atomic-patch.test.mjs` remains **5 cases**. Combined with the 20-stage-C cases the local suites ran **43/43 PASS** on disposable `node:sqlite` SQLite. They still do **not** prove actual pinned `better-sqlite3` correctness.

Manual real-engine gate now has a committed runner:

```sh
node scripts/Verify-Coop-GameStore-Atomic-Isolated.cjs --code-path /path/to/pinned/EveJS/Code
```

The runner checks the exact pinned upstream revision and deployed overlay module, creates a **fresh temporary GameStore**, enables the actual persistence worker and the atomic flag only in a child process pointed at that temporary data directory, exercises stock writes and a native multi-table mutation, checks inventory index and state, restarts the process against the same disposable database and rechecks persistence. Any missing engine, pin mismatch or failed test reports BLOCKED. It never modifies the pinned tree or live `evejs-data` and deletes the test directory afterward.

**Current gate remains BLOCKED / NOT EXECUTED:** the cloud runtime used for this PR has no pinned EveJS checkout and no `better-sqlite3` package. A local host with the pinned overlay must run the command and publish the actual output before anyone may enable manufacturing.
