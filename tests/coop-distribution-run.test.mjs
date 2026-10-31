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
      // A market that keeps REFUSING is bounded by real settlements, then reported.
      // A retryable refusal (a market that is away) is bounded by settled answers.
      sell: async () => { calls += 1; return { status: "NOT_SOLD", reason: "MARKET_UNAVAILABLE" }; },
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

test("after a sale the hull goes home and takes another load", async () => {
  // A hull that waits in the buyer system with an empty hold is dead freight: measured
  // 2026-10-30 the first sale left it sitting in Jita with nothing to do.
  const eighth = 980000004175;
  run.write({ version: 1, haulerID: eighth, phase: "SELL", trip: TRIP, updatedAt: 10000,
    sellCalls: 0, isk: 0, quantity: 1, trips: 0,
    fromStationID: 60000682, fromSystemID: 30000145,
    toStationID: 60003760, toSystemID: 30000142 });
  const sold = await run.tick(eighth, { recycle: true, distanceTo: () => 100,
    sell: async () => ({ status: "SOLD", isk: 560000 }), now: 10001 });
  assert.equal(sold.status, "RETURN");
  assert.equal(sold.state.trips, 1);
  assert.equal(sold.state.returnToSystemID, 30000145);
  // Not home yet: a crossing home is planned, never a silent replan.
  const away = await run.tick(eighth, { recycle: true, hullSystemOf: () => 30000142,
    planCrossingTo: (args) => { assert.equal(args.targetSystemID, 30000145);
      return { status: "PLANNED" }; }, now: 10002 });
  assert.equal(away.status, "RETURN_CROSSING");
  // Home: the journal resets so the next beat plans a new trip.
  const home = await run.tick(eighth, { recycle: true, hullSystemOf: () => 30000145, now: 10003 });
  assert.equal(home.status, "REPLANNING");
  assert.equal(run.read(eighth).phase, "PLAN");
  assert.equal(run.read(eighth).trips, 1, "the trip count survives the reset");
});

test("a cycle is bounded: the last allowed load ends the run, and no trip ends it too", async () => {
  const ninth = 980000004176;
  const base = { version: 1, haulerID: ninth, phase: "SELL", trip: TRIP,
    sellCalls: 0, isk: 0, quantity: 1,
    fromStationID: 60000682, fromSystemID: 30000145,
    toStationID: 60003760, toSystemID: 30000142 };
  // One load left before the bound: the sale still sends the hull home.
  run.write({ ...base, updatedAt: 11000, trips: run.MAX_TRIPS - 2 });
  const sold = await run.tick(ninth, { recycle: true, distanceTo: () => 100,
    sell: async () => ({ status: "SOLD", isk: 1000 }), now: 11001 });
  assert.equal(sold.status, "RETURN");
  assert.equal(sold.state.trips, run.MAX_TRIPS - 1);
  // Home again: the planner is asked once more and finds nothing worth taking.
  const home = await run.tick(ninth, { recycle: true, hullSystemOf: () => 30000145, now: 11002 });
  assert.equal(home.status, "REPLANNING");
  const end = await run.tick(ninth, { recycle: true, hullSystemOf: () => 30000145,
    planTrip: () => ({ status: "NO_TRIP_WORTH_TAKING" }), now: 11003 });
  assert.equal(end.status, "DONE");
  assert.equal(run.read(ninth).phase, "DONE");
  // And the bound itself: a run at MAX_TRIPS sells and stops instead of cycling.
  const tenth = 980000004177;
  run.write({ ...base, haulerID: tenth, updatedAt: 12000, trips: run.MAX_TRIPS - 1 });
  const lastLoad = await run.tick(tenth, { recycle: true, distanceTo: () => 100,
    sell: async () => ({ status: "SOLD", isk: 1000 }), now: 12001 });
  assert.equal(lastLoad.status, "DONE");
});

test("the completed journal of the outward trip is not mistaken for the way home", async () => {
  // Measured 2026-10-30: a stale ARRIVED journal made the run report RETURNED for ever while
  // the hull still sat in the buyer system. Only the durable record proves the hull is home.
  const eleventh = 980000004178;
  run.write({ version: 1, haulerID: eleventh, phase: "RETURN", updatedAt: 13000, trips: 1,
    returnToSystemID: 30000145, returnStationID: 60000682, crossAt: 0, isk: 560000 });
  let planned = null;
  const result = await run.tick(eleventh, { recycle: true, hullSystemOf: () => 30000142,
    crossingPhase: () => "ARRIVED",
    planCrossingTo: (args) => { planned = args.targetSystemID; return { status: "PLANNED" }; },
    now: 13001 });
  assert.equal(result.status, "RETURN_CROSSING");
  assert.equal(planned, 30000145, "a fresh crossing home is planned");
});

test("a partly sold load keeps selling before the hull goes home", async () => {
  // Measured 2026-10-30: 37 428 units settled while 35 629 stayed in the hold, and the run
  // returned home with them and loaded a full-size trip on top.
  const twelfth = 980000004179;
  run.write({ version: 1, haulerID: twelfth, phase: "SELL", trip: TRIP, updatedAt: 14000,
    sellCalls: 0, isk: 0, quantity: 73000, trips: 0,
    fromStationID: 60000682, fromSystemID: 30000145,
    toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(twelfth, { recycle: true, distanceTo: () => 100,
    cargoUnits: () => 35629,
    sell: async () => ({ status: "SOLD", isk: 668088 }), now: 14001 });
  assert.equal(result.status, "PARTIALLY_SOLD");
  assert.equal(result.state.phase, "SELL", "it keeps selling instead of flying home");
  assert.equal(result.state.isk, 668088, "and the money that did arrive is recorded");
});

test("a hull with no freight where it stands repositions to where the freight is", async () => {
  // Measured 2026-10-30: a distribution hull parked in the buyer system has nothing to load;
  // the corporation keeps its stock one gate away, so the run goes and gets it.
  const thirteenth = 980000004180;
  const result = await run.tick(thirteenth, { recycle: true, hullSystemOf: () => 30000142,
    planTrip: () => ({ status: "NO_STOCK_IN_SYSTEM", systemID: 30000142 }),
    homeSystemFor: () => 30000145, now: 15000 });
  assert.equal(result.status, "REPOSITIONING");
  assert.equal(run.read(thirteenth).phase, "RETURN");
  assert.equal(run.read(thirteenth).returnToSystemID, 30000145);
});

test("one hung hull does not freeze the others", async () => {
  const slow = 980000004181;
  const fast = 980000004182;
  const results = await run.tickAll({
    hulls: () => [slow, fast],
    hullTimeoutMs: 1000,
    hullSystemOf: () => 30000145,
    // The first hull never answers; the second must still be served.
    planTrip: ({haulerID}) => (Number(haulerID) === slow
      ? new Promise((resolve) => setTimeout(() => resolve({ status: "NO_TRIP" }), 1800))
      : { status: "OK", trip: TRIP }),
    distanceTo: () => 100,
  });
  const byHull = new Map(results.map((row) => [Number(row.haulerID), row]));
  assert.equal(byHull.get(slow).status, "HULL_TIMEOUT");
  assert.equal(byHull.get(fast).status, "PLANNED");
});

test("a run blocked by a slow market retries once after a long cooldown, and only with cargo", async () => {
  const fourteenth = 980000004183;
  run.write({ version: 1, haulerID: fourteenth, phase: "BLOCKED", updatedAt: 16000,
    blockedAt: 16000, retries: 0, lastReason: "SALE_STOPPED:CALL_LIMIT",
    trip: TRIP, toStationID: 60003760, toSystemID: 30000142, isk: 0 });
  // Too early: nothing happens.
  const early = await run.tick(fourteenth, { cargoUnits: () => 5000, now: 17000 });
  assert.equal(early.status, "IDLE");
  // After the cooldown, with goods aboard, it may try again.
  const late = await run.tick(fourteenth,
    { cargoUnits: () => 5000, now: 16000 + run.BLOCKED_RETRY_MS + 1 });
  assert.equal(late.status, "RETRYING");
  assert.equal(run.read(fourteenth).phase, "SELL");
  assert.equal(run.read(fourteenth).retries, 1);
});

test("an empty hold that proves the sale does not invent an amount", async () => {
  const fifteenth = 980000004184;
  run.write({ version: 1, haulerID: fifteenth, phase: "SELL", trip: TRIP, updatedAt: 18000,
    sellCalls: 0, isk: 0, quantity: 1, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(fifteenth, { cargoUnits: () => 0, now: 18001 });
  assert.equal(result.status, "DONE");
  assert.equal(result.state.iskUnknown, true, "the amount is unknown, not zero");
  assert.equal(result.state.isk, 0);
});

test("goods already aboard are sold, not parked when the planner refuses a full hold", async () => {
  // Measured 2026-10-30: a hull that had sold only part of its load was refused a new trip
  // HOLD_ALREADY_FULL and the run simply ended, leaving the freight sitting in the hold.
  const sixteenth = 980000004185;
  const result = await run.tick(sixteenth, { recycle: true, hullSystemOf: () => 30000142,
    planTrip: () => ({ status: "HOLD_ALREADY_FULL" }),
    stationForCargo: () => 60003760, now: 19000 });
  assert.equal(result.status, "LIQUIDATING");
  assert.equal(run.read(sixteenth).phase, "SELL");
  assert.equal(run.read(sixteenth).toStationID, 60003760);
});

test("freight nobody nearby buys crosses one gate to the buyer", async () => {
  // Measured 2026-10-30: ore carried in New Caldari had no local buyer at all, while Jita one
  // gate away bid 4 035 826 units for it. The cargo crosses first, then TO_DEST/SELL take over.
  const seventeenth = 980000004186;
  let plannedTo = 0;
  const result = await run.tick(seventeenth, {
    recycle: true,
    hullSystemOf: () => 30000145,
    planTrip: () => ({ status: "HOLD_ALREADY_FULL" }),
    stationForCargo: () => 0,
    buyerForCargo: () => ({ systemID: 30000142, stationID: 60003760 }),
    planCrossingTo: (args) => { plannedTo = args.targetSystemID; return { status: "PLANNED" }; },
    now: 20000,
  });
  assert.equal(result.status, "LIQUIDATING_ACROSS");
  assert.equal(plannedTo, 30000142, "a crossing to the buyer's system is planned");
  const state = run.read(seventeenth);
  assert.equal(state.phase, "CROSS");
  assert.equal(state.toStationID, 60003760);
  assert.equal(state.toSystemID, 30000142);
});

test("no local buyer and no neighbour means the run ends with the truth", async () => {
  const eighteenth = 980000004187;
  const result = await run.tick(eighteenth, {
    recycle: true, hullSystemOf: () => 30000145,
    planTrip: () => ({ status: "HOLD_ALREADY_FULL" }),
    stationForCargo: () => 0, buyerForCargo: () => null, now: 21000,
  });
  assert.equal(result.status, "DONE");
  assert.equal(run.read(eighteenth).lastReason, "HOLD_ALREADY_FULL");
});

test("a settled sale is written to the freight ledger, where the money is accounted", async () => {
  // The economy ledger counted production and station sales, so a trip's ISK lived only in the
  // pilot's balance and a treasury sweep.
  const nineteenth = 980000004188;
  run.write({ version: 1, haulerID: nineteenth, phase: "SELL", trip: TRIP, updatedAt: 22000,
    sellCalls: 0, isk: 0, quantity: 1000, trips: 0,
    fromSystemID: 30000145, toSystemID: 30000142, toStationID: 60003760,
    fromStationID: 60000682 });
  // The hold has goods until the sale lands, then it is empty: the trip is finished.
  let aboard = 1000;
  const result = await run.tick(nineteenth, { recycle: false, distanceTo: () => 100,
    cargoUnits: () => aboard,
    sell: async () => { aboard = 0; return { status: "SOLD", isk: 123456, quantity: 1000 }; },
    now: 22001 });
  assert.equal(result.status, "DONE");
  const rows = fs.readFileSync(run.freightLedgerFile(), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const mine = rows.filter((row) => Number(row.haulerID) === nineteenth);
  assert.equal(mine.length, 1, "one row per settled sale");
  assert.equal(mine[0].isk, 123456);
  assert.equal(mine[0].toStationID, 60003760);
  assert.equal(mine[0].status, "SOLD");
});

test("a trip that loads at two stations walks the stops before it crosses", async () => {
  // The bundle takes each stack where it really sits, so one trip can need two stations.
  const twentieth = 980000004189;
  const trip = { ...TRIP, fromStationID: 60000682, items: [
    { stationID: 60000682, typeID: 34, quantity: 1000, price: 4, m3PerUnit: 0.01 },
    { stationID: 60014935, typeID: 35, quantity: 500, price: 15, m3PerUnit: 0.01 },
  ], demand: { 34: { price: 4, volume: 1000 }, 35: { price: 15, volume: 500 } } };
  const planned = await run.tick(twentieth, { planTrip: () => ({ status: "OK", trip }), now: 23000 });
  assert.equal(planned.status, "PLANNED");
  assert.equal(run.read(twentieth).stops.length, 2, "two stops, in the order the bundle chose");
  // First stop: lift what sits there.
  const lifted = [];
  const first = await run.tick(twentieth, {
    distanceTo: () => 100,
    lift: async (args) => { lifted.push(args.stationID);
      return { status: "LIFTED", lifted: [{ typeID: 34, quantity: 1000, price: 4 }] }; },
    now: 23001 });
  assert.equal(first.status, "NEXT_STOP");
  assert.deepEqual(lifted, [60000682]);
  assert.equal(run.read(twentieth).stopIndex, 1);
  // Second stop: lift, then the crossing is planned for the whole load.
  let crossed = false;
  const second = await run.tick(twentieth, {
    distanceTo: () => 100,
    lift: async (args) => { lifted.push(args.stationID);
      return { status: "LIFTED", lifted: [{ typeID: 35, quantity: 500, price: 15 }] }; },
    planCrossing: () => { crossed = true; return { status: "PLANNED" }; },
    now: 23002 });
  assert.deepEqual(lifted, [60000682, 60014935]);
  assert.equal(crossed, true, "the hull only leaves the system once every stop is loaded");
  assert.equal(second.status, "CROSS");
});

test("a stop whose goods moved away is skipped, not fatal", async () => {
  // Measured 2026-10-30: two hulls were refused NO_LOCAL_BID at their second stop and the whole
  // journey stopped with the first stop's cargo still aboard.
  const twentyFirst = 980000004190;
  const trip = { ...TRIP, fromStationID: 60000682, items: [
    { stationID: 60000682, typeID: 34, quantity: 1000, price: 4, m3PerUnit: 0.01 },
    { stationID: 60014935, typeID: 35, quantity: 500, price: 15, m3PerUnit: 0.01 },
  ] };
  await run.tick(twentyFirst, { planTrip: () => ({ status: "OK", trip }), now: 24000 });
  const first = await run.tick(twentyFirst, { distanceTo: () => 100,
    lift: async () => ({ status: "LIFTED", lifted: [{ typeID: 34, quantity: 1000, price: 4 }] }),
    now: 24001 });
  assert.equal(first.status, "NEXT_STOP");
  const second = await run.tick(twentyFirst, { distanceTo: () => 100,
    cargoUnits: () => 1000,
    lift: async () => ({ status: "NO_LOCAL_BID" }),
    planCrossing: () => ({ status: "PLANNED" }), now: 24002 });
  // The last stop was empty, but the hull already carries the first stop's cargo: fly it.
  assert.equal(second.status, "CROSS");
  assert.equal(second.reason, "LOADED_PARTIAL");
  assert.equal(run.read(twentyFirst).skippedStops.length, 1);
});

test("the amount is read quickly enough to survive the five-second settlement window", async () => {
  // Measured 2026-10-30: four of nine trips were recorded with no price because the run waited a
  // full poll interval (6 s) and the settled answer was already gone.
  const twentySecond = 980000004191;
  run.write({ version: 1, haulerID: twentySecond, phase: "SELL", trip: TRIP, updatedAt: 25000,
    sellCalls: 0, isk: 0, quantity: 1000, trips: 0,
    fromSystemID: 30000145, toSystemID: 30000142, toStationID: 60003760 });
  let aboard = 1000;
  let reads = 0;
  const result = await run.tick(twentySecond, { recycle: false, distanceTo: () => 100,
    cargoUnits: () => aboard,
    sell: async () => ({ status: "PENDING" }),
    wait: async () => {},
    // The settlement appears on the second read, before the window closes.
    saleSettlement: () => { reads += 1;
      if (reads < 2) return null;
      aboard = 0;
      return { status: "SOLD", isk: 777000, quantity: 1000 }; },
    now: 25001 });
  assert.equal(result.status, "DONE");
  assert.equal(result.state.isk, 777000, "the real amount, not an unknown price");
  assert.ok(reads >= 2);
});

test("a busy hull waits for the market instead of stopping with its cargo", async () => {
  // Measured 2026-10-30: a loaded hull was blocked SALE_NOT_SOLD:NATIVE_NPC_BUSY and kept
  // 20 255 units aboard for good.
  const twentyThird = 980000004192;
  run.write({ version: 1, haulerID: twentyThird, phase: "SELL", trip: TRIP, updatedAt: 26000,
    sellCalls: 0, isk: 0, quantity: 1000, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(twentyThird, { distanceTo: () => 100, cargoUnits: () => 1000,
    sell: async () => ({ status: "NOT_SOLD", reason: "NATIVE_NPC_BUSY" }), now: 26001 });
  assert.equal(result.status, "WAITING_FOR_SALE");
  assert.equal(run.read(twentyThird).phase, "SELL", "the run keeps the trip it is on");
});

test("any BUSY answer from the world is a not-yet, whatever its spelling", async () => {
  const twentyFourth = 980000004193;
  run.write({ version: 1, haulerID: twentyFourth, phase: "SELL", trip: TRIP, updatedAt: 27000,
    sellCalls: 0, isk: 0, quantity: 1000, toStationID: 60003760, toSystemID: 30000142 });
  const result = await run.tick(twentyFourth, { distanceTo: () => 100, cargoUnits: () => 1000,
    sell: async () => ({ status: "NOT_SOLD", reason: "TRADE_BUSY" }), now: 27001 });
  assert.equal(result.status, "WAITING_FOR_SALE");
  assert.equal(run.read(twentyFourth).phase, "SELL");
});

test("the ledger reports the whole load, not only the last stop", async () => {
  // Measured 2026-10-30: rows said "lines: 1" for trips that loaded at four stations, because
  // only the last lift was kept in the journal.
  const twentyFifth = 980000004194;
  const trip = { ...TRIP, fromStationID: 60000682, items: [
    { stationID: 60000682, typeID: 34, quantity: 1000, price: 4, m3PerUnit: 0.01 },
    { stationID: 60014935, typeID: 35, quantity: 500, price: 15, m3PerUnit: 0.01 },
  ] };
  await run.tick(twentyFifth, { planTrip: () => ({ status: "OK", trip }), now: 28000 });
  await run.tick(twentyFifth, { distanceTo: () => 100,
    lift: async () => ({ status: "LIFTED", lifted: [{ typeID: 34, quantity: 1000, price: 4 }] }),
    now: 28001 });
  const done = await run.tick(twentyFifth, { distanceTo: () => 100,
    lift: async () => ({ status: "LIFTED", lifted: [{ typeID: 35, quantity: 500, price: 15 }] }),
    planCrossing: () => ({ status: "PLANNED" }), now: 28002 });
  assert.equal(done.status, "CROSS");
  const state = run.read(twentyFifth);
  assert.equal(state.lifted.length, 2, "both stops are in the journal");
  assert.equal(state.quantity, 1500, "and so is the whole load");
});

test("a finished run rests and then takes another load while recycling", async () => {
  // Measured 2026-10-30: four hulls reached their trip cap and sat DONE for ever while 5.28 M
  // minerals waited; the fleet only moved again because an operator cleared the journals.
  const twentySixth = 980000004195;
  run.write({ version: 1, haulerID: twentySixth, phase: "DONE", updatedAt: 30000,
    isk: 1234, trips: run.MAX_TRIPS });
  const tooSoon = await run.tick(twentySixth, { recycle: true, now: 31000 });
  assert.equal(tooSoon.status, "IDLE", "it rests first");
  const rested = await run.tick(twentySixth,
    { recycle: true, now: 30000 + run.REST_BETWEEN_CYCLES_MS + 1 });
  assert.equal(rested.status, "RESTED");
  assert.equal(run.read(twentySixth).phase, "PLAN");
  assert.equal(run.read(twentySixth).cycles, 1);
});

test("a hull that has sold imports the inputs its factory lacks, then goes home", async () => {
  // Measured 2026-10-31: the refinery in this system only ever sees Veldspar, so the Pyerite and
  // Mexallon the factory needs exist only at the station that sells them. A hull standing at the
  // buyer's station with an empty hold is the ship that carries them home.
  const hull = 980000004173;
  await run.tick(hull, { planTrip: () => ({ status: "OK", trip: { ...TRIP } }), now: 20000 });
  run.write({ ...run.read(hull), phase: "CROSS", updatedAt: 20050 });
  await run.tick(hull, { crossingPhase: () => "ARRIVED", distanceTo: () => 500000,
    goTo: () => true, now: 20060 });
  const bought = [];
  const sold = await run.tick(hull, {
    distanceTo: () => 900,
    sell: async () => ({ status: "SOLD", isk: 250000 }),
    buyInputs: async (args) => {
      bought.push(args);
      return bought.length === 1
        ? { status: "BOUGHT", typeID: 35, quantity: 20, price: 16.03 }
        : { status: "NOTHING_TO_BUY" };
    },
    now: 21000,
  });
  assert.equal(sold.status, "IMPORTING");
  assert.equal(sold.state.phase, "SUPPLY");
  assert.equal(sold.state.toStationID, 60003760, "inputs are bought where the hull really is");
  const first = await run.tick(hull, {
    distanceTo: () => 900,
    cargoUnits: () => 0,
    buyInputs: async (args) => { bought.push(args); return { status: "BOUGHT", typeID: 35,
      quantity: 20, price: 16.03 }; },
    now: 22000,
  });
  assert.equal(first.status, "SUPPLIED:35x20");
  assert.equal(bought.length, 1);
  const second = await run.tick(hull, {
    distanceTo: () => 900,
    cargoUnits: () => 0,
    buyInputs: async (args) => { bought.push(args); return { status: "NOTHING_TO_BUY" }; },
    now: 23000,
  });
  assert.equal(second.status, "RETURN");
  assert.equal(second.state.phase, "RETURN");
  assert.equal(second.state.supplyTries, 0, "the import budget is per visit");
  assert.equal(second.state.returnStationID, 60000682);
});

test("a station that sells nothing ends the import instead of spinning", async () => {
  const hull = 980000004174;
  await run.tick(hull, { planTrip: () => ({ status: "OK", trip: { ...TRIP } }), now: 24000 });
  run.write({ ...run.read(hull), phase: "CROSS", updatedAt: 24050 });
  await run.tick(hull, { crossingPhase: () => "ARRIVED", distanceTo: () => 500000,
    goTo: () => true, now: 24060 });
  await run.tick(hull, { distanceTo: () => 900, now: 25000,
    sell: async () => ({ status: "SOLD", isk: 1000 }),
    buyInputs: async () => ({ status: "NOTHING_TO_BUY" }) });
  const result = await run.tick(hull, { distanceTo: () => 900, cargoUnits: () => 0, now: 26000,
    buyInputs: async () => ({ status: "NO_SEEDED_COUNTERPARTY" }) });
  assert.equal(result.status, "RETURN");
  assert.match(result.reason, /^SUPPLY_STOPPED:NO_SEEDED_COUNTERPARTY/);
});

test("a hull with nothing to carry shops for the factory's missing input", async () => {
  // Measured 2026-10-31: nothing in the hold pays, the factory still answers MATERIALS_MISSING,
  // and the only seller of the missing mineral is one system over. The hull leaves empty, buys
  // there, and comes home - it never sells on a shopping trip.
  const hull = 980000004196;
  const trip = { mode: "import", typeID: 35, quantity: 0, expectedIsk: 0,
    fromStationID: 60003760, fromSystemID: 30000142, toStationID: 60003760,
    toSystemID: 30000142, homeStationID: 60000682, homeSystemID: 30000145,
    gate: null, items: [{ stationID: 60003760, typeID: 35, quantity: 0 }] };
  const planned = await run.tick(hull, {
    planTrip: () => ({ status: "NO_TRIP" }),
    importPlan: () => ({ status: "OK", trip }),
    now: 30000,
  });
  assert.equal(planned.status, "PLANNED_IMPORT");
  assert.equal(planned.state.mode, "import");
  assert.deepEqual(planned.state.importTypes, [35]);
  assert.equal(planned.state.homeStationID, 60000682, "the way home is the factory, not the shop");
  assert.equal(planned.state.stops[0].stationID, 60003760);

  const flying = await run.tick(hull, { distanceTo: () => 500000, goTo: () => true, now: 31000 });
  assert.equal(flying.status, "ORDERED");
  // Arrived at the seller: nothing is loaded and no gate is needed (same system).
  const ready = await run.tick(hull, { distanceTo: () => 900, now: 32000 });
  assert.equal(ready.status, "TO_DEST", "a shopping trip crosses empty or not at all");
  assert.equal(ready.state.quantity, 0);
  const buying = await run.tick(hull, { distanceTo: () => 900, now: 33000,
    lift: async () => { throw new Error("a shopping trip lifts nothing"); },
    sell: async () => { throw new Error("a shopping trip sells nothing"); } });
  assert.equal(buying.status, "SUPPLY", "the seller's station is where the buying happens");
  const bought = await run.tick(hull, { distanceTo: () => 900, now: 34000,
    buyInputs: async () => ({ status: "BOUGHT", typeID: 35, quantity: 20, price: 16.03 }) });
  assert.equal(bought.status, "SUPPLIED:35x20");
  const home = await run.tick(hull, { distanceTo: () => 900, now: 35000,
    buyInputs: async () => ({ status: "NOTHING_TO_BUY" }) });
  assert.equal(home.status, "RETURN");
  assert.equal(home.state.returnToSystemID, 30000145);
  assert.equal(home.state.returnStationID, 60000682);
  // Home again: the last in-system leg is flown, then the hold is unloaded into the hangar.
  const arrived = await run.tick(hull, { distanceTo: () => 500000, hullSystemOf: () => 30000145,
    goTo: () => true, now: 36000 });
  assert.equal(arrived.status, "IMPORT_HOME", "home in system is not home at the station");
  let unloaded = null;
  let refreshed = false;
  const back = await run.tick(hull, { distanceTo: () => 900, hullSystemOf: () => 30000145, now: 37000,
    refreshFactorySupply: () => { refreshed = true; return true; },
    stow: (args) => { unloaded = args; return { status: "STOWED",
      stowed: [{ typeID: 35, quantity: 20, status: "STOWED" }] }; } });
  assert.equal(back.status, "REPLANNING");
  assert.deepEqual(unloaded.types, [35], "only what this trip bought is unloaded");
  assert.equal(back.state.lastReason, "UNLOADED_AT_FACTORY");
  assert.equal(refreshed, true, "a delivery must invalidate the cached shortfall");
});

test("a paying trip is still preferred over a shopping trip", async () => {
  const hull = 980000004197;
  let shopped = false;
  const result = await run.tick(hull, {
    planTrip: () => ({ status: "OK", trip: { ...TRIP } }),
    importPlan: () => { shopped = true; return { status: "OK", trip: { mode: "import" } }; },
    now: 38000,
  });
  assert.equal(result.status, "PLANNED");
  assert.equal(shopped, false);
});

test("a seller in the next system is crossed before the hull shops", async () => {
  // The factory is in New Caldari and the only honest seller is Jita 4-4, one gate over: the
  // empty hull crosses first, then flies the last leg inside the seller's system.
  const hull = 980000004198;
  const trip = { mode: "import", typeID: 35, quantity: 0, expectedIsk: 0,
    fromStationID: 60003760, fromSystemID: 30000142, toStationID: 60003760,
    toSystemID: 30000142, homeStationID: 60000682, homeSystemID: 30000145,
    gate: { sourceGateID: 50002198, destinationGateID: 50001250,
      sourceSystemID: 30000145, destinationSystemID: 30000142 },
    items: [{ stationID: 60003760, typeID: 35, quantity: 0 }] };
  const planned = await run.tick(hull, {
    planTrip: () => ({ status: "NO_TRIP" }),
    importPlan: () => ({ status: "OK", trip }),
    planCrossing: ({ gate }) => {
      assert.equal(gate.destinationSystemID, 30000142);
      return { status: "PLANNED" };
    },
    now: 39000,
  });
  assert.equal(planned.status, "PLANNED_IMPORT");
  assert.equal(planned.state.phase, "CROSS", "an empty hold still has to cross a gate");
  const arrived = await run.tick(hull, { crossingPhase: () => "ARRIVED", now: 40000 });
  assert.equal(arrived.status, "TO_DEST");
});

test("an empty hull that found nothing to load shops instead of blocking", async () => {
  const hull = 980000004199;
  await run.tick(hull, { planTrip: () => ({ status: "OK", trip: { ...TRIP } }), now: 41000 });
  run.write({ ...run.read(hull), phase: "TO_ORIGIN", stopIndex: 0, updatedAt: 41050 });
  const empty = await run.tick(hull, { distanceTo: () => 900, cargoUnits: () => 0, now: 41100,
    lift: async () => ({ status: "NO_LOCAL_BID" }),
    importPlan: () => ({ status: "NOTHING_TO_BUY" }) });
  assert.equal(empty.status, "REPLANNING");
  assert.equal(empty.state.forceImport, true);
  let asked = false;
  const forced = await run.tick(hull, {
    planTrip: () => { throw new Error("the stale book must not be asked first"); },
    importPlan: () => { asked = true; return { status: "OK", trip: {
      mode: "import", typeID: 35, quantity: 0, expectedIsk: 0,
      fromStationID: 60003760, fromSystemID: 30000142, toStationID: 60003760,
      toSystemID: 30000142, homeStationID: 60000682, homeSystemID: 30000145,
      gate: null, items: [{ stationID: 60003760, typeID: 35, quantity: 0 }] } }; },
    now: 41200,
  });
  assert.equal(asked, true, "the forced plan asks for inputs before the stale book");
  assert.equal(forced.status, "PLANNED_IMPORT");
});

test("an empty blocked hull retries into a shopping trip, not into a sale", async () => {
  const hull = 980000004200;
  run.write({ version: 1, haulerID: hull, phase: "BLOCKED", lastReason: "NO_CARGO_AT_ANY_STOP",
    blockedAt: 1000, updatedAt: 1000, trips: 0, isk: 0 });
  const retried = await run.tick(hull, { cargoUnits: () => 0, now: 1000 + 31 * 60 * 1000,
    importPlan: () => ({ status: "NOTHING_TO_BUY" }) });
  assert.equal(retried.status, "RETRYING");
  assert.equal(retried.state.phase, "PLAN");
  assert.equal(retried.state.forceImport, true);
});
