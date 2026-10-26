import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { transferCargo } = require("../integration/coopNativeHaulCargo.cjs");

// The normal (non-strict) transfer is the one the live co-op world runs. It
// used to accept a durable row that merely *had* the original cargoID, even if
// the write had moved it to the wrong ship, changed its quantity or left the
// transient marker on it, and then removed the ore from the miner: the ore
// silently disappeared. Both paths now share verifyLoad(), so these cases must
// leave the miner holding its cargo and report a status.
const flags = [
  "EVEJS_COOP_NATIVE_HAUL_CARGO",
  "EVEJS_COOP_NPC_STATION_DELIVERY",
  "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC",
  "EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD",
];
const initial = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
test.after(() => {
  for (const key of flags) {
    if (initial[key] === undefined) delete process.env[key];
    else process.env[key] = initial[key];
  }
});

const ORE = 34;

function fixture(corrupt = null) {
  for (const key of flags.slice(0, 3)) process.env[key] = "1";
  delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD;
  const miner = {
    kind: "ship", nativeNpc: true, itemID: 91, ownerID: 1000035, systemID: 30000144,
    typeID: 5001, transient: false, position: { x: 0, y: 0, z: 0 }, radius: 100,
    nativeCargoItems: [{ itemID: 1009, typeID: ORE, quantity: 13, volume: 0.1 }],
  };
  const hauler = {
    kind: "ship", nativeNpc: true, itemID: 92, ownerID: 1000035, systemID: 30000144,
    typeID: 5002, transient: false, position: { x: 1250, y: 0, z: 0 }, radius: 100,
    nativeCargoItems: [],
  };
  const original = new Map([
    [91, { entityID: 91, ownerID: 1000035, systemID: 30000144, transient: false }],
    [92, { entityID: 92, ownerID: 1000035, systemID: 30000144, transient: false }],
  ]);
  let rows = [{ cargoID: 1009, entityID: 91, ownerID: 1000035, typeID: ORE, quantity: 13, moduleID: 0, categoryID: 25, transient: false }];
  const events = [];
  const store = {
    getNativeEntity: (id) => original.get(id) || null,
    listNativeCargo: () => rows.map((row) => ({ ...row })),
    listNativeCargoForEntity: (id) => rows.filter((row) => row.entityID === id).map((row) => ({ ...row })),
    upsertNativeCargo: (row) => {
      const written = { ...row };
      if (corrupt) corrupt(written, (next) => { rows = next; });
      rows = rows.map((x) => (x.cargoID === row.cargoID ? written : x));
      return { success: true };
    },
    buildNativeCargoItems: (id) => rows.filter((x) => x.entityID === id)
      .map((x) => ({ itemID: x.cargoID, typeID: x.typeID, quantity: x.quantity })),
  };
  const database = { setTransientPath: () => {}, flushTableSync: () => ({ success: true }) };
  const scene = { systemID: 30000144, getEntityByID: (id) => [miner, hauler].find((ship) => ship.itemID === id) || null };
  const fleet = { systemID: 30000144, fleetID: 77, minerEntityIDs: [91], haulerEntityIDs: [92] };
  // coopObserve.observe(probe, event, context, payload) forwards exactly the
  // probe's own four-argument shape: (event, item, spaceState, payload).
  const probe = { observe: (event, _item, _space, payload) => events.push({ event, payload }) };
  const options = {
    store, database, probe,
    depot: { prepare: () => ({ status: "PREPARED" }), commit: () => ({ status: "COMMITTED" }) },
    resolveItemByTypeID: (id) => ({
      34: { typeID: 34, volume: 0.1, categoryID: 25 },
      5002: { typeID: 5002, capacity: 250 },
      5001: { typeID: 5001, capacity: 50 },
    })[id] || null,
  };
  return {
    miner, hauler, rows: () => rows, events,
    run: () => transferCargo(scene, fleet, miner, options),
  };
}

function statuses(f) {
  return f.events.filter((e) => e.event === "living-hauler-cargo-persist-failed")
    .map((e) => e.payload && e.payload.status);
}

test("a load the store wrote onto the wrong ship stays on the miner", () => {
  const f = fixture((row) => { row.entityID = 999; });
  assert.equal(f.run(), 0);
  assert.deepEqual(statuses(f), ["CARGO_ON_WRONG_ENTITY"]);
  assert.deepEqual(f.miner.nativeCargoItems.map((x) => x.itemID), [1009], "the ore must not be removed from the miner");
  assert.equal(f.events.some((e) => e.event === "living-hauler-loaded"), false);
});

test("a load with a changed quantity is not reported as durable", () => {
  const f = fixture((row) => { row.quantity = 12; });
  assert.equal(f.run(), 0);
  assert.deepEqual(statuses(f), ["CARGO_QUANTITY_CHANGED"]);
  assert.deepEqual(f.miner.nativeCargoItems.map((x) => x.itemID), [1009]);
});

test("a row that stayed transient cannot be called restart-safe", () => {
  const f = fixture((row) => { row.transient = true; });
  assert.equal(f.run(), 0);
  assert.deepEqual(statuses(f), ["CARGO_STILL_TRANSIENT"]);
  assert.deepEqual(f.miner.nativeCargoItems.map((x) => x.itemID), [1009]);
});

test("a duplicated cargo row is rejected instead of picking one", () => {
  const f = fixture((row, replace) => {
    replace([{ ...row, cargoID: 1009, entityID: 91 }, { ...row, cargoID: 1009, entityID: 92 }]);
  });
  assert.equal(f.run(), 0);
  assert.deepEqual(statuses(f), ["CARGO_ROW_MISSING_OR_DUPLICATED"]);
  assert.deepEqual(f.miner.nativeCargoItems.map((x) => x.itemID), [1009]);
});
