# Native P2P SELL — multi-stack atomic custody

Status: **SOURCE_WIRED / DEFAULT_OFF / LIVE_UNVERIFIED**.

Follows merged PR #224 (atomic GameStore/Rust release) and #227 (one-stack partial fills). This extension **reuses** the original Rust player order book, native SELL escrow proof and the existing `coopAtomicNativeRows.transact` bridge; it creates neither a second market nor a parallel inventory.

## Deterministic physical settlement

For one original native SELL market order:

- The original Rust order and native escrow must represent the **same exact** `volumeBefore` and the original owner, item type, station, price and custody location. Existing `assertSellEscrow` independently verifies every original physical stack.
- The protected market source allows up to 10,000 real escrow stacks with positive original stack quantities and exact sum matching the Rust order. Unverified source sets are refused **before the durable journal and Rust claim**.
- The native atomic settlement re-reads all physical rows **inside the existing GameStore transaction**, validates the same exact set of distinct `itemID` values, and sums all stack quantities before charging anyone.
- Original physical stacks are consumed deterministically in ascending numeric `itemID` order. A fully consumed stack is transferred directly to the buyer, **retaining the original itemID**. One partially consumed source stack retains its original ID and unsold quantity in escrow, while a new buyer-owned stack is created by **`identityState.nextItemID` in that same transaction**. No cloned ID, detached item or phantom quantity.
- The same SQLite COMMIT updates the buyer wallet debit, seller wallet credit/tax, wallet and trade journals, original item rows, native escrow remaining quantity, any allocated item ID, and exactly one `playerMarketFills` receipt.
- Escrow is removed if `volumeAfter=0`, otherwise remains at the exact new volume. Rust `FinalizePlayerFill` stays in `settling` until the durable native journal is `SETTLED` and the actual GameStore receipt is reread, after which `ReleasePlayerFill` is called.
- Receipt keys stay `p2p:<order_id>:<cycle>`; the receipt stores the complete canonical source itemID list and one delivery record per consumed stack, including `sourceItemID`, `itemID`, `quantity`, `sourceBefore`, `sourceAfter`. Replayed calls do not move ISK or items, even if the buyer subsequently moves or sells their delivered property. Changed source sets / quantities / price / tax or recipient are denied.
- Native buyer notifications now enumerate **all** delivered stacks after successful settlement/release. Order remaining volume and seller notifications remain grounded in the original Rust proof.

Example: an escrow with stacks of 3, 4 and 5 units sells 8 units: the 3 and 4 stacks move to the buyer under their original IDs; 1 unit from the 5 stack is delivered under a new native ID and the original 5 stack becomes 4 in escrow. Selling the last 4 in the next Rust claim cycle closes the original escrow. Total physical quantity always remains 12, with no duplicate ISK debit.

## Intentionally unavailable

- **Prepaid player BUY orders / dual-Rust-order matching** still lack an independent authoritative original wallet-reserve receipt. Strict atomic mode blocks these.
- This does not certify cross-database distributed ACID or automatic crash compensation. A Rust ACK or GameStore COMMIT of unknown outcome stays locked for operator-audited recovery; existing durable journal remains authoritative.
- The original market history `RecordTrade` exactly-once record and real-world tax/payout parity need a separate follow-up.
- Multi-stack source uses original stackable (`singleton=0`) physical items. Singleton and malformed stacks fail closed; no generic bundling/stack merge mechanic is introduced.
- All existing financial flags remain **OFF** by default: `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`, `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`, `EVEJS_COOP_RUST_P2P_CLAIM`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS`, `EVEJS_COOP_PLAYER_MARKET_ATOMIC`.

## Verification boundary

Source-executed JS test callbacks: 13/13 atomic settlement, 11/11 original native patch and coordinator. Full pinned `marketProxyService.js` with existing NPC, market-catalog, buy/sell escrow, P2P Rust and settlement overlays: V8 syntax, repeated apply and byte-exact rollback **PASS** for LF and CRLF.

**NOT RUN:** full Node test runner, real native GameStore SQLite, Rust cargo compilation, two game clients, crash-injection and real persisted marketplace. None of the live `evejs-data`, wallets, items, Rust market.sqlite, Docker or game processes have been modified. Do not enable without separate isolated end-to-end verification. Full agent-testing runbook intentionally deferred by user request.
