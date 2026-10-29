import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// A distribution trip that carried air is not a distribution trip. Measured 2026-10-30: no
// step ever lifted a hangar stack into the hull that had just been proven able to cross a
// gate, so the whole freight path existed and moved nothing.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "distribution-run-"));
process.env.EVEJS_COOP_NPC_MARKET_ROOT = root;
const run = require("../integration/coopDistributionRun.cjs");

const TRIP = { fromStationID: 60000682, fromSystemID: 30000145, toStationID: 60003760,
  toSystemID: 30000142, typeID: 34, quantity: 100000, expectedIsk: 400000,
  gate: { sourceGateID: 50002198, destinationGateID: 50001250,
    sourceSystemID: 30000145, destinationSystemID: 30000142 } };
const HAULER = 980000004164;
// Each case owns its hull: a run is a durable journal, and a BLOCKED one stays blocked.

test("a trip that does not pay is refused before a hull moves", async () => {
  const result = await run.tick(980000004169, {
    planTrip: () => ({ status: "OK", trip: { ...TRIP, expectedIsk: 1000 } }),
    minIsk: 200000,
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /^TRIP_DOES_NOT_PAY/);
});

test("the run loads what the DESTINATION pays for, then plans a crossing", async () => {
  const order = [];
  // First beat plans the trip, second beat lifts at the origin station and plans the crossing.
  const planned = await run.tick(HAULER, { planTrip: () => ({ status: "OK", trip: TRIP }), now: 900 });
  assert.equal(planned.status, "PLANNED");
  const result = await run.tick(HAULER, {
    planTrip: () => ({ status: "OK", trip: TRIP }),
    distanceTo: () => 100,
    lift: async (args) => { order.push("lift"); assert.equal(args.stationID, 60000682,
      "the lift happens at the origin station"); return { status: "LIFTED",
      lifted: [{ typeID: 34, quantity: 100000, price: 4 }] }; },
    planCrossing: (args) => { order.push("cross"); assert.deepEqual(args.gate, TRIP.gate);
      return { status: "PLANNED" }; },
    now: 1000,
  });
  assert.equal(result.status, "CROSS");
  assert.deepEqual(order, ["lift", "cross"]);
  assert.equal(result.state.quantity, 100000);
  assert.equal(run.read(HAULER).phase, "CROSS", "the loaded trip is durable");
});

test("a crossing that the native adapter blocked stops the run with that reason", async () => {
  const result = await run.tick(HAULER, { crossingPhase: () => "BLOCKED", now: 2000 });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "CROSSING_BLOCKED");
});

test("a hull that has crossed flies to the destination station before it sells", async () => {
  run.write({ ...run.read(HAULER), phase: "CROSS", updatedAt: 2000 });
  let sold = false;
  const far = await run.tick(HAULER, { crossingPhase: () => "ARRIVED",
    distanceTo: () => 500000, goTo: () => true,
    sell: async () => { sold = true; return { status: "SOLD", isk: 1 }; }, now: 3000 });
  assert.equal(far.status, "TO_DEST");
  assert.equal(sold, false, "a hull 500 km out does not sell");
  assert.equal(far.state.phase, "TO_DEST", "the flight to the station is durable");
});
test("a real sale completes the run and records the ISK", async () => {
  const result = await run.tick(HAULER, {
    distanceTo: () => 900,
    sell: async (args) => { assert.equal(args.stationID, 60003760); return { status: "SOLD", isk: 400000 }; },
    now: 4000,
  });
  assert.equal(result.status, "DONE");
  assert.equal(result.state.isk, 400000);
  assert.equal(run.read(HAULER).phase, "DONE");
});

test("a finished run is not advanced again", async () => {
  const again = await run.tick(HAULER, { sell: async () => { throw new Error("no"); }, now: 5000 });
  assert.equal(again.status, "IDLE");
});

test("a sale the market refuses is bounded and then reported, never retried for ever", async () => {
  const another = 980000004165;
  run.write({ version: 1, haulerID: another, phase: "SELL", trip: TRIP, updatedAt: 6000,
    sellCalls: 0, isk: 0, toStationID: 60003760, toSystemID: 30000142 });
  let calls = 0;
  let last = null;
  for (let i = 0; i < run.MAX_SELL_CALLS + 2; i += 1) {
    last = await run.tick(another, { distanceTo: () => 100,
      sell: async () => { calls += 1; return { status: "NOT_SOLD", reason: "NO_BID" }; },
      now: 6000 + i * 1000 });
    if (last.status === "BLOCKED") break;
  }
  assert.equal(last.status, "BLOCKED");
  assert.match(last.reason, /^SALE_STOPPED/);
  assert.equal(calls, run.MAX_SELL_CALLS, "exactly the bounded number of real calls");
});

test("a missing authority is reported, never guessed", async () => {
  const third = 980000004166;
  run.write({ version: 1, haulerID: third, phase: "LOAD", trip: TRIP, updatedAt: 7000,
    fromStationID: 60000682, fromSystemID: 30000145 });
  const result = await run.tick(third, { now: 7001 });
  assert.equal(result.status, "NO_LIFT");
});
