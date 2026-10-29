import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The planner must never invent a trip: it needs a station that really holds the stock in the
// hull's own system, a seeded bid in a system one reciprocal gate away, and money in it.
const plan = require("../integration/coopDistributionPlan.cjs");

const HAULER = 980000004164;
const ORIGIN_STATION = 60000682;
const DEST_STATION = 60003760;

function world() {
  return {
    listStations: () => [
      { stationID: ORIGIN_STATION, solarSystemID: 30000145 },
      { stationID: DEST_STATION, solarSystemID: 30000142 },
    ],
    getStationByID: (id) => (Number(id) === DEST_STATION
      ? { stationID: DEST_STATION, solarSystemID: 30000142 } : { stationID: ORIGIN_STATION, solarSystemID: 30000145 }),
    getStargateByID: () => ({ destinationSolarSystemID: 30000142, destinationID: 50002198 }),
  };
}
const store = { getNativeEntity: () => ({ entityID: HAULER, systemID: 30000145, shipTypeID: 12753,
  operatorKind: "coop-distribution-1-hauler" }) };
const inventory = { resolveItemByTypeID: (id) => (Number(id) === 12753
  ? { capacity: 3100, volume: 400000 } : { volume: 0.01 }) };
const items = { listOwnedItems: () => [
  { locationID: ORIGIN_STATION, flagID: 4, typeID: 34, quantity: 498596 },
  { locationID: 60000000, flagID: 4, typeID: 34, quantity: 1000 },
] };
const db = { prepare: () => ({ all: () => [
  { solar_system_id: 30000142, station_id: DEST_STATION, type_id: 34, price: 4, quantity: 4000000 },
  { solar_system_id: 30000142, station_id: DEST_STATION, type_id: 35, price: 15, quantity: 3300000 },
] }) };
const scene = { staticEntities: [{ itemID: 50001250, kind: "stargate" },
  // The scene is the physical truth about where a station really is.
  { itemID: ORIGIN_STATION, kind: "station" }] };
const connectedGates = () => ({ sourceGateID: 50001250, destinationGateID: 50002198 });

test("a real trip is chosen from real stock, a real bid and a real gate", () => {
  const answer = plan.planTrip({ haulerID: HAULER, store, items, inventory, db,
    worldData: world(), scene, connectedGates });
  assert.equal(answer.status, "OK");
  const trip = answer.trip;
  assert.equal(trip.stationID, ORIGIN_STATION, "the stock leaves the station that holds it");
  assert.equal(trip.typeID, 34);
  // 3 100 m3 of hold, Tritanium is 0.01 m3 a unit.
  assert.equal(trip.quantity, 310000);
  assert.equal(trip.toStationID, DEST_STATION);
  assert.equal(trip.toSystemID, 30000142);
  assert.equal(trip.expectedIsk, 310000 * 4);
  assert.deepEqual(trip.gate, { sourceGateID: 50001250, destinationGateID: 50002198,
    sourceSystemID: 30000145, destinationSystemID: 30000142 });
});

test("no gate means no trip, however good the price", () => {
  const answer = plan.planTrip({ haulerID: HAULER, store, items, inventory, db,
    worldData: world(), scene: { staticEntities: [] }, connectedGates });
  assert.equal(answer.status, "NO_GATE_OUT");
});

test("a destination that pays nothing is not a destination", () => {
  const empty = { prepare: () => ({ all: () => [] }) };
  const answer = plan.planTrip({ haulerID: HAULER, store, items, inventory, db: empty,
    worldData: world(), scene, connectedGates });
  assert.equal(answer.status, "NO_BUYER_ONE_GATE_AWAY");
});

test("a hull that is not durable is refused before anything is planned", () => {
  const answer = plan.planTrip({ haulerID: HAULER, store: { getNativeEntity: () => null },
    items, inventory, db, worldData: world(), scene, connectedGates });
  assert.equal(answer.status, "HULL_NOT_DURABLE");
});

test("stock that is not in the hull's system is not this hull's freight", () => {
  const answer = plan.planTrip({ haulerID: HAULER, store, inventory, db,
    items: { listOwnedItems: () => [{ locationID: 60000000, flagID: 4, typeID: 34, quantity: 1000 }] },
    worldData: world(), scene, connectedGates });
  assert.equal(answer.status, "NO_STOCK_IN_SYSTEM");
});
