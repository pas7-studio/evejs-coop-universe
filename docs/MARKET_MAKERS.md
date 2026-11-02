# Market makers: NPC traders that actually buy and sell (design)

Owner request 2026-11-03: the order book has asks but almost no bids, so prices look "holey" and the
economy does not move. Proposal: a set of trader bots with (near) unlimited balances that buy
everything at −30 %…+30 % and resell at +5 %…+40 % of what they paid, adjusting to demand.

This document is the plan and the invariants. Nothing here is implemented yet.

## What exists today

- The Rust market (`externalservices/market-server`) already speaks the whole order book:
  `PlaceOrder` / `PlaceBuyOrder` / `PlaceSellOrder`, `ModifyOrder`, `CancelOrder`, `FillOrder`,
  `GetOrders`, `GetOwnerOrders`, `GetStationAsks`, `GetRegionBest`.
- The Node side deliberately **never** calls stock `PlaceOrder` for an NPC
  (`coopNpcPendingMarketEscrow`, `coopNpcIndustryOriginalRustSell`, `coopSalvageNpcPendingMarket` and
  five more say so in their headers): an order whose ISK or items are not escrowed is a fake order.
- Players already have a safe buy path: `coopPlayerMarketBuyReserveRuntime` reserves ISK first, then
  calls `PlaceOrder` once, and never repeats an uncertain call.
- NPCs already own a durable earned-ISK ledger (`coop-economy.json`, per-pilot credits).

So the machinery for a *real* order exists; what is missing is a buy-side escrow path for NPCs and a
trader phase that uses it.

## Two decisions that must be made before code

1. **"Near infinite" cannot mean infinite.** Every ISK a bot spends must come from a balance that is
   booked, or the economy silently prints money and every price it sets is meaningless. Proposal: each
   trader starts with a large, *accounted* bankroll (for example 5–50 billion ISK per trader, recorded
   in the same ledger as everything else) and a hard daily spend cap. That gives the same effect as
   "infinite" for a small world without breaking conservation.
2. **Who owns the order.** The Rust book keys orders by owner ID. Traders must use their own stable
   owner ID, so `GetOwnerOrders` shows exactly their orders and `CancelOrder` cleans them up.

## Rules the traders follow (owner's numbers)

- Reference price per type: median ask in the hub region; when there are no asks, the SDE/seed price.
- **Buy**: place a bid at reference × (0.70 … 1.30), uniform, never above the best ask (a bid above the
  ask would just fill instantly and defeat the point).
- **Sell**: list bought stock at purchase × (1.05 … 1.40), never below the best bid.
- **Demand adjustment**: if an order fills within a short window, the next price moves up by a small
  step (e.g. +2 %); if it sits unfilled for its whole TTL, the next price moves down by the same step.
  Bounded to the ranges above.
- **Rotation**: each trader works one hub at a time and rotates stations/categories on a timer, so the
  book does not become a wall of one bot.
- **Caps**: N orders per type per station, M types per trader, TTL per order (1–6 h), and a global cap
  on ISK committed at any moment.

## Phases

1. **Audit (read-only).** What `PlaceBuyOrder` really does with an order that has no escrow, what
   `FillOrder` requires, and whether the Node side can reserve NPC ISK the way the player path does.
2. **Buy-side escrow for NPCs.** `coopNpcMarketBuyEscrow`: reserve from the trader's ledger balance,
   place once, treat an unknown RPC outcome as "do not repeat" (the same rule the player path uses).
3. **Trader phase.** `space/coopMarketMaker.js` — pure decision function (reference, spread, TTL,
   rotation, caps) with unit tests, then the runtime phase that places and cancels orders.
4. **Demand feedback.** Track fills per type per trader and move prices within the allowed band.
5. **Observability.** One `coop-events.jsonl` line per order placed/cancelled/filled, with the numbers
   used, so the effect on the book is measurable instead of felt.

## What this will NOT do

- It will not invent ISK, items or orders: every order is backed by a booked balance and real stock.
- It will not touch the play stack until it is proven on `evejs-agents`.
- It will not silently "fix" prices: the ranges above are the owner's, and every step is logged.
