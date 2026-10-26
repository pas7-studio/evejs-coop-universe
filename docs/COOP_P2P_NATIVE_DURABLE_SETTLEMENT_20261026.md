# P0 native P2P market — durable settlement fence

**Status:** Source-wired, feature flags default OFF, real-gameplay / SQLite+Rust crash tests not executed. Pinned native EveJS: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Original authority

The original EveJS marketProxyService remains responsible for native market matching, Rust `FillOrder`, user wallet debits/credits, native item ownership, tax and market escrow. No synthetic wallet or parallel market is introduced.

`integration/coopPlayerMarketSettlementFence.cjs` uses a synchronous, persistent write-ahead file:

`PREPARED → RUST_ACK → SETTLED`

- **PREPARED**, durably appended and fsynced *before* the first wallet or inventory mutation, contains the original native order proof, buyer/seller balances in integer cents and real native item totals. Duplicate/in-flight orders or overlapping actors are denied.
- **RUST_ACK**, appended after the existing exact `assertFillAck` validates the original external Rust order identity, volume, direction and price. It is not treated as proof of wallet settlement.
- **SETTLED** only after the stock native handler has finished seller credit, sales tax, buyer ownership transfer and escrow mutation. A fresh read of the original native GameStore wallet balances, inventory quantities and native market escrow must match exact expected cents, units and remaining order volume.
- An interrupted, corrupt, incomplete or ambiguous journal never automatically replays the operation. Restart preserves the original pending status; market cancel/modify/expiry and structure Market-service cancellation are checked against the same pending journal.

The process-exclusive `.lock` uses exclusive open. Journal entries and parent directory are fsynced on POSIX; on Windows, a previously created persistent journal file is required because portable directory-fsync is unavailable. A stale lock or failed durability claim blocks operation, rather than guessing at a successful transaction.

## Source integration

Native default-off flags:

- `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD=1` (existing exact Rust/physical escrow proof)
- `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE=1` (this stage)
- `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_JOURNAL_FILE` — persistent absolute file path, **not a temporary path**

Both flags must be enabled together. Integration is through the one transactional installer, with reversible hooks in both matching directions and the existing native cancel/modify/expiry paths. Ordinary player trades remain unchanged with these flags off.

The protected stage explicitly **rejects** two still-unsupported paths instead of falsely settling them: matching SELL orders against a pre-funded BUY order with `chargeBuyerWallet=false`, and SELL-order-to-BUY-order crossings requiring two independent Rust order updates. NPC/seed market paths remain under their separately owned mechanisms.

## Not cross-database atomicity

This is a durability and one-at-a-time *witness*, not a distributed transaction: native GameStore, client wallet/itemStore and external Rust SQLite still have distinct commit points. The journal does not give the Rust order book an idempotent fill claim. If the server crashes after a Rust fill and before native settlement, operator-assisted reconciliation of both databases is still required. Never label the market crash-atomic or automatically recover a pending fill based only on this source code.

No live wallet, market.sqlite, `evejs-data`, Docker, Rust daemon, client binary, or GameStore persistence was changed. Detailed QA-agent gameplay instructions are intentionally deferred.
