import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Owner rule (2026-11-05): "with 50-200 billion, buy everything - even what nobody buys - at 70-90 %
// of the market, and try to resell at 105-140 %." This module is that rule as pure policy: which
// asks are bargains, which dead types deserve a bid, and what we ask for our own stock. It never
// places an order and never touches a wallet.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const bands = require(path.join(forkRoot, "Code/server/src/space/coopNpcMarketMakerBands.js"));

const ask = (typeID, remainingQuantity, unitPriceCents, extra = {}) => ({
  typeID, orderID: 9000 + typeID, remainingQuantity, unitPriceCents,
  sellerOwnerID: 140000005, stationID: 60003760, verifiedNative: true, state: "open", ...extra,
});

test("the bands are the owner's numbers: buy <= 90 %, bid 70 %, sell 105-140 %", () => {
  assert.equal(bands.BUY_MAX_PCT, 0.9);
  assert.equal(bands.BID_PCT, 0.7);
  assert.equal(bands.SELL_MIN_PCT, 1.05);
  assert.equal(bands.SELL_MAX_PCT, 1.4);
});

test("only asks at or below 90 % of the reference are bought", () => {
  const plan = bands.planBargainBuys({
    cashCents: 10_000_000_000_000, minReserveCents: 1_000_000_000,
    referencePriceCents: 10_000,
    asks: [ask(34, 40, 9_000), ask(35, 40, 9_000), ask(36, 40, 9_500), ask(37, 40, 12_000)],
  });
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.buyCeilingCents, 9_000, "90 % of 10 000 is the ceiling");
  assert.deepEqual(plan.lots.map((lot) => lot.typeID), [34, 35],
    "the 95 % ask and the 120 % ask are not bargains");
  assert.equal(plan.sellFloorCents, 10_500, "and we never plan to sell under 105 %");
});

test("a bargain is only taken when the spread pays for itself", () => {
  // 90 % buy and 105 % sell is a 16.6 % gross gap: fine. Force a thin sell band and it is not.
  const thin = bands.planBargainBuys({
    cashCents: 10_000_000_000_000, minReserveCents: 0, referencePriceCents: 10_000,
    asks: [ask(34, 10, 9_000)], minProfitBps: 2_000,
  });
  assert.equal(thin.status, "NO_PROFITABLE_LOT",
    "a 16.7 % best-case spread is below a 20 % demanded floor, so the lot is refused");
  const fine = bands.planBargainBuys({
    cashCents: 10_000_000_000_000, minReserveCents: 0, referencePriceCents: 10_000,
    asks: [ask(34, 10, 9_000)], sellPct: 1.05, minProfitBps: 800,
  });
  assert.equal(fine.lots[0].grossProfitBps, 1667, "105 % against 9 000 is 16.7 % gross");
});

test("the cash reserve is held and the per-tick budget is respected", () => {
  const broke = bands.planBargainBuys({ cashCents: 1_000_000_000, minReserveCents: 1_000_000_000,
    referencePriceCents: 10_000, asks: [ask(34, 10, 9_000)] });
  assert.equal(broke.status, "NO_SPENDABLE_ISK");
  const capped = bands.planBargainBuys({ cashCents: 10_000_000_000_000, minReserveCents: 0,
    maxSpendCents: 400_000, referencePriceCents: 10_000,
    asks: [ask(34, 50, 9_000), ask(35, 50, 8_000)] });
  assert.ok(capped.spentCents <= 400_000, "never more than the tick appetite");
  assert.equal(capped.lots.length, 1, "only what fits");
  assert.equal(capped.lots[0].typeID, 35, "cheapest first");
});

test("a lot never eats a whole stack and one type is bought once per tick", () => {
  const plan = bands.planBargainBuys({ cashCents: 10_000_000_000_000, minReserveCents: 0,
    referencePriceCents: 10_000, maxLotUnits: 50,
    asks: [ask(34, 5000, 9_000), ask(34, 500, 8_500), ask(35, 30, 9_000)], openTypeIDs: [35] });
  assert.equal(plan.lots.length, 1);
  assert.equal(plan.lots[0].typeID, 34);
  assert.equal(plan.lots[0].quantity, 50, "capped in units");
  assert.equal(plan.lots[0].offerQuantity, 5000, "the rest of the stack stays on the book");
});

test("only attested, open, player-sold offers are ever lifted", () => {
  const plan = bands.planBargainBuys({ cashCents: 10_000_000_000_000, minReserveCents: 0,
    referencePriceCents: 10_000,
    asks: [ask(34, 10, 9_000, { verifiedNative: false }), ask(35, 10, 9_000, { state: "closed" }),
      ask(36, 10, 0), ask(37, 0, 9_000)] });
  assert.equal(plan.status, "NO_BARGAIN_ON_BOOK");
});

test("dead types get a 70 % bid, deadest first, and it is priced off the reference", () => {
  const plan = bands.planLiquidityBids({
    cashCents: 10_000_000_000_000, minReserveCents: 0, maxBidUnits: 50,
    types: [
      { typeID: 34, referencePriceCents: 10_000, stationID: 60003760, asksOnBook: 4 },
      { typeID: 55555, referencePriceCents: 20_000, stationID: 60003760, asksOnBook: 0, ownedStock: 0 },
      { typeID: 66666, referencePriceCents: 8_000, stationID: 60003760, asksOnBook: 0, ownedStock: 10 },
    ],
  });
  assert.equal(plan.status, "PLANNED");
  assert.deepEqual(plan.bids.map((bid) => bid.typeID), [55555, 66666, 34],
    "an item nobody sells is priced first, then the one we own some of, then the live one");
  assert.equal(plan.bids[0].bidUnitPriceCents, 14_000, "70 % of 20 000");
  assert.equal(plan.bids[0].reason, "LIQUIDITY_BID_NO_ASKS");
  assert.equal(plan.bids[2].reason, "LIQUIDITY_BID_DEAD_BOOK");
});

test("the bid band never exceeds the buy ceiling and never undercuts the sell floor", () => {
  const bid = bands.planLiquidityBids({ cashCents: 10_000_000_000_000, minReserveCents: 0,
    types: [{ typeID: 34, referencePriceCents: 10_000, stationID: 1, asksOnBook: 0 }] });
  const row = bid.bids[0];
  assert.ok(row.bidUnitPriceCents <= Math.round(10_000 * bands.BUY_MAX_PCT),
    "70 % is comfortably inside the 90 % ceiling");
  assert.ok(row.sellFloorUnitPriceCents >= Math.round(10_000 * bands.SELL_MIN_PCT),
    "and we still expect at least 105 % back");
});

test("resale asks sit between 105 % and 140 %, and stock already listed is not listed twice", () => {
  const plan = bands.planResaleAsks({
    referencePriceCents: 10_000,
    stock: [{ typeID: 34, quantity: 50, stationID: 60003760 },
      { typeID: 35, quantity: 10, stationID: 60003760 },
      { typeID: 36, quantity: 0, stationID: 60003760 }],
    existingOwnAskTypeIDs: [35],
  });
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.asks.length, 1, "type 35 is already on the book, type 36 has no stock");
  assert.equal(plan.asks[0].typeID, 34);
  assert.equal(plan.asks[0].unitPriceCents, 14_000, "140 % of the reference");
  assert.equal(plan.asks[0].floorCents, 10_500, "105 % is the floor it may never cross");
});

test("bad money or a bad reference refuses instead of guessing", () => {
  assert.equal(bands.planBargainBuys({ cashCents: -1, referencePriceCents: 10_000,
    asks: [ask(34, 1, 1)] }).status, "INVALID_MARKET_MAKER_LEDGER");
  assert.equal(bands.planBargainBuys({ cashCents: 1000, referencePriceCents: 0,
    asks: [ask(34, 1, 1)] }).status, "INVALID_MARKET_MAKER_LEDGER");
  assert.equal(bands.planResaleAsks({ referencePriceCents: 0, stock: [] }).status,
    "INVALID_MARKET_MAKER_LEDGER");
  assert.equal(bands.planLiquidityBids({ cashCents: 1_000_000_000, minReserveCents: 1_000_000_000,
    types: [{ typeID: 34, referencePriceCents: 10_000, stationID: 1 }] }).status,
    "NO_SPENDABLE_ISK");
});
