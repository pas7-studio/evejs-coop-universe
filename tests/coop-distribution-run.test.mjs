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
      // A market that keeps saying PENDING is bounded by real calls, then reported.
      sell: async () => { calls += 1; return { status: "PENDING" }; },
      wait: async () => {}, saleSettlement: () => null,
      now: 6000 + i * 1000 });
    if (last.status === "BLOCKED") break;
  }
  assert.equal(last.status, "BLOCKED");
  assert.match(last.reason, /^SALE_STOPPED/);
  assert.equal(calls, run.MAX_SELL_CALLS, "exactly the bounded number of real calls");
});

test("a settlement the market refused stops the run with its own words", async () => {
  const fourth = 980000004167;
  run.write({ version: 1, haulerID: fourth, phase: "SELL", trip: TRIP, updatedAt: 8000,
    sellCalls: 0, isk: 0, quantity: 1, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(fourth, { distanceTo: () => 100,
    sell: async () => ({ status: "PENDING" }),
    wait: async () => {},
    saleSettlement: () => ({ status: "NOT_SOLD", reason: "NO_SEEDED_COUNTERPARTY" }),
    now: 8001 });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "SALE_NOT_SOLD:NO_SEEDED_COUNTERPARTY");
});

test("a sale proved by an empty hold is accepted without an answer from the market", async () => {
  const fifth = 980000004168;
  run.write({ version: 1, haulerID: fifth, phase: "SELL", trip: TRIP, updatedAt: 9000,
    sellCalls: 0, isk: 0, quantity: 1, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(fifth, { cargoUnits: () => 0, now: 9001,
    sell: async () => { throw new Error("must not be called"); } });
  assert.equal(result.status, "DONE");
  assert.equal(result.reason, "SOLD_VERIFIED_BY_HOLD");
});

test("a missing authority is reported, never guessed", async () => {
  const third = 980000004166;
  run.write({ version: 1, haulerID: third, phase: "LOAD", trip: TRIP, updatedAt: 7000,
    fromStationID: 60000682, fromSystemID: 30000145 });
  const result = await run.tick(third, { now: 7001 });
  assert.equal(result.status, "NO_LIFT");
});

test("a hull that drifted off the station is flown back, not asked to sell", async () => {
  // Measured 2026-10-30: the phase said SELL while the durable hull had been rebuilt out of
  // its scene, and the market answered NOT_AT_NATIVE_STATION. Distance is the truth.
  const sixth = 980000004171;
  run.write({ version: 1, haulerID: sixth, phase: "SELL", trip: TRIP, updatedAt: 9500,
    sellCalls: 0, isk: 0, quantity: 1, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(sixth, { distanceTo: () => 90000,
    sell: async () => { throw new Error("must not sell from 90 km"); }, now: 9501 });
  assert.equal(result.status, "TO_DEST");
  assert.equal(result.reason, "NOT_AT_STATION");
});

test("\"not at the station\" waits instead of stopping the run", async () => {
  const seventh = 980000004172;
  run.write({ version: 1, haulerID: seventh, phase: "SELL", trip: TRIP, updatedAt: 9600,
    sellCalls: 0, isk: 0, quantity: 1, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(seventh, { distanceTo: () => 100, wait: async () => {},
    sell: async () => ({ status: "PENDING" }),
    saleSettlement: () => ({ status: "NOT_SOLD", reason: "NOT_AT_NATIVE_STATION" }),
    now: 9601 });
  assert.equal(result.status, "WAITING_FOR_SALE");
  assert.equal(run.read(seventh).phase, "SELL");
  assert.ok(!result.reason.startsWith("SALE_NOT_SOLD"), "a retryable refusal is not a verdict");
});

test("a carried type outside the sell allowlist is still asked for", () => {
  // Measured 2026-10-30: the hull carried 28338 while Jita bid 560 000 for it, and every sale
  // answered NO_REAL_NATIVE_CARGO because that type is not in EVEJS_COOP_NPC_MARKET_SELL_TYPES.
  // The carried set only FILTERED the allowlist, so it could never add what the ship holds.
  const source = fs.readFileSync(path.join(process.cwd(), "integration/coopVirtualWorldRuntime.cjs"), "utf8");
  assert.ok(/for\(const typeID of carried\)[\s\S]{0,120}sellTypes\.push/.test(source),
    "what the hull really carries must join the sale list");
});
