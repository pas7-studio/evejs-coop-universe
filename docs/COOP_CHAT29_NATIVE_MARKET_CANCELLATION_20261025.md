# Chat 29 — native market cancellation custody guard

Date: 25 October 2026. **Status: PATCH_READY, LIVE_UNVERIFIED.** Pinned native code `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, current co-op main inspected. **No live market.sqlite, GameStore or world was opened, rebuilt, seeded, migrated or changed.** No external client, native Rust daemon or on-host database available to this agent.

## Findings and boundaries

Native market functionality already exists: MarketGroups via `coopMarketCatalog`, real itemTypes and SDE group IDs, opted-in seeded stock, Rust order book and matching, stock player buy/sell RPCs, broker fees and sales tax, wallet and native item storage, stock native market escrow, NPC corporate buy/partial contracts, history, notification and salvage market PRs. Reuse these; do not introduce a parallel order book or synthetic wallet.

Pinned `Code/server/src/services/market/marketProxyService.js`:
- `Handle_CancelCharOrder` can return `computeOrderValue(price, vol_remaining)` when a buy order has no local buy escrow. That value alone is **not** backed ISK and can turn an inconsistent order into free wallet credit.
- `applyCancelledStructureMarketOrder` has the same fallback. Stock `syncOpenBuyEscrowRecords` may create a new escrow row by merely reading an open Rust order, with no independent proof of the original wallet debit.
- `applyExpiredOrderEvent` can credit an escrow whose owner, station or item no longer agree with the immutable Rust order.
- Standard player matching is non-atomic: separate `debitCharacterWallet`, `moveItemToLocation` / `updateMovedItemsOwner`, Rust `FillOrder`, seller credit and tax, with compensating refund only for one buyer-wallet path. Native `marketEscrow` is not a coordinated two-DB transaction. This guard **does not solve** that gap.
- Stock sell cancellation and expiration may remove escrow even if a prior item return failed; this is **not addressed** by the buy-side guard.
- NPC whole-stack settlement and split partial fills are distinct opt-in mechanisms with Rust+GameStore receipts and independently required live/cross-crash validation; preserve their existing owner modules. Draft Stage J salvage PR #155 must be reconciled by its owner rather than reimplemented.

## Minimal, reversible code

- `integration/coopMarketCancelCustody.cjs`: synchronous read-only `assertMatchingBuyEscrow({order,escrow})` requires exact native `OwnerOrderRow` ID (supports string i64), player owner, station, type, bid side, remaining quantity, price to cent, and a matching persisted `marketEscrow` record and amount. `assertCancelledAck` requires native Rust `order_id`, `state=cancelled`, `invalidated=true` before any stock item return or wallet refund. **Escrow consistency is NOT independent evidence that the original debit occurred**, since pre-existing upstream may have created that row from order book state.
- `scripts/coop-market-cancel-custody-patch.cjs`: six tiny OFF-by-default, unique-anchored native guards, affecting existing `syncOpenBuyEscrowRecords`, `applyExpiredOrderEvent`, `applyCancelledStructureMarketOrder`, and `Handle_CancelCharOrder`. Prior to player `CancelOrder` it checks the same stored native escrow; it rechecks after Rust ACK. The source transformation can apply/revert idempotently, including CRLF. Source hook uses **one guarded expression** per inserted line; no direct upstream edit.
- `scripts/patch-evejs-coop.cjs`: one extra module registered in its existing copy manifest, one call to the existing market source transformation, without a new installer or scheduler. No flag is enabled automatically.
- `tests/coop-market-cancel-custody.test.mjs`: 10 executed test cases (valid row; missing/wrong-owner/wrong-quantity escrow; partial fill; invalid price; i64 precision; mismatched Rust ACK; LF/CRLF/reapply/rollback/syntax). 1 additional full pinned-source composition test **SKIPPED**, requiring `EVEJS_COOP_CODE_PATH` on an actual pinned source checkout.

New opt-in flag: `EVEJS_COOP_MARKET_CANCEL_CUSTODY=1`. Default OFF. When enabled, an incomplete/inconsistent escrow blocks a buy cancellation before native Rust change, or blocks applying refunds to already expired/structure-cancelled orders. Failed orders require durable manual reconciliation; never regenerate escrow or retry unknown wallet/Rust effects blindly. No source writes occur while flag is off beyond installing the reversible source hook.

## Test evidence

Node.js v22.16.0, isolated local folder: `node --test tests/coop-market-cancel-custody.test.mjs`: **10 PASS, 0 FAIL, 1 SKIP**. The local fixture is deliberately synthetic. Exact six pinned-source anchor locations independently checked against upstream at the above SHA (each occurs exactly once in its corresponding method); the full pinned installer composition roundtrip requires the on-host source tree and was **NOT_RUN**. Rust compilation, live SQLite transactions, two authenticated real EVE clients, actual market orders and restart/cancel crash simulation are **NOT_RUN**, not PASS. Do not claim native market financial atomicity or in-client success based on this module.

## Operator acceptance and safe next work

1. Preserve original `market.sqlite`, GameStore and volumes. Record full running project SHA, upstream SHA, deployed flags and original DB fingerprints; no seed rebuild or reset.
2. On a disposable cloned pinned checkout run `node --test tests/coop-market-cancel-custody.test.mjs` with `EVEJS_COOP_CODE_PATH` pointing at verified `Code/`, then existing reversible installer `--dry-run` and `--check`. Do not activate on the protected market until tests and rollback are approved.
3. On isolated copies of **both** GameStore and Rust SQLite, test genuine funded buy order -> partial fill -> remaining buy cancellation; verify exact escrow, buyer wallet ISK, seller tax/fees and order state. Check missing-escrow rejection, Rust lost ACK, crash between ACK and wallet credit, crash between credit and escrow removal, and repeated request after reconnect. A passing consistency guard does not give exactly-once payment for those mid-commit crashes.
4. Test two real players A/B selling and buying the **same physical item stack**, one and several partial fills, cancellation, no double delivery, and independent client reconnect. Verify distinct actual native itemIDs, balance and market receipts before/after each step and after server restart.
5. Separately prove seeded-market buy/sell and supported NPC corporate buyer/seller paths with Rust durable claims; do not conflate NPC `coop-pilot` planning ledger with player wallet.
6. Before gameplay PASS, implement/verify a durable payment receipt and original Rust order claim for **ordinary player-to-player** fills and cancellation, reconcilable after crash, with one GameStore atomic wallet+item+escrow transaction. This guard intentionally fails closed without that subsystem. Also fix sell-side return/error cleanup before enabling cancellation guard as a complete market safety feature.

Rollback: disable flag; existing native behavior resumes, or revert this commit via existing transactional overlay on a disposable verified checkout. Rollback does not repair already-paid or stranded orders; reconcile before replay. No GitHub Actions, no market seeding, no direct DB writes.
