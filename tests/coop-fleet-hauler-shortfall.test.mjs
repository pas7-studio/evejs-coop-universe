import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// A slot's witness named a hauler; that hauler legitimately left the slot through a journaled
// gate crossing and still exists (in another system, with the same marker). Measured
// 2026-10-29: the recompose computed addCount 0, spawned nothing, then failed its own final
// check with ALIFE08_RECOMPOSE_MARKER_SET_INCOMPLETE and the slot stayed NEEDS_OPERATOR_REPAIR
// for ever, so the fleet mined at half strength.
const durable = require("../integration/coopNativeMiningFleetDurable.cjs");

const SYSTEM = 30000145;
const SLOT = 1;
const MINERS = [980000000030, 980000000031];
const OLD_HAULER = 980000004164;

function memoryDb() {
  const rows = new Map();
  return {
    flushTablesSync: () => ({ success: true }),
    flushTableSync: () => ({ success: true }),
    read: (table, key) => (rows.has(table + key)
      ? { success: true, data: JSON.parse(rows.get(table + key)) }
      : { success: false, errorMsg: "ENTRY_NOT_FOUND" }),
    write: (table, key, value) => {
      rows.set(table + key, JSON.stringify(value));
      return { success: true };
    },
  };
}

function makeStore({ haulersInSlot = [], haulersElsewhere = [] } = {}) {
  const entities = new Map();
  const controllers = new Map();
  const add = (id, marker, systemID, profile) => {
    entities.set(Number(id), { entityID: Number(id), systemID, operatorKind: marker,
      nativeNpc: true, ownerID: 1000129 });
    controllers.set(Number(id), { entityID: Number(id), systemID, profileID: profile,
      operatorKind: marker, startupRuleID: "" });
  };
  for (const id of MINERS) add(id, durable.roleMarker(SYSTEM, SLOT, "miner"), SYSTEM, "ore_mining_retriever");
  for (const id of haulersInSlot) add(id, durable.roleMarker(SYSTEM, SLOT, "hauler"), SYSTEM, "ore_mining_impel_hauler");
  for (const id of haulersElsewhere) add(id, durable.roleMarker(SYSTEM, SLOT, "hauler"), 30000142, "ore_mining_impel_hauler");
  return {
    listNativeEntitiesForSystem: (systemID) => [...entities.values()]
      .filter((row) => Number(row.systemID) === Number(systemID)),
    getNativeEntity: (id) => entities.get(Number(id)) || null,
    getNativeController: (id) => controllers.get(Number(id)) || null,
    upsertNativeEntity: () => ({ success: true }),
    upsertNativeController: () => ({ success: true }),
    listNativeCargoForEntity: () => [],
    listNativeModulesForEntity: () => [],
    _add: add,
    _entities: entities,
  };
}

function run({ store, spawn, haulerIDs = [OLD_HAULER] }) {
  return durable.repairSlotComposition({
    systemID: SYSTEM, slot: SLOT, key: durable.slotKey(SYSTEM, SLOT),
    scene: { systemID: SYSTEM, getEntityByID: () => null }, store,
    db: memoryDb(),
    ensureState: () => ({ success: true }),
    spawn,
    minerIDs: MINERS, haulerIDs,
    log: () => {},
  });
}

test("a hauler that left the slot through a real crossing is replaced, not mourned", () => {
  process.env.EVEJS_COOP_FLEET_COMPOSITION = "1";
  const store = makeStore({ haulersElsewhere: [OLD_HAULER] });
  let spawned = null;
  const result = run({
    store,
    spawn: (slot, wing) => {
      spawned = { slot, wing };
      const id = 980000005000;
      store._add(id, durable.roleMarker(SYSTEM, slot, "hauler"), SYSTEM, "ore_mining_impel_hauler");
      // The pinned wing spawner clamps its miner amount to at least one.
      const miner = 980000005001;
      store._add(miner, durable.roleMarker(SYSTEM, slot, "miner"), SYSTEM, "ore_mining_retriever");
      return { success: true, data: { haulerEntityIDs: [id], minerEntityIDs: [miner] } };
    },
  });
  assert.deepEqual(spawned.wing.haulers, 1, "exactly the missing hauler is requested");
  assert.equal(spawned.wing.miners, 0, "the slot's miners are all present");
  assert.deepEqual(result.haulerEntityIDs, [980000005000]);
  assert.equal(result.haulerEntityIDs.includes(OLD_HAULER), false,
    "the hull that left is not claimed back from another system");
});

test("a whole slot is left alone when nothing is missing", () => {
  process.env.EVEJS_COOP_FLEET_COMPOSITION = "1";
  const store = makeStore({ haulersInSlot: [980000005500] });
  let called = false;
  const result = run({ store, haulerIDs: [980000005500],
    spawn: () => { called = true; return { success: true, data: {} }; } });
  assert.equal(result, null, "no repair is invented for a healthy slot");
  assert.equal(called, false, "and nothing is spawned");
});
