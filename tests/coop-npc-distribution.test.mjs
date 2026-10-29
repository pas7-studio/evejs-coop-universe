import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { plan } = require("../integration/coopNpcDistribution.cjs");

// Measured 2026-10-29: the corporation held 874 916 Tritanium, 118 434 Pyerite and 173 613
// Scordite III-Grade, none of which any station in its own system bought, while Jita - one
// real gate away - bid 4 ISK x 4 000 000 for Tritanium. The decision is which stack to ship
// and whether the trip pays; the movement is a separate, opt-in capability.
const JITA = 60003760;

const stack = (typeID, quantity, m3PerUnit = 0.01, stationID = 60000682) =>
  ({ stationID, typeID, quantity, m3PerUnit });

test("the trip goes where the price is higher than at home", () => {
  const answer = plan({
    stacks: [stack(34, 40000000)],
    destination: { systemID: 30000142, stationID: JITA, bids: { 34: { price: 4, volume: 40000000 } } },
    local: { bids: {} },
    capacityM3: 62000,
  });
  assert.equal(answer.status, "TRIP");
  assert.equal(answer.trip.typeID, 34);
  assert.equal(answer.trip.quantity, 6200000, "the hold decides, not the stack size");
  assert.equal(answer.trip.expectedISK, 6200000 * 4);
  assert.equal(answer.trip.remaining, 40000000 - 6200000);
});

test("goods that fetch more at home are never flown away", () => {
  const answer = plan({
    stacks: [stack(444, 500)],
    destination: { systemID: 30000142, stationID: JITA, bids: { 444: { price: 1501, volume: 142 } } },
    local: { bids: { 444: { price: 50000, volume: 500 } } },
    capacityM3: 62000,
  });
  assert.equal(answer.status, "NO_TRIP");
  assert.equal(answer.refusals[0].reason, "DESTINATION_DOES_NOT_PAY_MORE");
});

test("a trip that cannot pay for itself is refused with its exact value", () => {
  const answer = plan({
    stacks: [stack(444, 5)],
    destination: { systemID: 30000142, stationID: JITA, bids: { 444: { price: 1501, volume: 142 } } },
    local: { bids: {} },
    capacityM3: 62000,
    minIsk: 200000,
  });
  assert.equal(answer.status, "NO_TRIP");
  assert.equal(answer.refusals[0].reason, "TRIP_NOT_WORTH_IT");
  assert.equal(answer.refusals[0].expectedISK, 5 * 1501);
});

test("the buyer's remaining volume caps the load", () => {
  const answer = plan({
    stacks: [stack(444, 500)],
    destination: { systemID: 30000142, stationID: JITA, bids: { 444: { price: 1501, volume: 142 } } },
    local: { bids: {} },
    capacityM3: 62000,
  });
  assert.equal(answer.trip.quantity, 142);
  assert.equal(answer.trip.remaining, 358, "the rest stays on the shelf");
});

test("the richest trip wins and the runner-ups are reported", () => {
  const answer = plan({
    stacks: [stack(34, 100000), stack(35, 100000)],
    destination: {
      systemID: 30000142, stationID: JITA,
      bids: { 34: { price: 4, volume: 4000000 }, 35: { price: 15, volume: 3300000 } },
    },
    local: { bids: {} },
    capacityM3: 62000,
  });
  assert.equal(answer.trip.typeID, 35, "Pyerite pays 15 x 3.3M against Tritanium's 4 x 4M");
  assert.equal(answer.trips.length, 2);
  assert.equal(answer.trips[1].typeID, 34);
});

test("an empty or unknown destination is a refusal, not a guess", () => {
  assert.equal(plan({ stacks: [stack(34, 10)], destination: null }).status, "NO_DESTINATION");
  const answer = plan({
    stacks: [stack(34, 10)],
    destination: { systemID: 30000142, stationID: JITA, bids: {} },
    local: { bids: {} },
    capacityM3: 62000,
  });
  assert.equal(answer.status, "NO_TRIP");
  assert.equal(answer.refusals[0].reason, "NO_BUYER_AT_DESTINATION");
});

test("a trip fills the hold with the densest cargo, not one lucky stack", () => {
  // Measured 2026-10-30: an Impel left with 1 unit of 560 000 ISK ammunition and 3 099 m3 of
  // hold empty, while a full hold of 4 ISK ore would have earned more for the same trip.
  const { planBundle } = require("../integration/coopNpcDistribution.cjs");
  const answer = planBundle({
    stacks: [
      { stationID: 60000682, typeID: 28338, quantity: 100, m3PerUnit: 0.13 },
      { stationID: 60000682, typeID: 34, quantity: 498596, m3PerUnit: 0.01 },
    ],
    destination: { systemID: 30000142, stationID: 60003760, bids: {
      28338: { price: 560000, volume: 1 },
      34: { price: 4, volume: 4000000 },
    } },
    local: { stationID: 0, bids: {} },
    capacityM3: 3100,
    minIsk: 200000,
  });
  assert.equal(answer.status, "TRIP");
  const byType = new Map(answer.items.map((row) => [row.typeID, row]));
  assert.equal(byType.get(28338).quantity, 1, "the bid takes exactly one unit of ammunition");
  // 3 100 m3 minus the 0.13 m3 of ammunition, at 0.01 m3 a unit.
  assert.equal(byType.get(34).quantity, 309987, "and the rest of the hold is filled with ore");
  assert.ok(answer.m3 <= 3100, "the hold is never overbooked");
  assert.equal(answer.totalIsk, 560000 + 309987 * 4);
});

test("cargo nobody buys is refused by name, not silently skipped", () => {
  const { planBundle } = require("../integration/coopNpcDistribution.cjs");
  const answer = planBundle({
    stacks: [{ stationID: 60000682, typeID: 999, quantity: 10, m3PerUnit: 1 }],
    destination: { systemID: 30000142, stationID: 60003760, bids: {} },
    capacityM3: 3100,
  });
  assert.equal(answer.status, "NO_TRIP");
  assert.equal(answer.refusals[0].reason, "NO_BUYER_AT_DESTINATION");
});

test("a trip that cannot pay for itself is refused before the hold is filled", () => {
  const { planBundle } = require("../integration/coopNpcDistribution.cjs");
  const answer = planBundle({
    stacks: [{ stationID: 60000682, typeID: 34, quantity: 1000, m3PerUnit: 0.01 }],
    destination: { systemID: 30000142, stationID: 60003760, bids: { 34: { price: 1, volume: 1000 } } },
    capacityM3: 3100,
    minIsk: 200000,
  });
  assert.equal(answer.status, "TRIP_NOT_WORTH_IT");
  assert.equal(answer.items.length, 0);
});
