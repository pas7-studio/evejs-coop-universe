import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { gap } = require("../integration/coopDemandGap.cjs");

// The ceiling the loop hit on 2026-10-30: ships and holds full, three buildable products, and
// thousands of real bids nobody could answer. The manufacturer now says so in its own event.
const db = { prepare: () => ({ all: () => [
  { type_id: 444, volume: 142, price: 1501 },
  { type_id: 27419, volume: 842500, price: 895 },
  { type_id: 14767, volume: 1, price: 92000000000 },
  { type_id: 44992, volume: 11592, price: 4717168 },
] }) };
const resolveType = (id) => ({ 444: { name: "Chipset", categoryID: 7 },
  27419: { name: "Navy Missile", categoryID: 8 },
  14767: { name: "Hardener", categoryID: 7 },
  44992: { name: "PLEX", categoryID: 0 } }[Number(id)] || {});

test("demand the corporation cannot build is named, with the artifacts filtered out", () => {
  const answer = gap({ db, systemIDs: [30000142], blueprints: [1076],
    recipeOf: () => ({ status: "READY", productTypeID: 444 }),
    resolveType, limit: 5, maxPrice: 50000000 });
  assert.equal(answer.status, "GAP");
  assert.equal(answer.buildable, 1);
  assert.deepEqual(answer.gap.map((row) => row.typeID), [27419],
    "the 92 billion hardener and the PLEX are not a shopping list");
  assert.equal(answer.gapValue, Math.round(842500 * 895));
});

test("a book with nothing buildable and nothing producible is not a gap", () => {
  const answer = gap({ db: { prepare: () => ({ all: () => [
    { type_id: 44992, volume: 10, price: 1 }] }) },
    systemIDs: [30000142], blueprints: [], recipeOf: () => null, resolveType, limit: 3 });
  assert.equal(answer.status, "NO_GAP");
  assert.equal(answer.gapValue, 0);
});

test("no book is reported as no book, not as no demand", () => {
  const answer = gap({ db: null, systemIDs: [30000142] });
  assert.equal(answer.status, "NO_BOOK");
});
