# ALIFE-11 — mixed original native transient/persistent NPC cargo

**Status:** implementation in Draft PR; 18 file-backed SQLite regression tests authored, plus existing GameStore and ALIFE-10 suites. Nine physical server E2E **NOT_RUN**. Feature OFF by default. Protected `evejs-data` unchanged.

## Original EveJS authority

The pinned original `gameStore/index.js` tracks ephemeral values via `transientPaths[table]` and excludes them in `buildFlushSnapshot()` before writing SQL. The original `sqliteStore.ROW_GROUPS` does **not** split `npcCargo`: all cargo stacks are serialized in the same SQLite `npcCargo` row keyed `cargo`. `npcCargo` has scalar allocator metadata such as `nextCargoID`. Thus a naive table-wide bypass of GameStore's transient guard would either persist otherwise transient NPC cargo or evict it from the live cache on post-commit reconciliation.

## Implementation

New `coopNativeCargoTransientIsolation.cjs` provides strictly synchronous `capture`, `guardMutation` and `rehydrate` operations. `coopGameStoreAtomic.createGameStoreAdapter` enables them **only** if all are true:

- `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`
- `EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC=1`
- `EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION=1`
- Transaction is exactly the single original GameStore `npcCargo` table.

Other table transactions retain the original `NATIVE_TRANSIENT_STATE_UNSAFE` behavior.

Before SQL `BEGIN IMMEDIATE`, GameStore reconciles any in-flight worker and checks a successful synchronous flush. Isolation then validates **every** active transient path as exactly `/cargo/<canonical-positive-safe-integer-ID>`. Each shadow cargo must exist once in the in-process cache, carry its correct original cargoID/entityID/ownerID/typeID/positive integer quantity and `transient:true`, and have no SQLite row with that ID. After removing only those paths from the cache snapshot, the entire remaining GameStore table must match the actual native SQLite snapshot byte-semantically.

The GameStore-only wrapper prevents `tx.put(npcCargo,cargo)` from including any shadowed cargoID and forbids deleting the whole cargo root during the transaction. It also requires precisely one cargo-root update and one matching, immutable COMMITTED haul-transfer receipt; SQL changes to counters, unrelated keys, duplicate receipts and partial write sets are rejected before COMMIT. The existing ALIFE-10 atomic writer is unchanged: same original persistent cargoID moves miner→hauler together with one immutable COMMITTED receipt, `synchronous=FULL` before `BEGIN IMMEDIATE`.

After COMMIT, the original SQLite GameStore snapshot is loaded and each original ephemeral row is restored **only into the in-process cache** after checking the original `transientPaths`, original row identity, and noncollision with the committed SQL root. Persistent cache references stay stable; GameStore flush baseline is rebuilt from the durable SQL records, which exclude shadow cargo. Any post-commit disagreement poisons the original GameStore writer and triggers its existing fatal fail-closed handler.

## Proof and test scopes

- `tests/coop-native-cargo-transient-isolation.test.mjs`: 25 test scenarios using disposable real `node:sqlite` WAL/FULL database. Cover multiple transient actors, no phantom durability after reopen, source/witness rollback, forbidden SQL writes, wrong path markers, DB collision, stale GameStore cache, unresolved worker flush, postcommit poison, allocator integrity.
- Existing `coop-gamestore-atomic.test.mjs` tests preserve the original transactional bridge and table allowlist; existing ALIFE-10 tests preserve exact cargo ownership.
- GitHub Action `.github/workflows/alife11-native-cargo.yml` runs the atomic suite on the branch and PR with Node 22.
- Windows read-only+disposable test runner: `pwsh -File scripts/Run-Alife11-Native-Cargo-Isolation-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'`.
- Nine physical E2E steps in `tests/scenarios/alife11-transient-cargo-isolation-e2e.json`: **NOT_RUN** until actually tested on a disposable original world, including two cold restarts and two clients.

## Unresolved restrictions

1. No multiple independent GameStore owner processes. Synchronous JavaScript and SQLite transactions only protect one authoritative process; external mutation is not covered.
2. Any malformed, parent, stale, conflicting, unmarked or noncanonical transient path fails closed. Migration or auto-removal is deliberately excluded.
3. Original NPC cargo manager may create transient objects lacking `row.transient===true`; those are safely blocked pending a targeted original source fix. Do not loosen the predicate without evidence.
4. ALIFE-08 actor startup slots and the physical station/warehouse are independently fenced; this does not create a whole-world atomic transaction.
5. Do not enable flags on preserved `evejs-data`, and do not claim complete live gameplay readiness before passing real physical two-client source→cargo→station E2E.
