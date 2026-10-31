import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { choose } = require("../integration/coopBlueprintPurchase.cjs");

// Measured 2026-10-31: the corporation owned 4 blueprints, so production could never become
// varied. The seeded world sells 2 772 blueprints at 10 500-20 000 ISK; this decides which one
// is worth the corporation's ISK, against the demand its product really has.
const ASKS = [
  { typeID: 1076, name: "Mining Survey Chipset Blueprint", stationID: 60003760, price: 20000, quantity: 2 },
  { typeID: 1318, name: "Expanded Cargohold I Blueprint", stationID: 60003760, price: 17000, quantity: 2 },
  { typeID: 999999, name: "Unknown", stationID: 60003760, price: 5000, quantity: 1 },
];
const DEMAND = { 444: { volume: 142, price: 1501 }, 1319: { volume: 8000, price: 9000 } };
const PRODUCT_OF = { 1076: 444, 1318: 1319 };

test("the blueprint whose product has real demand wins, not the cheapest one", () => {
  const answer = choose({ asks: ASKS, owned: [], demand: DEMAND, productOf: PRODUCT_OF,
    budget: 5000000, priceCap: 500000 });
  assert.equal(answer.status, "BUY");
  assert.equal(answer.blueprint.typeID, 1318, "8 000 x 9 000 beats 142 x 1 501");
  assert.equal(answer.blueprint.productTypeID, 1319);
});

test("a blueprint the corporation already owns is never bought twice", () => {
  const answer = choose({ asks: ASKS, owned: [1318], demand: DEMAND, productOf: PRODUCT_OF });
  assert.equal(answer.status, "BUY");
  assert.equal(answer.blueprint.typeID, 1076);
  assert.ok(answer.refusals.some((row) => row.reason === "ALREADY_OWNED"));
});

test("a blueprint for goods nobody buys is refused by name", () => {
  const answer = choose({ asks: [ASKS[2]], owned: [], demand: DEMAND, productOf: { 999999: 1 } });
  assert.equal(answer.status, "NO_BLUEPRINT_WORTH_BUYING");
  assert.equal(answer.refusals.at(-1).reason, "NO_BUYER_FOR_ITS_PRODUCT");
});

test("prices and budgets are hard limits", () => {
  const tooDear = choose({ asks: [ASKS[0]], owned: [], demand: DEMAND, productOf: PRODUCT_OF,
    priceCap: 1000 });
  assert.equal(tooDear.status, "NO_BLUEPRINT_WORTH_BUYING");
  assert.equal(tooDear.refusals[0].reason, "ABOVE_PRICE_CAP");
  const enough = choose({ asks: ASKS, owned: [], demand: DEMAND, productOf: PRODUCT_OF,
    alreadyBought: 3, maxOwned: 3 });
  assert.equal(enough.status, "ENOUGH");
});

test("a recipe we cannot run is not a purchase", () => {
  const answer = choose({ asks: [ASKS[1]], owned: [], demand: DEMAND, productOf: {} });
  assert.equal(answer.refusals[0].reason, "NO_KNOWN_RECIPE");
});
