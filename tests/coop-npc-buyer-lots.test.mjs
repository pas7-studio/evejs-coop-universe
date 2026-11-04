import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Owner rule (2026-11-05): "the allowlist should be really flexible - if someone makes
// something and sells it, buy it in small lots with a reserve, so it does not buy everything
// up, but it still stimulates demand." This module is that rule as a pure decision: no fixed
// type list, a fraction of what is on offer, a cash reserve, and a small premium.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const buyer = require(path.join(forkRoot, "Code/server/src/space/coopNpcBuyerLots.js"));

const ask = (typeID, remainingQuantity, unitPriceCents, extra = {}) => ({
  typeID, orderID: 9000 + typeID, remainingQuantity, unitPriceCents,
  sellerOwnerID: 140000005, stationID: 60003760, verifiedNative: true, state: "open", ...extra});

test("any type a player really sells is eligible - there is no fixed allowlist", () => {
  const plan = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 1_000_000,
    asks: [ask(34, 1000, 100), ask(12345, 20, 5000)]});
  assert.equal(plan.status, "PLANNED");
  assert.deepEqual(plan.lots.map((lot) => lot.typeID).sort((a, b) => a - b), [34, 12345],
    "an ore and a made-up manufactured type are both bought");
});

test("it never takes the whole stack: a fraction, capped in units", () => {
  const plan = buyer.planLotPurchases({cashCents: 100_000_000, minCashReserveCents: 0,
    asks: [ask(34, 1000, 100)], maxLotFraction: 0.25, maxLotUnits: 50});
  const [lot] = plan.lots;
  assert.equal(lot.offerQuantity, 1000);
  assert.equal(lot.quantity, 50, "the unit cap binds first");
  assert.equal(lot.keepsBookShare, 0.95, "95 % of the stack stays on the book");
});

test("the cash reserve is held, so a buyer cannot drain itself", () => {
  const rich = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 9_500_000,
    maxLotUnits: 50, asks: [ask(34, 100, 20_000)]});
  assert.equal(rich.status, "NO_AFFORDABLE_LOT",
    "50 units at 200 ISK each is 1 000 000 cents, more than the spendable 500 000");
  const fine = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 9_500_000,
    maxLotUnits: 50, asks: [ask(34, 100, 1_000)]});
  assert.equal(fine.status, "PLANNED", "50 units at 10 ISK each fits the same appetite");
  assert.ok(fine.spentCents <= 500_000, "and it never touches the reserve");
  const broke = buyer.planLotPurchases({cashCents: 1_000_000, minCashReserveCents: 1_000_000,
    asks: [ask(34, 100, 1000)]});
  assert.equal(broke.status, "NO_SPENDABLE_ISK");
  assert.equal(broke.reason, "CASH_RESERVE_HELD");
});

test("one lot per type per tick, and open types are skipped", () => {
  const plan = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 0,
    asks: [ask(34, 100, 100), ask(34, 500, 90), ask(35, 100, 200)], openTypeIDs: [35]});
  assert.equal(plan.lots.length, 1);
  assert.equal(plan.lots[0].typeID, 34);
});

test("cheapest offers first, and the per-tick budget is respected", () => {
  const plan = buyer.planLotPurchases({cashCents: 100_000, minCashReserveCents: 0,
    maxSpendPerTickCents: 20_000, maxLotUnits: 10, maxLotFraction: 1,
    asks: [ask(40, 10, 1000), ask(41, 10, 500), ask(42, 10, 2000)]});
  assert.equal(plan.status, "PLANNED");
  assert.deepEqual(plan.lots.map((lot) => lot.typeID), [41, 40],
    "the two cheapest fit the 20 000 cents appetite; the dear one does not");
  assert.ok(plan.spentCents <= 20_000);
});

test("demand is stimulated with a small premium, never an open cheque", () => {
  const plan = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 0,
    maxLotFraction: 1, maxLotUnits: 10, maxPremiumBps: 300,
    asks: [ask(34, 10, 1000)]});
  const [lot] = plan.lots;
  assert.equal(lot.askUnitPriceCents, 1000);
  assert.equal(lot.bidUnitPriceCents, 1030, "+3 % keeps a live bid under the goods");
  assert.ok(lot.bidUnitPriceCents <= 1500);
  const capped = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 0,
    maxLotFraction: 1, maxLotUnits: 10, maxPremiumBps: 300, maxUnitPriceCents: 1010,
    asks: [ask(34, 10, 1000)]});
  assert.equal(capped.lots[0].bidUnitPriceCents, 1010, "and never above the unit price cap");
});

test("only attested, open, player-owned offers are ever bought", () => {
  const plan = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 0,
    asks: [
      ask(34, 100, 100, {verifiedNative: false}),
      ask(35, 100, 100, {state: "closed"}),
      ask(36, 100, 100, {unitPriceCents: 0}),
      ask(37, 100, 100, {remainingQuantity: 0}),
    ]});
  assert.equal(plan.status, "NO_ELIGIBLE_OFFERS");
  assert.deepEqual(plan.lots, []);
});

test("bad money or a bad clock refuses instead of guessing", () => {
  assert.equal(buyer.planLotPurchases({cashCents: -1, asks: [ask(34, 1, 1)]}).status,
    "INVALID_BUYER_LEDGER");
  assert.equal(buyer.planLotPurchases({cashCents: 1000, minCashReserveCents: -5,
    asks: [ask(34, 1, 1)]}).status, "INVALID_BUYER_LEDGER");
  assert.equal(buyer.planLotPurchases({cashCents: 1000, now: 0, asks: [ask(34, 1, 1)]}).status,
    "INVALID_BUYER_LEDGER");
});

test("with a whole-stack-only executor, only offers that are already small lots are eligible", () => {
  // space/coopNpcCorporateBuyerAtomic.js claims ONE whole verified player ask - there is no
  // atomic splitter, so a big stack cannot be sliced. The buyer then skips it (never buys it
  // all) and takes the small offers, which is what keeps 95 % of a big stack on the book.
  const plan = buyer.planLotPurchases({cashCents: 10_000_000, minCashReserveCents: 1_000_000,
    maxLotUnits: 50, wholeStackOnly: true,
    asks: [ask(34, 5000, 100), ask(35, 40, 900), ask(36, 20, 1200)]});
  assert.equal(plan.status, "PLANNED");
  assert.deepEqual(plan.lots.map((lot) => lot.typeID).sort((a, b) => a - b), [35, 36],
    "the 5 000-unit stack is left alone; the two small offers are bought whole");
  assert.ok(plan.lots.every((lot) => lot.quantity === lot.offerQuantity),
    "a whole-stack claim buys exactly what the player offered");
});
