# Chat 40 — native economy durability, cache coherence, and recovery

**Scope:** `pas7-studio/evejs-coop-universe` against pinned `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Source-backed review and locally isolated tests, **not** an assertion of live world recovery or native-client acceptance. Never mutate `evejs-data`, bypass native ownership, reset a journal or rerun a possibly paid operation in response to `UNKNOWN`.

## Confirmed cross-domain findings

1. **Critical — postcommit account-cache invalidation disconnected.** `scripts/coop-gamestore-atomic-patch.cjs` supplies `invalidateNativeAccounts` to `createGameStoreAdapter`, and `scripts/coop-npc-account-cache-patch.cjs` exports the character/corporation invalidators, but `integration/coopGameStoreAtomic.cjs` originally did not destructure, probe, or call the supplied function. The existing `tests/coop-gamestore-atomic.test.mjs` even checks postcommit invalidation failure. This permits successful wallet/corporation SQLite changes while separate native account caches retain an outdated view. **Fixed in the L2 atomic adapter:** inspect both relevant native account invalidators *before* any SQL economic mutation, run their commit-mode invalidation *after* reloading the committed tables and item indexes, poison the bridge and invoke existing fatal recovery upon failure. The hook was already present; no central runtime or installer changes required.
2. **High — unequal durability between native economic tables.** Pinned `server/src/gameStore/sqliteStore.js` uses WAL and `synchronous=NORMAL`. The existing COOP atomic adapter escalated to `synchronous=FULL` only for special mining/hauling table sets. A successful atomic wallet, inventory, escrow, industry or contract commit could therefore use weaker SQLite power-failure durability. **Fixed for the opt-in atomic API:** set and verify `PRAGMA synchronous=FULL` before `BEGIN IMMEDIATE` for every allowlisted economic transaction; preserve mining gate and previous mining/hauling error codes. A rejected pragma cannot proceed to wallet or item mutation. The setting applies to the process connection after use and may increase write latency. It does *not* alter the separate persistence worker connection or Rust database.
3. **Separate Rust market DB is not jointly atomic with GameStore.** Market reservation/fills, native wallet/items, escrow and NPC jobs retain independent state and ACK boundaries. Existing adapters (`coopNpcBuyerRecoveryAudit`, `coopNpcPendingMarketEscrow`, `coopNpcCorporateBuyerAtomic`, `coopNpcManufacturingJournal`, `coopNativeContractMutationFence`, `coopNativeTradeAtomic`, `coopNativeHaulTransferAtomic`) each own a subset. **Not solved globally** by toggling synchronous, new journal files or retrying the external Rust RPC. Preserve exact immutable claim/order/fill/item/owner identities and reconcile across the DBs read-only. Every mismatch / lost ACK / incomplete receipt must HOLD pending operator review.
4. **Legacy native industry, contract, PI and itemStore paths are still multiple separate writes.** Opt-in SQLite row transactions do not automatically wrap old native methods. Independent `GameStore` cache flushes, worker outbox and character/corp normalization remain critical. Do not infer full multi-table safety, immutable escrow or crash-safe manufacturing from a source-only guard; production recovery must audit the *actual* completed native receipt and game state.

## L2 change and invariants

`integration/coopGameStoreAtomic.cjs` retains the one-writer `claimTransactor()` model, `BEGIN IMMEDIATE`/`COMMIT`, native table allowlist, rejection of reentrant/async mutations, and poisoned restart for ambiguous COMMIT acknowledgments. **New invariants:**

- Every `transact()` through COOP atomic rows requires successfully verified SQLite synchronous=FULL before BEGIN, not merely mining/hauling.
- When `characters` or `corporationRuntime` is declared, a functioning `invalidateNativeAccounts('probe', tables)` is required *before* mutation. Reject the transaction before any SQL writes otherwise. No requirement for unrelated, inventory-only calls.
- Once COMMIT succeeds, cache refresh and `invalidateNativeAccounts('commit', tables)` must succeed. Any thrown callback or false result poisons/fatals the adapter and forbids automatic replay.
- An exception or lost COMMIT acknowledgment **does not** justify replay. Restart in a controlled environment and determine the real native receipt before taking another action.
- No client binary, central runtime hook, installer, Rust protocol, production feature flag, or live game store modified.

## Read-only recovery / conservation verifier

`integration/coopEconomyConservationAudit.cjs` exports `auditEconomyEvidence(snapshot)` with **ten explicit and optionality-checked arrays**: `nativeItems`, `npcCargo`, `rustClaims`, `gameStoreReceipts`, `marketEscrows`, `industryDeliveries`, `contractReceipts`, `walletSettlements`, `journals`, and `conservationWindows`.

This is a **forensic evidence contract, not a database adapter, writer, or recovery executor**. Source adapters must gather a consistent, quiesced point-in-time snapshot from authoritative stores and normalize only verifiable native records. Missing sources yield `INCOMPLETE`, all-empty sources yield `NO_EVIDENCE`. Mismatched settlement identity, duplicate native item/claim/fill/cargo/operation, orphan Rust or GameStore receipts, disputed escrow custody, partial finalization, ambiguous journal, wallet imbalance and item material imbalance yield `HOLD_MANUAL`. Matched provided evidence yields `SNAPSHOT_CONSISTENT`, **never `LIVE_VERIFIED`**. The checker returns `changed:false` and does not perform a write, network request or wallet update.

Evidence schema notes:

- A `nativeItems` entry is a *current, exclusive, physically persisted* `itemID` / `ownerID` / `locationID` / `typeID` / `quantity` or `stacksize` record. Do not put the same physical object twice in the evidence.
- `gameStoreReceipts` and `rustClaims` carry exact stable `claimKey`, `fillID`, `orderID`; receipts additionally carry `itemID`, `ownerID`, `typeID`, `quantity`, optionally `locationID`. If native item ownership/location has legitimately changed since the receipt, snapshots must be captured at the correct custody stage; `HOLD_MANUAL` prompts reconciliation, not a verdict of fraud.
- `marketEscrows`, `industryDeliveries`, `contractReceipts` carry `orderID`/`jobID`/`contractID` respectively plus exact item/type/owner/location/quantity. For historical rows with no active physical custody, exclude them or mark `active:false` with a complete receipt. The verifier does not assert that a finished job's product must remain forever in the original station hangar.
- `walletSettlements` have unique `operationID`, nonnegative integer `debitCents`, `creditCents`, `feeCents` and must balance (`debit=credit+fees`). This checks supplied receipts, not the entire wallet balance history.
- `journals` provide ordered `operationID` and `phase`; two terminal receipts or a final `PREPARED`/`UNKNOWN` require human reconciliation; benign earlier `PREPARED` followed by one terminal receipt is fine.
- `conservationWindows` are explicit fixed-type, fixed-owner/time-slice balance sheets with `opening`, `produced`, `received`, `consumed`, `destroyed`, `sent`, `closing` as exact nonnegative integer native quantities. All sources and sinks must be included (e.g. loot drops, insurance, seeded NPC buy stock, mission reward grants), or the equation is only a partial check. Arithmetic uses BigInt to avoid JS 53-bit rounding errors.

Do not wire this module to login, live trading, automatic recovery or a timer. Optional deployment wiring and snapshot adapters require agreement with Chat 01 and the market, industry, contracts, cargo and wallet owners. Any future operator CLI must default to read-only and receive explicit permission before touching a saved world.

## Reproducible evidence

Run against the **Chat 40 files** (isolated and ephemeral):

```sh
node --test tests/coop-economy-conservation-audit.test.mjs tests/coop40-disposable-sqlite-recovery.test.mjs
```

These test 27 local cases including native-item custody identity, native+Rust claim divergence, double-escrow claims, wallet and commodity arithmetic, duplicate terminal settlement, a disposable SQLite rollback, a restart and an idempotent replay following a simulated lost client acknowledgment, and a cross-database orphan. No real market Rust daemon was started. Source-executed in-process tests for the **exact modified `coopGameStoreAtomic.cjs`** exercised seven cases: balanced character/corp commit and cache invalidation, missing/probe-failing account invalidator, post-COMMIT account-cache failure and poison, ambiguous COMMIT ACK, missing SQLite FULL durability, and an inventory-only transaction. Both patched JavaScript syntax and all seven mocked-backend tests passed. The new test suite uses `node:sqlite` against disposable temp files; the source-executed bridge tests use a deterministic mocked SQLite driver, **not** pinned `better-sqlite3`.

Pending before release: run existing `node --test tests/coop-gamestore-atomic.test.mjs tests/coop-gamestore-atomic-patch.test.mjs` on a full repository checkout, run `scripts/Verify-Coop-GameStore-Atomic-Isolated.cjs` against a disposable attested pinned checkout, read-only snapshot on a quiesced full GameStore+Rust clone, inject worker lost ACK and unclean process exit, and validate real player wallets/inventory/escrow from two independently authenticated clients across restart. Respect `AGENTS.md`: **do not start remote CI or run a destructive test on live `evejs-data`.**

## Cross-chat handoff and release gate

- **Chat 01:** verify existing native atomic and account-cache export hooks in pinned `--dry-run`/`--check`, test worker outbox/fatal restart. Do not enable broad COOP atomic flags on the running server solely due to unit tests.
- **Chats 29/30:** Rust market buy/sell and contract LP/ISK/escrow require immutable claim/fill/item receipts and matching native poststate; no automatic lost-ACK replay.
- **Chats 17/20/25/27/28:** NPC warehouse, mining, hauling, reprocessing and industry job writes need exact material and native receipt conservation; no guessed item creation after failed delivery.
- **Chats 19/26/33:** mission payouts, planetary commodity transfers and queue SP saves have their own durability boundaries. Do not call this single SQLite bridge proof that those multi-store paths are atomic.

**Result classification: `CODE_READY / LIVE_UNVERIFIED`; no full-world exactly-once or crash recovery guarantee is claimed.**
