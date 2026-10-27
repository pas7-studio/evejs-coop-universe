import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, "..");
const guard = require(path.join(ROOT, "integration", "coopMiningTripRetreatGuard.cjs"));

function fleet(trip) {
  return {
    fleetID: 960004609, systemID: 30000144,
    minerEntityIDs: [1, 2], haulerEntityIDs: [3, 4],
    coopStationArrival: trip,
  };
}

test("a hauler flying an acknowledged station trip keeps its route", () => {
  process.env.EVEJS_COOP_MINING_TRIP_RETREAT_GUARD = "1";
  guard.reset();
  const record = fleet({ manifestID: "30000144-960004609-1", haulers: { 3: { arrivedAt: 0 } } });
  assert.equal(guard.skip(record, 3), true);
});

test("a miner and a hauler outside the trip still retreat", () => {
  process.env.EVEJS_COOP_MINING_TRIP_RETREAT_GUARD = "1";
  guard.reset();
  const record = fleet({ manifestID: "30000144-960004609-1", haulers: { 3: { arrivedAt: 0 } } });
  assert.equal(guard.skip(record, 1), false, "miners are the retreat's own");
  assert.equal(guard.skip(record, 4), false, "a hauler the trip never declared is free");
});

test("no trip, or a trip without a departure witness, is not protected", () => {
  process.env.EVEJS_COOP_MINING_TRIP_RETREAT_GUARD = "1";
  guard.reset();
  assert.equal(guard.skip(fleet(null), 3), false);
  assert.equal(guard.skip(fleet({ haulers: { 3: { arrivedAt: 0 } } }), 3), false);
});

test("the guard is OFF unless the flag is set", () => {
  delete process.env.EVEJS_COOP_MINING_TRIP_RETREAT_GUARD;
  guard.reset();
  const record = fleet({ manifestID: "30000144-960004609-1", haulers: { 3: { arrivedAt: 0 } } });
  assert.equal(guard.skip(record, 3), false);
});
