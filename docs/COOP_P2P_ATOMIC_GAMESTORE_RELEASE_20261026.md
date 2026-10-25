# P0 — Native GameStore atomic player SELL + Rust post-settlement order release

**Status:** SOURCE_WIRED / DEFAULT_OFF / LIVE_UNVERIFIED. Upstream pin: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## What changed

1. **Original GameStore is the only item/wallet writer.** New SQLite-native table `playerMarketFills` is registered with `server/src/gameStore/index.js` and added to the existing `coopGameStoreAtomic` allowlist; no JSON or duplicate market database. The single existing `coopAtomicNativeRows.transact` does a synchronous SQLite `BEGIN IMMEDIATE` with durability and native cache/index invalidators.
2. `coopPlayerMarketAtomicSettlement.cjs` implements the first supported player P2P SELL path in one transaction over **characters, items, marketEscrow, identityState, playerMarketFills**: buyer original cash debit; seller original gross credit and market-rules tax debit; original physical stack moves to buyer under the **same itemID**; original escrow deleted; both native wallet journals/market transactions and a durable receipt committed together. A persisted `p2p:<order_id>:<cycle>` receipt makes repeats read-only or fail closed. There is no independent item allocator, no shadow balances, and no synthetic mint.
3. The first atomic path explicitly requires **one entire SELL order represented by exactly one full inventory stack** and independently verified native order/escrow/custody proof. Reject partial fills, split stacks, SELL-order-to-BUY-order crossings and prepaid player BUY orders. The prior native market path remains unchanged with atomic flag OFF.
4. `coopPlayerMarketAtomicRuntime.cjs` coordinates *durable native journal PREPARED → verified Rust claim → GameStore atomic COMMIT → Rust finalize (still locked) → native journal RUST_ACK/SETTLED → reread actual GameStore receipt → Rust release*. No automatic replay on ambiguous crash outcomes.
5. Rust `coop_p2p_market_claim.rs`: `FinalizePlayerFill` retains `market_orders.state='settling'` while decrementing remaining volume and persisting its exact ACK. New idempotent `ReleasePlayerFill` performs the final `settling → open|filled` CAS **only after native receipt is presented**; repeat release checks the saved receipt key and returns the exact stored claim ACK. `GetPlayerFillClaim` exposes the released receipt key for controlled reconciliation.
6. Central reversible installer composes the native SELL atomic hook and table registry after the existing P2P market source patches; Rust RPC is updated by the separate pinned Rust source overlay, not the JS installer. After successful post-release settlement, the native path sends buyer item, wallet and order notifications. No notifications or credits are issued before durable commit/release.

## Flags, disabled by default

All five MUST be `1` before matching any player order:
- `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`
- `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`
- `EVEJS_COOP_RUST_P2P_CLAIM`
- `EVEJS_COOP_NATIVE_ATOMIC_ROWS`
- `EVEJS_COOP_PLAYER_MARKET_ATOMIC`

Also requires a persistent absolute `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_JOURNAL_FILE` (on Windows, precreated). Incomplete flag combinations fail closed before order matching. No Docker or world configuration modified.

## Important limitations / non-claims

- **Not distributed ACID:** Rust SQLite and GameStore SQLite still have distinct commits. After GameStore COMMIT but before Rust finalization/release, the order remains locked and the durable GameStore receipt and native journal require verified reconciliation. No silent abort or refund, no automatic second ISK transfer. The Rust RPC release key is checked by the trusted local server; it is **not a cryptographically verified cross-database commit certificate**. Daemon RPC exposure must be access-controlled before any production enablement.
- Full-stack only: multi-stack, partial fills, prepaid BUY orders and linked SELL→BUY orders are deliberately disabled in strict mode until independent reserve proof, partial-stack allocator and paired-Rust-order escrow are atomic.
- Original `RecordTrade` history RPC is not yet idempotently included in the atomic commit; chart/history parity and market notifications require isolated gameplay verification. Client notifications happen after release and cannot establish transaction durability.
- All **source-level** regression tests and pinned JS source transforms are distinct from true Rust compile, SQLite crash-injection and two-client tests. These have **NOT RUN** in this session; do not enable on live `evejs-data`.

Next P0: independently funded BUY escrow receipt; one-commit full/partial stack transfer with native identity allocator; Rust idempotent history event and protected, operator-approved crash recovery across both durable receipt stores. User requested detailed test-agent runbook later.

No live ISK, item, market.sqlite, Docker, `evejs-data`, client binaries, or real-world game sessions have been touched.
