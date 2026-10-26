import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { transferCargo } = require("../integration/coopNativeHaulCargo.cjs");
const { adopt, resetForTests } = require("../integration/coopHaulCargoAdoption.cjs");

const ORE = 17464;
const MINER = 9101;
const OLD_HAULER = 9201;
const NEW_HAULER = 9301;
const OWNER = 1000035;
const SYSTEM = 30000145;
const FLEET = 1;
const NOW = 1_790_000_000_000;

const initial = {};
for (const key of [
  "EVEJS_COOP_NATIVE_HAUL_CARGO",
  "EVEJS_COOP_NPC_STATION_DELIVERY",
  "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC",
  "EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD",
  "EVEJS_COOP_HAUL_CARGO_ADOPTION",
]) initial[key] = process.env[key];
test.after(() => {
  for (const [key, value] of Object.entries(initial)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function process_({ haulerID, transientHauler }) {
  const miner = {
    kind: "ship", nativeNpc: true, itemID: MINER, ownerID: OWNER, systemID: SYSTEM,
    transient: true, position: { x: 0, y: 0, z: 0 }, radius: 100,
    nativeCargoItems: [{ itemID: 7001, typeID: ORE, quantity: 9000, volume: 0.1 }],
  };
  const hauler = {
    kind: "ship", nativeNpc: true, itemID: haulerID, ownerID: OWNER, systemID: SYSTEM,
    transient: transientHauler, position: { x: 1200, y: 0, z: 0 }, radius: 100,
    nativeCargoItems: [],
  };
  const ships = [miner, hauler];
  return { miner, hauler, ships };
}

function harness(initialRows) {
  let rows = initialRows ? initialRows.map((row) => ({ ...row })) : [{
    cargoID: 7001, entityID: MINER, ownerID: OWNER, typeID: ORE,
    quantity: 9000, moduleID: 0, categoryID: 25, transient: true,
  }];
  const actions = [];
  const store = {
    getNativeEntity: (id) => (id === MINER || id === OLD_HAULER || id === NEW_HAULER ? { entityID: id } : null),
    listNativeCargo: () => rows.map((row) => ({ ...row })),
    listNativeCargoForEntity: (id) => rows.filter((row) => row.entityID === id).map((row) => ({ ...row })),
    upsertNativeCargo: (row) => {
      actions.push({ name: "upsert", cargoID: row.cargoID });
      rows = rows.map((x) => (x.cargoID === row.cargoID ? { ...row } : x));
      return { success: true };
    },
    buildNativeCargoItems: (id) => rows.filter((row) => row.entityID === id).map((row) => ({ itemID: row.cargoID })),
  };
  const database = {
    setTransientPath: (...values) => actions.push({ name: "transient", values }),
    flushTableSync: () => ({ success: true }),
  };
  const probe = { observe: () => {} };
  const depot = { prepare: () => ({ status: "PREPARED" }), commit: () => ({ status: "COMMITTED" }) };
  const resolveItemByTypeID = (id) =>
    id === ORE ? { typeID: ORE, volume: 0.1, categoryID: 25 }
      : id === NEW_HAULER ? { typeID: 5002, capacity: 250 }
        : { typeID: 5001, capacity: 50 };
  return {
    store, database, probe, depot, resolveItemByTypeID, actions,
    rows: () => rows,
    setRows(next) { rows = next.map((row) => ({ ...row })); },
  };
}

test("a real load persists the haul cargo of a transient hauler for restart recovery", () => {
  resetForTests();
  process.env.EVEJS_COOP_NATIVE_HAUL_CARGO = "1";
  process.env.EVEJS_COOP_NPC_STATION_DELIVERY = "1";
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC = "1";
  delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD;
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";

  const h = harness();
  const p = process_({ haulerID: OLD_HAULER, transientHauler: true });
  const scene = { systemID: SYSTEM, getEntityByID: (id) => p.ships.find((ship) => ship.itemID === id) || null };
  const fleet = { systemID: SYSTEM, fleetID: FLEET, minerEntityIDs: [MINER], haulerEntityIDs: [OLD_HAULER] };

  const moved = transferCargo(scene, fleet, p.miner, {
    store: h.store, database: h.database, probe: h.probe, depot: h.depot,
    resolveItemByTypeID: h.resolveItemByTypeID,
  });
  assert.ok(moved > 0, "the ore must physically move");
  const row = h.rows()[0];
  assert.equal(row.transient, false, "a restart must find this row on disk");
  assert.equal(row.entityID, OLD_HAULER);
  assert.equal(row.coopHaulFleetID, FLEET);
  assert.equal(row.coopHaulSystemID, SYSTEM, "the row must name its solar system");
  assert.ok(row.coopHaulFromMinerID > 0);
});

test("after a restart the new hauler re-adopts the same cargoID and the trip can start", () => {
  resetForTests();
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";
  // Simulate the restart: process A wrote the durable row, process B only sees
  // disk. The old hauler entity no longer exists anywhere.
  const h = harness([{
    cargoID: 7001, entityID: OLD_HAULER, ownerID: OWNER, typeID: ORE, quantity: 9000,
    volume: 0.1, moduleID: 0, transient: false, coopHaulFleetID: FLEET,
    coopHaulFromMinerID: MINER, coopHaulSystemID: SYSTEM, coopHaulLoadedAt: NOW - 60_000,
  }]);
  h.store.getNativeEntity = (id) => (id === NEW_HAULER ? { entityID: NEW_HAULER } : null);

  const p = process_({ haulerID: NEW_HAULER, transientHauler: true });
  const scene = { systemID: SYSTEM, getEntityByID: (id) => p.ships.find((ship) => ship.itemID === id) || null };
  const fleet = { systemID: SYSTEM, fleetID: FLEET, state: "mining", minerEntityIDs: [MINER], haulerEntityIDs: [NEW_HAULER] };

  const result = adopt(scene, fleet, { store: h.store, database: h.database, probe: h.probe, clock: () => NOW });
  assert.equal(result.status, "ADOPTED");
  assert.equal(result.adopted, 1);
  const row = h.store.listNativeCargo()[0];
  assert.equal(row.cargoID, 7001, "the native cargo identity survives the restart");
  assert.equal(row.entityID, NEW_HAULER);
  assert.equal(row.coopHaulFleetID, FLEET);
  assert.equal(row.coopHaulAdoptedAt, NOW);
  assert.equal(fleet.state, "loaded", "the fleet hands over to the normal station->sell pipeline");
  assert.ok(fleet.lastHauledVolumeM3 > 0);
});

test("a slot with a different fleet id never adopts another slot's ore", () => {
  resetForTests();
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";
  const h = harness([{
    cargoID: 7001, entityID: OLD_HAULER, ownerID: OWNER, typeID: ORE, quantity: 9000,
    volume: 0.1, moduleID: 0, transient: false, coopHaulFleetID: 9,
    coopHaulFromMinerID: MINER, coopHaulSystemID: SYSTEM, coopHaulLoadedAt: NOW - 60_000,
  }]);
  h.store.getNativeEntity = (id) => (id === NEW_HAULER ? { entityID: NEW_HAULER } : null);
  const p = process_({ haulerID: NEW_HAULER, transientHauler: true });
  const scene = { systemID: SYSTEM, getEntityByID: (id) => p.ships.find((ship) => ship.itemID === id) || null };
  const fleet = { systemID: SYSTEM, fleetID: FLEET, state: "mining", minerEntityIDs: [MINER], haulerEntityIDs: [NEW_HAULER] };
  const result = adopt(scene, fleet, { store: h.store, database: h.database, probe: h.probe, clock: () => NOW });
  assert.equal(result.status, "NO_ORPHAN_CARGO");
  assert.equal(result.adopted, 0);
  assert.equal(fleet.state, "mining", "a refused adoption must not move the fleet");
});

test("adoption never invents ore: the adopted quantity is the stored quantity", () => {
  resetForTests();
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";
  const h = harness([{
    cargoID: 7001, entityID: OLD_HAULER, ownerID: OWNER, typeID: ORE, quantity: 4321,
    volume: 0.1, moduleID: 0, transient: false, coopHaulFleetID: FLEET,
    coopHaulFromMinerID: MINER, coopHaulSystemID: SYSTEM, coopHaulLoadedAt: NOW - 1000,
  }]);
  h.store.getNativeEntity = (id) => (id === NEW_HAULER ? { entityID: NEW_HAULER } : null);
  const p = process_({ haulerID: NEW_HAULER, transientHauler: true });
  const scene = { systemID: SYSTEM, getEntityByID: (id) => p.ships.find((ship) => ship.itemID === id) || null };
  const fleet = { systemID: SYSTEM, fleetID: FLEET, state: "mining", minerEntityIDs: [MINER], haulerEntityIDs: [NEW_HAULER] };
  const result = adopt(scene, fleet, { store: h.store, database: h.database, probe: h.probe, clock: () => NOW });
  assert.equal(result.status, "ADOPTED");
  assert.equal(result.quantity, 4321);
  assert.equal(h.store.listNativeCargo().length, 1, "no second stack may appear");
});
