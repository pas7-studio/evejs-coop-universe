// FW-108: the shortest gate route, because the war economy needs a real journey.
//
// MEASURED on the play stack 2026-10-30: combat loot (typeID 17470, 1230) is quoted by exactly
// one station in the sampled galaxy (Jita 60003760), while the front's whole region 10000048
// quotes neither type. `coopNpcGateTravel.tick` already accepts a multi-hop `route[]`, but
// nothing in the server built one - there was no BFS anywhere - so every consumer could only
// move one hop between two named systems and "sell it where it is bought" was undescribable.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { shortestGateRoute } = require("../integration/coopGateRoutes.cjs");

// A small graph shaped like a real one: a hub with two branches and a dead end.
const GATES = {
  30000142: [30003837, 30000144],
  30003837: [30000142, 30045344],
  30000144: [30000142, 30000145],
  30045344: [30003837],
  30000145: [30000144],
};
const neighbours = (id) => GATES[id] || [];

test("the nearest market is a real route, not a straight line", () => {
  const found = shortestGateRoute({ fromSystemID: 30045344, toSystemID: 30000142, neighbours });
  assert.equal(found.status, "ROUTE");
  assert.equal(found.hops, 2);
  assert.deepEqual(found.route, [30045344, 30003837, 30000142]);
});

test("a system is zero jumps from itself", () => {
  const found = shortestGateRoute({ fromSystemID: 30000145, toSystemID: 30000145, neighbours });
  assert.equal(found.hops, 0);
  assert.deepEqual(found.route, [30000145]);
});

test("the route never doubles back through a visited system", () => {
  const found = shortestGateRoute({ fromSystemID: 30000145, toSystemID: 30045344, neighbours });
  assert.equal(found.hops, 4);
  assert.equal(new Set(found.route).size, found.route.length);
});

test("an unreachable system says so instead of guessing a path", () => {
  const found = shortestGateRoute({
    fromSystemID: 30000142, toSystemID: 30009999, neighbours,
  });
  assert.equal(found.status, "UNREACHABLE");
});

test("a gate budget is honoured, so one call can never crawl the whole galaxy", () => {
  const found = shortestGateRoute({
    fromSystemID: 30000145, toSystemID: 30045344, neighbours, maxHops: 2,
  });
  assert.equal(found.status, "UNREACHABLE",
    "a route longer than the budget is a refusal, never a partial answer");
});

test("a graph that throws or answers garbage never invents a route", () => {
  assert.equal(shortestGateRoute({ fromSystemID: 1, toSystemID: 2,
    neighbours: () => { throw new Error("no world"); } }).status, "UNREACHABLE");
  assert.equal(shortestGateRoute({ fromSystemID: 1, toSystemID: 2,
    neighbours: () => [0, -5, "x"] }).status, "UNREACHABLE");
  assert.equal(shortestGateRoute({ fromSystemID: 0, toSystemID: 2, neighbours }).status,
    "INVALID_SYSTEM");
  assert.equal(shortestGateRoute({ fromSystemID: 1, toSystemID: 2 }).status, "NO_GATE_GRAPH");
});
