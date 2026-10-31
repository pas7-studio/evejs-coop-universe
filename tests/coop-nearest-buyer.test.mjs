// FW-121: the nearest station that really bids for the cargo, by gate hops.
//
// MEASURED on the play stack 2026-10-31: 1 576 native cargo rows across 19 types sat in NPC holds
// and NOT ONE of those types had a seeded buyer in any of the six war or mining systems. Selling
// therefore always means travelling, and the only buyer finder in the server looked a single gate
// away. This walks the real gate graph ring by ring and asks the seeded book once per ring.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { nearestBuyerForTypes } = require("../integration/coopDistributionPlan.cjs");

// A tiny market: a fake db that answers the same query the planner issues.
function marketDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /seed_buy_orders/);
      return { all: (...args) => {
        const systems = args.slice(0, args.length - 1).map(Number);
        const types = args.slice(args.length - 1).map(Number);
        return rows.filter((row) => systems.includes(Number(row.sys)) &&
          types.includes(Number(row.type)));
      } };
    },
  };
}

const GATES = { 1: [2], 2: [1, 3], 3: [2, 4], 4: [3], 9: [] };
const neighbours = (id) => GATES[id] || [];

test("the nearest real market wins, not the first one found", () => {
  const db = marketDb([
    { sys: 4, station: 404, type: 34, volume: 9_000_000, price: 900 },
    { sys: 3, station: 303, type: 34, volume: 500, price: 100 },
  ]);
  const found = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours });
  assert.equal(found.status, "OK");
  assert.equal(found.systemID, 3, "two hops beats a huge book four hops away");
  assert.equal(found.hops, 2);
  assert.equal(found.stationID, 303);
});

test("a buyer in the same system is zero hops and needs no travel", () => {
  const db = marketDb([{ sys: 1, station: 101, type: 34, volume: 10, price: 5 }]);
  const found = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours });
  assert.equal(found.hops, 0);
  assert.equal(found.stationID, 101);
});

test("no buyer anywhere says so instead of naming a station", () => {
  const db = marketDb([{ sys: 9, station: 909, type: 34, volume: 100, price: 9 }]);
  const found = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours });
  assert.equal(found.status, "NO_BUYER");
  assert.equal(found.stationID, 0);
  assert.equal(found.systemsVisited >= 4, true, "it really walked the graph");
});

test("a hop budget is honoured, so one call never crawls the galaxy", () => {
  const db = marketDb([{ sys: 4, station: 404, type: 34, volume: 100, price: 9 }]);
  const found = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours,
    maxHops: 1 });
  assert.equal(found.status, "NO_BUYER");
  assert.equal(nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours,
    maxHops: 3 }).status, "OK");
});

test("an unreadable book or a missing graph is a refusal, never a guessed station", () => {
  const broken = { prepare: () => ({ all: () => { throw new Error("no db"); } }) };
  assert.equal(nearestBuyerForTypes({ db: broken, fromSystemID: 1, typeIDs: [34],
    neighbours }).status, "BOOK_UNREADABLE");
  assert.equal(nearestBuyerForTypes({ db: marketDb([]), fromSystemID: 1, typeIDs: [34] }).status,
    "NO_GATE_GRAPH");
  assert.equal(nearestBuyerForTypes({ db: marketDb([]), fromSystemID: 0, typeIDs: [34],
    neighbours }).status, "UNKNOWN");
  assert.equal(nearestBuyerForTypes({ db: marketDb([]), fromSystemID: 1, typeIDs: [],
    neighbours }).status, "UNKNOWN");
});

test("the same world always answers the same station", () => {
  const db = marketDb([
    { sys: 3, station: 303, type: 34, volume: 500, price: 100 },
    { sys: 3, station: 302, type: 34, volume: 500, price: 100 },
  ]);
  const first = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours });
  const again = nearestBuyerForTypes({ db, fromSystemID: 1, typeIDs: [34], neighbours });
  assert.deepEqual(first, again);
  assert.equal(first.stationID, 302, "an exact tie is broken by the lower station id");
});
