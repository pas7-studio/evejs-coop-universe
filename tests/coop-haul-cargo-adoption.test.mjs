import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { adopt, plan, resetForTests } = require("../integration/coopHaulCargoAdoption.cjs");

const NOW = 1_700_000_000_000;

function fakeStore(rows, { entities = [], flushFails = false } = {}) {
  const table = new Map(rows.map((row) => [row.cargoID, { ...row }]));
  const writes = [];
  const events = [];
  return {
    writes,
    events,
    listNativeCargo: () => [...table.values()].map((row) => ({ ...row })),
    listNativeCargoForEntity: (id) => [...table.values()].filter((r) => r.entityID === id),
    upsertNativeCargo: (row) => {
      writes.push({ ...row });
      table.set(row.cargoID, { ...row });
      return { success: true };
    },
    buildNativeCargoItems: (id) => [...table.values()].filter((r) => r.entityID === id),
    getNativeEntity: (id) => entities.find((e) => e.itemID === id) || null,
  };
}

function sceneWith(ships) {
  return {
    systemID: 30000145,
    getEntityByID: (id) => ships.find((s) => s.itemID === id) || null,
  };
}

const hauler = { itemID: 900000000501, ownerID: 5001, kind: "ship" };
const miner = { itemID: 900000000400, ownerID: 5001, kind: "ship" };

function orphan(over = {}) {
  return {
    cargoID: 7001,
    entityID: 900000000111,
    ownerID: 5001,
    typeID: 17464,
    quantity: 9000,
    volume: 0.1,
    moduleID: 0,
    transient: false,
    coopHaulFleetID: 1,
    coopHaulFromMinerID: miner.itemID,
    coopHaulSystemID: 30000145,
    coopHaulLoadedAt: NOW - 60_000,
    ...over,
  };
}

function fleet(over = {}) {
  return {
    fleetID: 1,
    systemID: 30000145,
    state: "mining",
    haulerEntityIDs: [hauler.itemID],
    minerEntityIDs: [miner.itemID],
    ...over,
  };
}

test.beforeEach(() => {
  resetForTests();
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";
});

test("stays disabled unless the adoption flag is on", () => {
  delete process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION;
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler, miner]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "DISABLED");
  assert.equal(store.writes.length, 0);
});

test("re-points a provably orphaned durable cargo row onto the live hauler", () => {
  const store = fakeStore([orphan()]);
  const target = fleet();
  const result = adopt(sceneWith([hauler, miner]), target, {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
  });
  assert.equal(result.status, "ADOPTED");
  assert.equal(result.adopted, 1);
  assert.equal(result.volumeM3, 900);
  const row = store.listNativeCargo()[0];
  assert.equal(row.cargoID, 7001, "the original native cargoID is preserved");
  assert.equal(row.entityID, hauler.itemID);
  assert.equal(row.ownerID, hauler.ownerID);
  assert.equal(row.coopHaulFleetID, 1);
  assert.equal(row.coopHaulSystemID, 30000145);
  assert.equal(row.coopHaulAdoptedAt, NOW);
  assert.equal(row.coopHaulAdoptedFrom, 900000000111);
  assert.equal(target.state, "loaded", "the normal loaded->station->sell pipeline takes over");
  assert.equal(target.lastHauledVolumeM3, 900);
  assert.deepEqual(target.haulerEntityIDs, [hauler.itemID]);
});

test("never adopts cargo whose original hauler still exists in the registry", () => {
  const store = fakeStore([orphan({ entityID: 900000000222 })], {
    entities: [{ itemID: 900000000222 }],
  });
  const result = adopt(sceneWith([hauler]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "NO_ORPHAN_CARGO");
  assert.equal(store.writes.length, 0);
});

test("never adopts cargo from another system or another fleet slot", () => {
  const store = fakeStore([
    orphan({ cargoID: 7002, coopHaulSystemID: 30000144 }),
    orphan({ cargoID: 7003, coopHaulFleetID: 2 }),
    orphan({ cargoID: 7004, coopHaulSystemID: undefined }),
  ]);
  const planned = plan({
    store,
    scene: sceneWith([hauler]),
    systemID: 30000145,
    fleetID: 1,
    now: NOW,
  });
  assert.equal(planned.status, "NO_ORPHAN_CARGO");
  assert.equal(planned.rows.length, 0);
});

test("adopts exactly once per fleet slot", () => {
  const store = fakeStore([orphan()]);
  const database = { flushTableSync: () => ({ success: true }) };
  const scene = sceneWith([hauler]);
  const first = adopt(scene, fleet(), { store, clock: () => NOW, database });
  assert.equal(first.status, "ADOPTED");
  const second = adopt(scene, fleet({ state: "mining" }), { store, clock: () => NOW + 5000, database });
  assert.equal(second.status, "ALREADY_ATTEMPTED");
  assert.equal(store.writes.length, 1);
});

test("refuses a fleet that is already on a trip", () => {
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler]), fleet({ state: "hauling" }), { store, clock: () => NOW });
  assert.equal(result.status, "FLEET_NOT_IDLE");
  assert.equal(store.writes.length, 0);
});

test("never stacks a second batch on a hauler that already carries durable haul cargo", () => {
  const store = fakeStore([
    orphan(),
    orphan({ cargoID: 7099, entityID: hauler.itemID, coopHaulAdoptedAt: NOW - 1000 }),
  ]);
  const result = adopt(sceneWith([hauler]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "HAULER_ALREADY_LOADED");
  assert.equal(store.writes.length, 0);
});

test("rolls back and reports when the durable flush fails", () => {
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler]), fleet(), {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: false }) },
  });
  assert.equal(result.status, "CARGO_FLUSH_FAILED");
  assert.equal(result.adopted, 0);
  assert.equal(store.listNativeCargo()[0].entityID, 900000000111);
});

test("expired orphans are archived by policy, never credited", () => {
  const store = fakeStore([orphan({ coopHaulLoadedAt: NOW - 4 * 60 * 60 * 1000 })]);
  const result = adopt(sceneWith([hauler]), fleet(), {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
  });
  assert.equal(result.status, "NO_ORPHAN_CARGO");
  assert.equal(store.writes.length, 0);
});

test("falls back to the gameStore cargo table when the store cannot enumerate", () => {
  const store = fakeStore([]);
  delete store.listNativeCargo;
  const row = orphan();
  const result = adopt(sceneWith([hauler]), fleet(), {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
    cargoTable: () => ({ [row.cargoID]: row }),
  });
  assert.equal(result.status, "ADOPTED");
  assert.equal(store.listNativeCargoForEntity(hauler.itemID).length, 1);
});

test("requires exactly one live hauler for the slot", () => {
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler]), fleet({ haulerEntityIDs: [hauler.itemID, 123] }), {
    store,
    clock: () => NOW,
  });
  assert.equal(result.status, "HAULER_NOT_UNIQUE");
  assert.equal(store.writes.length, 0);
});
