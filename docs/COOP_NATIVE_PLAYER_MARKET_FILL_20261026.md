# Native player-to-player market fill admission (2026-10-26)

**Status: SOURCE_WIRED, DEFAULT_OFF, LIVE_UNVERIFIED.** Original native EveJS: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Boundary

The original `marketProxyService.js` continues to own two player-trade directions:

- `matchSellOrdersForBuyer`: buyer buys seller's existing SELL order.
- `matchBuyOrdersForSeller`: seller supplies an existing player BUY order, directly from native hangar or a prior SELL order's physical escrow.

The single central installer now deploys `coopPlayerMarketFill.cjs` into the existing native `space/` directory and composes four exact source hooks. `EVEJS_COOP_PLAYER_MARKET_FILL_GUARD=1` activates the guards, default OFF. Seeded/NPC flow remains separately owned.

Pre-side-effect checks require an independently fetched native Rust owner-order response agreeing with the visible book row and exact remaining volume, direction, owner, station, type, cent-valid price and counterparty. SELL matching requires original item IDs and physical native seller escrow; BUY matching requires exact native buyer order escrow and seller's physical station stock or original SELL-order escrow. Self-trading, a changed Rust order, unsupported order kind, unsafe i64 escrow mapping and unfunded/short store evidence fail closed.

After the original Rust `FillOrder`, **before seller credit**, the guard verifies original order ID, owner, station/type, bid/ask side, price, exact `filled_quantity`, resulting `vol_remaining`, state and `invalidated=true`.

The original buyer path had a catch block that unconditionally refunded ISK after a P2P item had already been moved and ownership updated. The protected path marks its first attempted physical move irreversible and **does not blindly refund** on a subsequent error. Unknown operations require reconciliation instead of free items. Before any physical P2P move, stock refund behavior remains unchanged.

The central installer also contains a source-level idempotence fix: reapplying `coop-npc-market-buy-safety-patch` after COOP-035 corporate branch no longer inserts an unconditional COOP-034 skip after that branch. A corrupt mixed pair of guards now fails closed.

## Non-goals / remaining critical risk

This is a genuine native-admission/ACK/custody improvement, **NOT a cross-database atomic settlement**. Original native itemStore, wallet, marketEscrow/GameStore and the external Rust SQLite order book are still separately committed. Unknown states are conservatively stopped, not automatically compensated; this branch does not yet install a shared durable fill ID, Rust prepare/commit transaction, or native GameStore atomic buyer/seller/item/escrow transaction. Native buy escrow might still be reconstructed from an unfunded Rust order on pre-existing code paths; escrow consistency alone is not independent debit proof. Do **not** enable the flag or claim end-to-end P2P market financial correctness without addressing these risks.

No changes to live server, Docker/Compose, player inventories, wallets, Rust daemon/database, `evejs-data`, client or external dependencies. Detailed agent gameplay acceptance scenarios deliberately deferred.
