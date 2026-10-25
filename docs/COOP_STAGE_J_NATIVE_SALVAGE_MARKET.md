# Stage J — Native NPC Salvage Warehouse → Rust Pending Sell Order (P0 source slice)

**Status:** manual opt-in source adapter, not automatically scheduled/deployed. Source-level V8 checks only; real Node, SQLite, patched Rust daemon, wallet settlement and two-client EVE gameplay **NOT_RUN**. Never enable in populated `evejs-data`.

## The actual integration boundary

Existing `coopNpcPendingMarketEscrow` supports **NPC manufacturing output only**, with original `coop-industry:v1` native item markers and the pinned Rust RPC trio `ReserveNpcSellOrder / ActivateNpcSellOrder / GetNpcSellOrder`. Reusing its item predicate for wreck salvage would incorrectly reject real salvage or encourage forged industry receipts. Existing NPC `coopNativeNpcMarket` trades seed orders using an NPC-only side ledger, **not a native corporation warehouse market sale**. Neither path proves a native corporate wallet sale of NPC salvage.

This Stage J adapter `integration/coopSalvageNpcPendingMarket.cjs` uses the **existing** pending Rust protocol with a **new original-wreck source guard**; it does not use stock `PlaceOrder` and cannot mint ISK.

## Exact native custody / one-shot listing

1. `inspect(wreckItemID)` is a read-only candidate. It requires a durable `coopSalvageRivalMoves` receipt in `NPC_STOCK_DELIVERED`, original fsynced manifest witness for that wreckItemID, and a *single* original corporation-owned station item with original `coop-salvage-rival:v1:WRECK_ITEM:SOURCE_CARGO` marker, type, quantity, singleton and warehouse flag.
2. `listOnce(wreckItemID)` is gated by three flags, all default OFF: `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`, `EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=1`, `EVEJS_COOP_SALVAGE_NATIVE_MARKET=1`. It additionally requires the real native `SERVER_INTERNAL_FLAGGED` writer, healthy GameStore and authorized native NPC corporation/station/price source.
3. Inside a GameStore transaction over `items`, `marketEscrow`, `corporationRuntime`, `npcCargo`: validate actual stock, exact source identity, unique marker, no conflicting prior market escrow and no original cargo still aboard an NPC. Write durable one-shot `coopSalvageMarketOps` `PREPARED` **before external RPC**. Operation ID is a stable hash of original native identities.
4. Reserve a genuinely pending Rust sell order with the original source item ID, NPC corp owner, station, type, quantity, bounded native-evidence price and division 1000. Validate all returned Rust identities and pending state.
5. In **one** second native GameStore transaction, validate the original receipt and unchanged stock **again**, move that exact `items` row to Rust escrow location and create one matching `marketEscrow` row (`coopSource=NATIVE_SALVAGE`) plus `ESCROWED` journal. Verify item and escrow readback.
6. Only after verified escrow, ask Rust to activate. Re-read native Rust order with `GetNpcSellOrder`, require open and identical terms, and seal `LISTED` in GameStore. This means **offered for sale, NOT SOLD**. Never credit any ISK in the JS adapter.
7. Any unknown Rust response, lost ACK, changed source, transaction failure or incomplete readback yields `SALVAGE_MARKET_RECONCILIATION_REQUIRED` (or a blocked original source). A repeated `listOnce` sees the saved operation or absent original warehouse stock and **never** blindly issues another `ReserveNpcSellOrder`. Manual outcome reconciliation must compare Rust order and native escrow before moving a state forward.

Existing downstream native market matching and **verified corporate wallet sale/settlement** have not been wired into a fully automatic salvage economic loop yet. Do **not** translate an order into earned ISK or a delivered player reward without original native sale/wallet receipt.

## Source and local checks

- `tests/coop-salvage-npc-native-pending-market.test.mjs`: 12 scenarios including first listing, duplicate, missing witness, wrong owner, forged duplicate item, duplicate original NPC cargo, source mutation after Rust reserve, lost reserve ACK, bad pending quote, lost activation ACK, preexisting market escrow and default-OFF.
- `tests/coop-stage-j-salvage-native-market-registry.test.mjs`: overlay deployment manifest includes pre-existing rival station module, original pending-market dependency and Stage J seller; guards unique copy registration.
- 12/12 **source-executed** tests PASS with V8 simulated transaction; real Node 22 and true pinned SQLite/Rust integration are **NOT_RUN**.
- For local checkout: `node --test tests/coop-salvage-npc-native-pending-market.test.mjs tests/coop-stage-j-salvage-native-market-registry.test.mjs`; run established `node scripts/coop-test-baseline.cjs`; verify pinned reversible overlay via `node scripts/patch-evejs-coop.cjs --code-path <PINNED_CODE> --dry-run` and `--check`. No GitHub Actions.
- Disposable native GameStore + Rust manual scenarios are defined in `tests/scenarios/coop-stage-j-native-salvage-market.json`. This source-only PR intentionally does **not** enable automatic A-Life listing. Sale/ISK wallet evidence and restarts remain GO gates.

## Next work

Finish native Rust sell-order + corporate wallet fill evidence, fee/payment conservation and read-only reconciliation API on crash/ACK loss. Only then bind eligible NPC warehouses to an existing A-Life tick (without adding another timer), with caps and real price authority. Never substitute virtual income or the NPC seed-market side ledger.

## Rollback

No schema migration, source tree only, default OFF. Reverting the PR leaves existing native stock and wallets unchanged. Never reset `evejs-data`.
