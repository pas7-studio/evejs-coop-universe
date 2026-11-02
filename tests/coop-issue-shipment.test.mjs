import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// M003-L2 adapter tests. Independent of the module's internals: every fact comes through the
// injected `deps`, exactly the contract published in review/packets/l2-adapter.txt.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {issueShipment, SHIPMENT_CODE} =
  require(path.join(forkRoot, "Code/server/scripts/coop-issue-shipment.js"));

const PERIMETER = 60000358;
const PERIMETER_SYSTEM = 30000144;
const JITA = 60003760;
const JITA_SYSTEM = 30000142;
const HULL = 980000027001;
const HULL_TYPE = 648;          // Badger
const HULL_CAPACITY = 3900;     // m3, from the live type registry
const HULL_OWNER = 1000129;

const GATE = {sourceGateID: 50002185, destinationGateID: 50001249,
  sourceSystemID: PERIMETER_SYSTEM, destinationSystemID: JITA_SYSTEM};
const BID = {price: 3.71, volume: 4000000};

/** A world that answers everything correctly; each test replaces only what it is probing. */
function makeWorld(overrides = {}) {
  const base = {
    hullOf: () => ({entityID: HULL, typeID: HULL_TYPE, ownerID: HULL_OWNER,
      systemID: PERIMETER_SYSTEM}),
    capacityOf: () => HULL_CAPACITY,
    volumeOf: () => 0.01,
    cargoOf: () => [],
    stationOf: (stationID) => ({stationID,
      solarSystemID: stationID === PERIMETER ? PERIMETER_SYSTEM : JITA_SYSTEM}),
    gateBetween: (fromSystemID, toSystemID) =>
      (fromSystemID === PERIMETER_SYSTEM && toSystemID === JITA_SYSTEM ? GATE : null),
    bestBid: () => BID,
    runs: () => [],
    readRun: () => null,
    now: () => 1793627595261,
  };
  return {...base, ...overrides};
}

const ARGS = {hullID: HULL, typeID: 34, quantity: 70000, fromStationID: PERIMETER,
  toStationID: JITA, price: 3.71, corpID: HULL_OWNER};

const refusal = (result, code, note) => {
  assert.equal(result.ok, false, note);
  assert.equal(result.code, code, note);
};

test("a valid shipment is issued in the engine's own run shape", () => {
  const result = issueShipment({...ARGS}, makeWorld());
  assert.equal(result.ok, true);
  assert.equal(result.code, "ISSUED");
  const record = result.record;
  assert.equal(record.version, 1);
  assert.equal(record.haulerID, HULL);
  assert.equal(record.phase, "TO_ORIGIN");
  assert.equal(record.trip.typeID, 34);
  assert.equal(record.trip.stationID, PERIMETER);
  assert.equal(record.trip.toStationID, JITA);
  assert.equal(record.trip.m3, 700);
  assert.equal(record.trip.isk, 259700);
  assert.deepEqual(record.trip.gate, GATE);
  assert.equal(record.trip.fromSystemID, PERIMETER_SYSTEM);
  assert.equal(record.trip.toSystemID, JITA_SYSTEM);
  assert.equal(record.expectedIsk, 259700);
  assert.deepEqual(record.gate, GATE);
  assert.deepEqual(record.stops, [{stationID: PERIMETER, items: [{typeID: 34, quantity: 70000}]}]);
  assert.deepEqual(record.loadedStops, []);
  assert.equal(record.stopIndex, 0);
  assert.equal(record.sellCalls, 0);
  assert.equal(record.isk, 0);
  assert.equal(record.trips, 0);
  assert.equal(record.cycles, 0);
  assert.equal(record.stopWaits, 0);
  assert.equal(record.orderAt, 0);
  assert.equal(record.updatedAt, 1793627595261);
});

test("the demand map is keyed by the type as a string", () => {
  const result = issueShipment({...ARGS}, makeWorld());
  assert.deepEqual(result.record.trip.demand["34"], {price: 3.71, volume: 4000000});
  assert.deepEqual(result.record.trip.items,
    [{stationID: PERIMETER, typeID: 34, quantity: 70000, price: 3.71, m3PerUnit: 0.01,
      m3: 700, isk: 259700}]);
});

test("nothing is written without a writer, and exactly once with one", () => {
  const dry = issueShipment({...ARGS}, makeWorld());
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);

  const calls = [];
  const written = issueShipment({...ARGS}, makeWorld({apply: (record) => {
    calls.push(record);
    return true;
  }}));
  assert.equal(written.ok, true);
  assert.equal(written.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], written.record);
});

test("a refused shipment is never handed to the writer", () => {
  const calls = [];
  const result = issueShipment({...ARGS, quantity: 400000}, makeWorld({apply: (record) => {
    calls.push(record);
    return true;
  }}));
  refusal(result, "OVER_CAPACITY");
  assert.equal(calls.length, 0);
});

test("a hull that is not the corporation's is refused", () => {
  const result = issueShipment({...ARGS},
    makeWorld({hullOf: () => ({entityID: HULL, typeID: HULL_TYPE, ownerID: 140000005,
      systemID: PERIMETER_SYSTEM})}));
  refusal(result, "HULL_NOT_CORP");
});

test("unknown hull, unknown hold and unknown cargo volume are refused", () => {
  refusal(issueShipment({...ARGS}, makeWorld({hullOf: () => null})), "HULL_UNKNOWN");
  refusal(issueShipment({...ARGS}, makeWorld({capacityOf: () => null})), "CAPACITY_UNKNOWN");
  refusal(issueShipment({...ARGS}, makeWorld({volumeOf: () => null})), "CARGO_VOLUME_UNKNOWN");
});

test("cargo that is already aboard counts against the hold", () => {
  // 3,500 m3 aboard + 700 m3 of Tritanium would overfill the 3,900 m3 Badger.
  const loaded = makeWorld({cargoOf: () => [{typeID: 35, quantity: 350000}]});
  refusal(issueShipment({...ARGS}, loaded), "OVER_CAPACITY");
  // The same load on an empty hold is fine.
  assert.equal(issueShipment({...ARGS}, makeWorld()).ok, true);
});

test("an unreadable cargo list fails closed instead of being ignored", () => {
  const result = issueShipment({...ARGS}, makeWorld({cargoOf: () => ({cargo: {}})}));
  refusal(result, "CARGO_UNREADABLE");
});

test("the hull must physically be in the origin system", () => {
  const result = issueShipment({...ARGS},
    makeWorld({hullOf: () => ({entityID: HULL, typeID: HULL_TYPE, ownerID: HULL_OWNER,
      systemID: 30000145})}));
  refusal(result, "HULL_NOT_IN_ORIGIN_SYSTEM");
});

test("no route, no bid and a bid below the asking price are refused", () => {
  refusal(issueShipment({...ARGS}, makeWorld({gateBetween: () => null})), "NO_ROUTE");
  refusal(issueShipment({...ARGS}, makeWorld({bestBid: () => null})), "NO_BID");
  refusal(issueShipment({...ARGS}, makeWorld({bestBid: () => ({price: 3.71, volume: 69999})})),
    "NO_BID");
  refusal(issueShipment({...ARGS}, makeWorld({bestBid: () => ({price: 3.5, volume: 4000000})})),
    "PRICE_TOO_LOW");
});

test("one hull, one run", () => {
  refusal(issueShipment({...ARGS}, makeWorld({readRun: () => ({phase: "TO_ORIGIN"})})),
    "RUN_EXISTS");
  refusal(issueShipment({...ARGS, replace: true},
    makeWorld({readRun: () => ({phase: "TO_ORIGIN"})})), "RUN_ACTIVE");
  const replaced = issueShipment({...ARGS, replace: true},
    makeWorld({readRun: () => ({phase: "BLOCKED"}), apply: () => true}));
  assert.equal(replaced.ok, true);
});

test("an engine refusal is reported, not swallowed", () => {
  refusal(issueShipment({...ARGS}, makeWorld({apply: () => false})), "ENGINE_REFUSED");
});

test("invalid arguments never touch the world", () => {
  let touched = 0;
  const spy = () => {
    touched += 1;
    return null;
  };
  const watched = makeWorld({hullOf: spy, capacityOf: spy, cargoOf: spy, stationOf: spy,
    gateBetween: spy, bestBid: spy, readRun: spy, apply: spy});
  refusal(issueShipment({...ARGS, quantity: 0}, watched), "INVALID_ARGUMENT");
  refusal(issueShipment({...ARGS, price: 0}, watched), "INVALID_ARGUMENT");
  refusal(issueShipment({...ARGS, hullID: undefined}, watched), "INVALID_ARGUMENT");
  refusal(issueShipment({...ARGS, toStationID: PERIMETER}, watched), "INVALID_ARGUMENT");
  assert.equal(touched, 0);
});

test("SHIPMENT_CODE exports every code with the same string value", () => {
  const names = Object.keys(SHIPMENT_CODE);
  assert.ok(names.length >= 15, "expected at least fifteen refusal codes");
  for (const name of names) assert.equal(SHIPMENT_CODE[name], name);
  const result = issueShipment({...ARGS, quantity: 0}, makeWorld());
  assert.equal(result.code, SHIPMENT_CODE.INVALID_ARGUMENT);
});
