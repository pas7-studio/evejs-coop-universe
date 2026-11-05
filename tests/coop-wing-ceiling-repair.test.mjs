import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Measured live 2026-11-01: slot 30000144-1 declared 22 miners + 10 haulers = exactly
// MAX_WING (32). Two haulers vanished, so the repair asked for 0 miners and 2 haulers,
// but the native wing spawner always creates at least one miner (miningNpcOperations:
// amount = Math.max(1, ...)). The merged wing therefore reached 33 and the repair threw
// ALIFE08_REPAIR_WING_TOO_LARGE on every boot - the slot stayed NEEDS_OPERATOR_REPAIR for
// ever and its ore never reached a station. The ceiling is the invariant, not the
// mandatory extra hull.
const durable = require("../integration/coopNativeMiningFleetDurable.cjs");

const SYSTEM = 30000144;
const SLOT = 1;
const MAX_WING = 32;

function ids(base, count) {
  return Array.from({ length: count }, (_, i) => base + i);
}

function memoryDb(seed) {
  const rows = new Map();
  if (seed) rows.set("npcEntities" + "/coopMiningFleetSlots/" + seed.key, JSON.stringify(seed.record));
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

function makeStore() {
  const entities = new Map();
  const controllers = new Map();
  const add = (id, marker, systemID) => {
    entities.set(Number(id), { entityID: Number(id), systemID, operatorKind: marker,
      nativeNpc: true, ownerID: 1000129 });
    controllers.set(Number(id), { entityID: Number(id), systemID });
  };
  return {
    listNativeEntitiesForSystem: (systemID) => [...entities.values()]
      .filter((row) => Number(row.systemID) === Number(systemID)),
    getNativeEntity: (id) => entities.get(Number(id)) || null,
    getNativeController: (id) => controllers.get(Number(id)) || null,
    upsertNativeEntity: () => ({ success: true }),
    upsertNativeController: () => ({ success: true }),
    listNativeCargoForEntity: () => [],
    listNativeModulesForEntity: () => [],
    listNativeEntities: () => [...entities.values()],
    removeNativeEntityCascade: (id) => {
      entities.delete(Number(id));
      controllers.delete(Number(id));
      return { success: true };
    },
    _add: add,
    _entities: entities,
  };
}

// A native spawner that behaves like the real one: it never returns zero miners.
function nativeSpawn(store, nextID) {
  let cursor = nextID;
  return (_slot, { miners, haulers }) => {
    const minerEntityIDs = [];
    const haulerEntityIDs = [];
    const minerCount = Math.max(1, miners);
    for (let i = 0; i < minerCount; i += 1) {
      const id = cursor++;
      store._add(id, durable.roleMarker(SYSTEM, SLOT, "miner"), SYSTEM);
      minerEntityIDs.push(id);
    }
    for (let i = 0; i < haulers; i += 1) {
      const id = cursor++;
      store._add(id, durable.roleMarker(SYSTEM, SLOT, "hauler"), SYSTEM);
      haulerEntityIDs.push(id);
    }
    return { success: true, data: { minerEntityIDs, haulerEntityIDs } };
  };
}

function build({ minerCount, haulerCount, missingHaulers = [], missingMiners = [] }) {
  const minerIDs = ids(980000100000, minerCount);
  const haulerIDs = ids(980000200000, haulerCount);
  const store = makeStore();
  for (const id of minerIDs) {
    if (missingMiners.includes(id)) continue;
    store._add(id, durable.roleMarker(SYSTEM, SLOT, "miner"), SYSTEM);
  }
  for (const id of haulerIDs) {
    if (missingHaulers.includes(id)) continue;
    store._add(id, durable.roleMarker(SYSTEM, SLOT, "hauler"), SYSTEM);
  }
  const key = durable.slotKey(SYSTEM, SLOT);
  const db = memoryDb({
    key,
    record: { version: 1, status: "ACTIVE", systemID: SYSTEM, slot: SLOT,
      fleetID: durable.fleetIDForSlot(SYSTEM, SLOT),
      minerEntityIDs: minerIDs, haulerEntityIDs: haulerIDs },
  });
  return { store, db, key, minerIDs, haulerIDs, missingHaulers, missingMiners };
}

function repair(ctx, spawn) {
  return durable.repairPartialSlot({
    scene: { systemID: SYSTEM, getEntityByID: () => null },
    store: ctx.store,
    systemID: SYSTEM,
    slot: SLOT,
    key: ctx.key,
    db: ctx.db,
    spawn,
    ensureState: () => ({ success: true }),
    minerIDs: ctx.minerIDs,
    haulerIDs: ctx.haulerIDs,
    destroy: (id) => ctx.store.removeNativeEntityCascade(id),
    log: () => {},
  });
}

test("a wing already at MAX_WING repairs a lost hauler instead of blocking for ever", () => {
  process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE = "1";
  const ctx = build({ minerCount: 22, haulerCount: 10, missingHaulers: [980000200004, 980000200007] });
  const spawn = nativeSpawn(ctx.store, 980000900000);
  const merged = repair(ctx, spawn);
  assert.ok(merged, "the slot was not repaired at all");
  assert.equal(merged.minerEntityIDs.length, 22, "the wing gained a miner past the ceiling");
  assert.equal(merged.haulerEntityIDs.length, 10, "the lost haulers were not replaced");
  const total = merged.minerEntityIDs.length + merged.haulerEntityIDs.length;
  assert.equal(total, MAX_WING, "the repaired wing is " + total + ", not the ceiling");
  // a restored hull is a NEW native ship: the old IDs are gone, the count and role are what
  // the witness guarantees (asserting the old IDs would demand a resurrection, not a repair)
  for (const id of [980000200004, 980000200007]) {
    assert.ok(!merged.haulerEntityIDs.includes(id), "a dead hull id came back: " + id);
  }
  const survivors = ctx.haulerIDs.filter((id) => !ctx.missingHaulers.includes(id));
  assert.equal(survivors.length, 8);
  assert.ok(survivors.every((id) => merged.haulerEntityIDs.includes(id)),
    "a surviving hauler was dropped by the repair");
  assert.equal(merged.haulerEntityIDs.filter((id) => !survivors.includes(id)).length, 2,
    "the two lost haulers were not replaced");
});

test("the surplus hull the spawner insists on creating is pruned, not added to the witness", () => {
  process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE = "1";
  const ctx = build({ minerCount: 22, haulerCount: 10, missingHaulers: [980000200001] });
  const spawn = nativeSpawn(ctx.store, 980000900000);
  const merged = repair(ctx, spawn);
  const witness = new Set([...merged.minerEntityIDs, ...merged.haulerEntityIDs].map(Number));
  const marked = ctx.store.listNativeEntitiesForSystem(SYSTEM)
    .filter((row) => String(row.operatorKind || "").includes(":" + SYSTEM + ":" + SLOT + ":"));
  const stray = marked.filter((row) => !witness.has(Number(row.entityID)));
  assert.equal(stray.length, 0, "a hull marked to this slot is outside its witness: "
    + stray.map((row) => row.entityID).join(","));
});

test("a wing whose required hulls cannot fit refuses with the numbers in the reason", () => {
  process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE = "1";
  // A witness written by the older, buggy repair can declare more hulls than the ceiling
  // (24 + 10 here). With 2 haulers gone the required set needs 24 + 2 hulls plus the
  // spawner's mandatory miner in a wing that only has room for 32, so the repair must
  // refuse and say exactly why instead of silently delivering a smaller wing.
  const ctx = build({
    minerCount: 24,
    haulerCount: 10,
    missingHaulers: [980000200001, 980000200002],
  });
  const spawn = nativeSpawn(ctx.store, 980000900000);
  assert.throws(() => repair(ctx, spawn), (error) => {
    assert.match(String(error.message), /ALIFE08_REPAIR_WING_TOO_LARGE:alive=24m\/8h/);
    assert.match(String(error.message), /max=32/);
    return true;
  });
});
