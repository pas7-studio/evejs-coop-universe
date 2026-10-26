# P0 — Native funded P2P BUY seller payout (original Rust/GameStore)

**Source-integrated, default OFF. No live marketplace execution or full SQLite/Rust tests.** Pinned upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## What this closes

PR #238 introduced an atomic native GameStore BUY reserve and durable `P2P_BUY_RESERVE` proof. This extends the **original matchBuyOrdersForSeller path** to actually pay a seller from that previously committed reserve, without charging the buyer again or minting free ISK/items.

One BUY order may be filled in multiple original Rust claim cycles. Each fill currently consumes **one complete physical seller hangar stack** (its item quantity must exactly equal `fillableQuantity`). Original SELL-order crossing, seller source splitting, singleton handling and multi-stack delivery remain blocked in this opt-in strict slice.

### Native custody/finance (one SQLite commit)

`integration/coopPlayerMarketBuySettlement.cjs` requires the original `coopAtomicNativeRows.transact` tables `characters`, `items`, `marketEscrow`, `identityState`, `playerMarketFills`.

Pre-claim checks re-read the exact physical seller hangar item and the native escrow tied to the `BOUND` receipt of the buyer's **real original wallet debit**; strict order identity/owner/station/type/price/volume and cents arithmetic are checked against the original Rust BUY order.

Within **one native GameStore SQLite COMMIT**:
- Transfer the original full seller itemID to the buyer's hangar; no item mint or ID allocator is needed.
- Credit seller gross proceeds and debit original sales tax, with native wallet journal entries (2/54) and unique native transaction IDs.
- **Do not touch the buyer's cash balance:** their full price was deducted once when `P2P_BUY_RESERVE` was committed.
- Update native BUY escrow `remainingQuantity` and `escrowAmount`, or delete terminal escrow. Decrement the `BOUND` reserve's `remainingReserveCents` by exactly the sale gross and increment durable `spentCents`/`filledQuantity`. Mark the reserve `SPENT` on terminal fill.
- Store a unique `p2p:<order_id>:<cycle>` paid custody receipt, with original order/buyer/seller, physical source item, before/after native reserve, quantity, integer cents, tax, seller wallet before/after and **unchanged** buyer wallet before/after.

The same paid receipt cannot transfer an item or pay ISK twice. A changed source item, price, volume, tax, seller/buyer or cycle fails closed.

### Rust/journal release authority

Existing original `ClaimPlayerFill` reserves the actual Rust BUY order before the irreversible native GameStore COMMIT. The original Rust `FinalizePlayerFill` decreases volume but leaves the order `settling` until the native journal records `RUST_ACK → SETTLED`, `requireReceipt` rereads the durable paid GameStore row, and `ReleasePlayerFill` reopens the original residual order (or marks it filled). No duplicate stock `FillOrder`, no shadow order book.

Original native seller/goods and wallet notifications occur **after** successful release. Native source hooks are reversible and default OFF.

## Explicit limits

- Original market `RecordTrade` exactly-once history is still not integrated; charts/history need a later durable event.
- Price-improvement refunds, buyer cancel/expiry settlement and broker owner credit are **not** implemented in this transaction. Previous strict BUY mode continues blocking unsafe automatic refund/modify paths; no refund should be claimed.
- Unknown outcomes after GameStore COMMIT, Rust finalize or release require operator-reviewed reconciliation. There is no distributed ACID guarantee, no blind retry, and no automatic compensation.
- This first native BUY payout is for **whole direct seller hangar stacks only**. Linked seller escrow order crossings, item splitting and full EVE-style multi-stack offers need separate proof paths.
- Flags still all OFF by default: `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD`, `EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE`, `EVEJS_COOP_RUST_P2P_CLAIM`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS`, `EVEJS_COOP_PLAYER_MARKET_ATOMIC`, `EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE`.

## Source-level checks, not live claims

- 9/9 original native GameStore BUY-funded seller settlement tests: full stack; two paid original Rust fill cycles (7 = 3+4); no second buyer wallet debit; no over-spend of original reserve; rollback on malformed escrow/reserve/item; replay, strict flags; keyed-only original GameStore wallet identity and explicit forged embedded-ID rejection (compatible with merged PR #240).
- 5/5 Rust/GameStore/journal payout runtime checks: verified claim, atomic commit, finalize locked, durable receipt, journal and release in order; unknown-commit and replay refusal.
- 4/4 source hook reversibility tests, **7/7 previous SELL runtime tests** unchanged.
- Full pinned `marketProxyService.js` with existing NPC/catalog/Sell escrow/player Rust, BUY reserve and new BUY payout: V8 parse, repeated application and byte-exact reversal for LF and CRLF **PASS**.

**NOT RUN:** full Node runner, real `node:sqlite` wallet/custody migration, Rust `cargo test`, native market daemon, local Docker `evejs-data` persistence, two-client local gameplay, crash-injection between the two SQLite databases. No live player ISK/items/orders/market.sqlite were changed. Do not enable until those pass. Detailed QA-agent runbook deferred as requested.
