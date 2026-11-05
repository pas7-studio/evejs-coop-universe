import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// L7-A. Independently written cases (seven), with a fake world: no database driver, no clock, no
// network. The production change under test aggregates `trip.demand` per type instead of letting the
// last stack replace the earlier ones.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {planTrip} = require(path.join(forkRoot, "Code/server/src/space/coopDistributionPlan.js"));

const ORIGIN_SYSTEM = 30000145;
const DEST_SYSTEM = 30000142;
const ORIGIN_STATION = 60000682;
const DEST_STATION = 60003760;
const STARGATE = 50002198;
const DEST_GATE = 50001250;
const CORP_ID = 1000129;
const HULL = 980000093319;
const HULL_TYPE = 12753;
const TRIT = 34;
const PYERITE = 35;

/** The only sqlite surface `planTrip` uses: one prepared SELECT over seed_buy_orders. */
function makeDb(rows) {
  return {
    prepare(sql) {
      if (!/seed_buy_orders/.test(sql)) throw new Error("unexpected query: " + sql);
      return {
        all(...systemIDs) {
          const wanted = systemIDs.map(Number);
          return rows
            .filter((row) => wanted.includes(Number(row.solar_system_id)) && Number(row.quantity) > 0)
            .map((row) => ({...row}));
        },
      };
    },
    close() {},
  };
}

function makeWorldData() {
  return {
    getStationByID: (id) => {
      if (Number(id) === ORIGIN_STATION) return {stationID: ORIGIN_STATION, solarSystemID: ORIGIN_SYSTEM};
      if (Number(id) === DEST_STATION) return {stationID: DEST_STATION, solarSystemID: DEST_SYSTEM};
      return undefined;
    },
    getStargateByID: (id) => (Number(id) === STARGATE
      ? {itemID: STARGATE, destinationID: DEST_GATE, destinationSolarSystemID: DEST_SYSTEM}
      : undefined),
    listStations: () => [],
  };
}

const SCENE = {
  staticEntities: [
    {kind: "station", itemID: ORIGIN_STATION},
    {kind: "station", itemID: DEST_STATION},
    {kind: "stargate", itemID: STARGATE},
  ],
};

const STORE = {
  getNativeEntity: (id) => (Number(id) === HULL
    ? {entityID: HULL, typeID: HULL_TYPE, systemID: ORIGIN_SYSTEM, ownerID: CORP_ID}
    : undefined),
  listNativeCargoForEntity: () => [],
};

const GATES = ({targetSystemID}) => (Number(targetSystemID) === DEST_SYSTEM
  ? {sourceGateID: STARGATE, destinationGateID: DEST_GATE,
      sourceSystemID: ORIGIN_SYSTEM, destinationSystemID: DEST_SYSTEM}
  : null);

/**
 * One trip, from a hangar and a book. `capacityM3` is the hull's hold; a cargo unit is 0.01 m3, so
 * capacityM3 150 admits 15,000 units.
 */
function runTrip({stacks, bids, capacityM3 = 3100, reserve = () => ({})}) {
  const hangar = stacks.map((stack, index) => ({
    itemID: 9988400200000 + index, typeID: stack.typeID, ownerID: CORP_ID,
    locationID: ORIGIN_STATION, flagID: 4, quantity: stack.quantity,
  }));
  const inventory = {
    resolveItemByTypeID: (typeID) => (Number(typeID) === HULL_TYPE
      ? {typeID: HULL_TYPE, capacity: capacityM3, volume: 400000}
      : {typeID: Number(typeID), capacity: 0, volume: 0.01}),
  };
  const result = planTrip({
    haulerID: HULL, store: STORE, items: {listOwnedItems: () => hangar}, inventory,
    db: makeDb(bids.map((bid) => ({solar_system_id: DEST_SYSTEM, station_id: DEST_STATION,
      type_id: bid.typeID, price: bid.price, quantity: bid.quantity}))),
    worldData: makeWorldData(), connectedGates: GATES, scene: SCENE,
    corpID: CORP_ID, reserve, minIsk: 0,
  });
  assert.equal(result.status, "OK", JSON.stringify(result.status));
  return result.trip;
}

const threeStacks = () => [
  {typeID: TRIT, quantity: 10000}, {typeID: TRIT, quantity: 10000}, {typeID: TRIT, quantity: 10000},
];
const tritBid = (quantity = 100000, price = 3.71) => [{typeID: TRIT, price, quantity}];

test("three stacks of one type aggregate", () => {
  const trip = runTrip({stacks: threeStacks(), bids: tritBid()});
  assert.equal(trip.demand[TRIT].volume, 30000);
  assert.equal(trip.items.filter((row) => Number(row.typeID) === TRIT).length, 3);
});

test("two types stay separate", () => {
  const trip = runTrip({
    stacks: [{typeID: TRIT, quantity: 10000}, {typeID: PYERITE, quantity: 5000}],
    bids: [{typeID: TRIT, price: 3.71, quantity: 100000},
      {typeID: PYERITE, price: 15.13, quantity: 100000}],
  });
  assert.equal(trip.demand[TRIT].volume, 10000);
  assert.equal(trip.demand[PYERITE].volume, 5000);
  assert.equal(trip.demand[TRIT].price, 3.71);
  assert.equal(trip.demand[PYERITE].price, 15.13);
});

test("the buyer's remaining volume still bounds the load", () => {
  const trip = runTrip({stacks: threeStacks(), bids: tritBid(25000)});
  assert.equal(trip.demand[TRIT].volume, 25000);
  const carried = trip.items.filter((row) => Number(row.typeID) === TRIT)
    .reduce((sum, row) => sum + Number(row.quantity), 0);
  // The PLAN may offer more than the buyer takes; the DEMAND (what the loader is allowed to put
  // aboard) is what must be bounded by the book.
  assert.ok(carried >= trip.demand[TRIT].volume, "the plan cannot carry less than the demand");
  assert.equal(trip.demand[TRIT].volume, Math.min(carried, 25000));
  assert.ok(trip.demand[TRIT].volume <= 25000, "the demand must never exceed the buyer's volume");
});

test("the hold still bounds the load", () => {
  const trip = runTrip({stacks: threeStacks(), bids: tritBid(), capacityM3: 150});
  assert.equal(trip.demand[TRIT].volume, 15000);
});

test("no inflation: demand equals the rows it is built from, and never exceeds the hangar", () => {
  const trip = runTrip({
    stacks: threeStacks().concat([{typeID: PYERITE, quantity: 5000}]),
    bids: [{typeID: TRIT, price: 3.71, quantity: 100000},
      {typeID: PYERITE, price: 15.13, quantity: 100000}],
  });
  const byType = new Map();
  for (const row of trip.items) {
    const typeID = Number(row.typeID);
    byType.set(typeID, (byType.get(typeID) || 0) + Number(row.quantity));
  }
  for (const [typeID, units] of byType) {
    assert.equal(trip.demand[typeID].volume, units, "demand[" + typeID + "] must equal its rows");
    assert.ok(units <= 30000, "demand[" + typeID + "] must not exceed the hangar");
  }
});

test("price is the highest quoted, never averaged", () => {
  const trip = runTrip({
    stacks: [{typeID: TRIT, quantity: 10000}, {typeID: TRIT, quantity: 10000}],
    bids: [{typeID: TRIT, price: 3.70, quantity: 100000},
      {typeID: TRIT, price: 3.90, quantity: 100000}],
  });
  assert.equal(trip.demand[TRIT].price, 3.90);
});

test("reserved factory stock is not shipped", () => {
  const trip = runTrip({stacks: threeStacks(), bids: tritBid(), reserve: () => ({[TRIT]: 20000})});
  assert.equal(trip.demand[TRIT].volume, 10000);
});
