import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const isolate = require("../integration/coopNativeCargoTransientIsolation.cjs");
const {createSqliteAdapter, createGameStoreAdapter} = require("../integration/coopGameStoreAtomic.cjs");

// ALIFE-07 commits a mining cycle as rock source + miner cargo stack + its own
// journal row in ONE native transaction, so it is the second cargo-bearing
// transaction that has to coexist with transient (stock NPC) cargo in the single
// original npcCargo table. The isolation contract is what makes that legal; these
// tests pin the contract and every way it must fail closed.
const SEP = "\u001f";
const systemID = 30000144;
const rockID = 5020484726789;
const shipID = 980000016144;
const ownerID = 1;
const oreTypeID = 1230;
const cargoID = 980200000009;
const transientID = 980200000010;
const rockKey = "systems" + SEP + systemID;
const opKey = [systemID, rockID, shipID, 77, 1793031234567].join(":");
const copy = (value) => JSON.parse(JSON.stringify(value));
const journal = (overrides = {}) => ({
  version: 1, status: "COMMITTED", op: "op-key", fingerprint: "fp-1",
  cargoID, nextCargo: 47, quantity: 10, ...overrides,
});
const rock = {entityID: rockID, yieldTypeID: oreTypeID, remainingQuantity: 1000, updatedAtMs: 1};

function fixture(t){
  const flags = ["EVEJS_COOP_NATIVE_ATOMIC_ROWS", "EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION",
    "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC", "EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC"];
  const previous = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
  flags.forEach((key) => { process.env[key] = "1"; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-alife07-mixed-"));
  const db = new DatabaseSync(path.join(dir, "gamestore.sqlite"));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "npcCargo" (key TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE "miningRuntimeState" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const put = (table, key, value) => db.prepare('INSERT INTO "' + table + '"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key, JSON.stringify(value));
  const load = (table) => Object.fromEntries(db.prepare('SELECT key,json FROM "' + table + '"').all().map((row) => [row.key, JSON.parse(row.json)]));
  put("npcCargo", "cargo", {
    [cargoID]: {cargoID, entityID: shipID, ownerID, typeID: oreTypeID, categoryID: 25, quantity: 37, moduleID: 0, transient: false},
  });
  put("miningRuntimeState", rockKey, {entities: {[String(rockID)]: rock}});
  const cache = {npcCargo: load("npcCargo"), miningRuntimeState: load("miningRuntimeState")};
  cache.npcCargo.cargo[transientID] = {cargoID: transientID, entityID: 980000000401, ownerID, typeID: 34, quantity: 2, moduleID: 0, transient: true};
  const transientPaths = {npcCargo: new Set(["/cargo/" + transientID])};
  const dirty = new Set(), fullDirty = new Set(), dirtyRowKeys = {}, flushTimers = {}, inFlightFlushes = new Map();
  let fatalCalls = 0;
  const store = {
    coopAtomicNativeRows: createSqliteAdapter(() => db),
    loadTableObject: (table) => load(table),
  };
  const bridge = createGameStoreAdapter({
    sqliteStore: store,
    ensureSqliteReady: () => {},
    ensureCached: (table) => Boolean(cache[table]),
    flushTableSync: (table) => { dirty.delete(table); delete flushTimers[table]; return {success: true}; },
    cache, dirty, flushTimers, inFlightFlushes, transientPaths, dirtyRowKeys, fullDirty,
    rebuildFlushBaselineFromDisk: () => {},
    invalidateNativeItems: () => true,
    fatal: () => fatalCalls++,
  });
  t.after(() => {
    db.close();
    fs.rmSync(dir, {recursive: true, force: true});
    for (const [key, value] of Object.entries(previous)){
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  // The exact write set the ALIFE-07 settler produces for one mining cycle.
  const cycle = (mutate) => bridge.transact(["miningRuntimeState", "npcCargo"], (tx) => {
    const source = tx.get("miningRuntimeState", rockKey);
    const cargo = tx.get("npcCargo", "cargo");
    const next = journal();
    const result = mutate ? mutate({tx, cargo, next}) : 10;
    const quantity = typeof result === "object" && result !== null ? Number(result.quantity) : Number(result);
    const overrides = typeof result === "object" && result !== null ? (result.journal || {}) : {};
    const ore = cargo[String(cargoID)];
    const row = {...ore, quantity: Number(ore.quantity) + quantity};
    tx.put("miningRuntimeState", rockKey, {
      ...source,
      entities: {...source.entities, [String(rockID)]: {...rock, remainingQuantity: rock.remainingQuantity - quantity}},
    });
    if (quantity > 0) tx.put("npcCargo", "cargo", {...cargo, [String(cargoID)]: row});
    tx.put("miningRuntimeState", opKey, {...next, nextCargo: Number(row.quantity), quantity, ...overrides});
    return true;
  });
  return {db, cache, transientPaths, bridge, cycle, load, put, fatal: () => fatalCalls,
    disk: () => load("npcCargo").cargo, transient: () => cache.npcCargo.cargo[String(transientID)]};
}

test("only declared table sets get a cargo contract", () => {
  assert.equal(isolate.contractForTables(["npcCargo"]).name, "haul-transfer");
  assert.equal(isolate.contractForTables(["npcCargo", "miningRuntimeState"]).name, "mining-cycle");
  assert.equal(isolate.contractForTables(["miningRuntimeState", "npcCargo"]).name, "mining-cycle");
  assert.equal(isolate.contractForTables(["npcCargo", "npcEntities"]), null);
  assert.equal(isolate.contractForTables(["npcCargo", "npcCargo"]), null);
  assert.equal(isolate.contractForTables([]), null);
});

test("a mining cycle commits its rock, cargo and journal while transient cargo stays in cache", (t) => {
  const f = fixture(t);
  const ghost = copy(f.transient());
  f.cycle();
  assert.equal(f.disk()[String(cargoID)].quantity, 47);
  assert.equal(f.disk()[String(transientID)], undefined, "transient stock cargo must never reach SQLite");
  assert.deepEqual(f.transient(), ghost);
  assert.equal(f.load("miningRuntimeState")[rockKey].entities[String(rockID)].remainingQuantity, 990);
  assert.equal(f.load("miningRuntimeState")[opKey].status, "COMMITTED");
  assert.equal(f.load("miningRuntimeState")[opKey].nextCargo, 47);
  assert.equal(f.transientPaths.npcCargo.size, 1);
});

test("a cycle without its journal row is refused before anything is written", (t) => {
  const f = fixture(t);
  const before = copy(f.disk());
  assert.throws(() => f.bridge.transact(["miningRuntimeState", "npcCargo"], (tx) => {
    const cargo = tx.get("npcCargo", "cargo");
    cargo[String(cargoID)] = {...cargo[String(cargoID)], quantity: 47};
    tx.put("npcCargo", "cargo", cargo);
  }), /ALIFE11_INCOMPLETE_NATIVE_MINING_CYCLE_JOURNAL/);
  assert.deepEqual(f.disk(), before);
  assert.equal(f.bridge.isPoisoned(), false);
});

test("a journal that does not describe the written cargo row is refused", (t) => {
  const f = fixture(t);
  assert.throws(() => f.cycle(() => ({quantity: 10, journal: {nextCargo: 999}})),
    /ALIFE11_MINING_CYCLE_JOURNAL_CARGO_MISMATCH/);
  assert.equal(f.disk()[String(cargoID)].quantity, 37);
});

test("a mining transaction may not write any other npcCargo row", (t) => {
  const f = fixture(t);
  assert.throws(() => f.cycle(({tx, cargo}) => {
    tx.put("npcCargo", "coopNativeHaulTransfer:" + cargoID, {cargoID, status: "COMMITTED"});
    return 10;
  }), /ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_KEY/);
  assert.equal(f.disk()[String(cargoID)].quantity, 37);
});

test("a mining cycle can never smuggle a transient row into SQLite", (t) => {
  const f = fixture(t);
  assert.throws(() => f.cycle(({cargo}) => {
    cargo[String(transientID)] = {...cargo[String(transientID)]};
    return 10;
  }), /ALIFE11_TRANSIENT_CARGO_SQL_WRITE_FORBIDDEN/);
  assert.equal(f.disk()[String(transientID)], undefined);
});

test("a first cycle creates the durable stack while transient cargo stays separate", (t) => {
  const f = fixture(t);
  // A hull with no ore stack yet: the settler reserves a new cargoID and writes it
  // inside the same guarded transaction.
  const newID = 980200000077;
  f.put("npcCargo", "cargo", {});
  f.cache.npcCargo = f.load("npcCargo");
  f.cache.npcCargo.cargo[String(transientID)] = {cargoID: transientID, entityID: 980000000401,
    ownerID, typeID: 34, categoryID: 25, quantity: 2, moduleID: 0, transient: true};
  const ghost = copy(f.transient());
  f.bridge.transact(["miningRuntimeState", "npcCargo"], (tx) => {
    const source = tx.get("miningRuntimeState", rockKey);
    const cargo = tx.get("npcCargo", "cargo");
    const row = {cargoID: newID, entityID: shipID, ownerID, moduleID: 0, typeID: oreTypeID,
      categoryID: 25, quantity: 10, singleton: false, transient: false};
    tx.put("miningRuntimeState", rockKey, {
      ...source,
      entities: {...source.entities, [String(rockID)]: {...rock, remainingQuantity: 990}},
    });
    tx.put("npcCargo", "cargo", {...cargo, [String(newID)]: row});
    tx.put("miningRuntimeState", opKey, {...journal(), cargoID: newID, nextCargo: 10, quantity: 10});
    return true;
  });
  assert.equal(f.disk()[String(newID)].quantity, 10);
  assert.equal(f.disk()[String(transientID)], undefined);
  assert.equal(f.cache.npcCargo.cargo[String(newID)].quantity, 10);
  assert.deepEqual(f.transient(), ghost);
});

test("an all-waste cycle commits its journal with no cargo write", (t) => {
  const f = fixture(t);
  f.cycle(() => 0);
  assert.equal(f.disk()[String(cargoID)].quantity, 37);
  assert.equal(f.load("miningRuntimeState")[opKey].status, "COMMITTED");
  assert.equal(f.load("miningRuntimeState")[opKey].quantity, 0);
});

test("without the mining flag the mining table set still fails closed", (t) => {
  const f = fixture(t);
  delete process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC;
  const before = copy(f.disk());
  assert.throws(() => f.cycle(), /ALIFE11_|NATIVE_TRANSIENT_STATE_UNSAFE|ALIFE07_MINING_ATOMIC_DISABLED/);
  assert.deepEqual(f.disk(), before);
});

test("the haul contract still needs the haul flag, not the mining one", (t) => {
  const f = fixture(t);
  delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC;
  assert.throws(() => f.bridge.transact(["npcCargo"], (tx) => {
    const cargo = tx.get("npcCargo", "cargo");
    tx.put("npcCargo", "cargo", cargo);
    tx.put("npcCargo", "coopNativeHaulTransfer:" + cargoID, {cargoID, status: "COMMITTED"});
  }), /NATIVE_TRANSIENT_STATE_UNSAFE:npcCargo/);
});

test("the real ALIFE-07 settler commits one cycle next to transient stock cargo", (t) => {
  const {createAtomicMiningSettler} = require("../integration/coopNativeMiningAtomic.cjs");
  const f = fixture(t);
  for (const flag of ["EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY", "EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION"]){
    const previous = process.env[flag];
    process.env[flag] = "1";
    t.after(() => { if (previous === undefined) delete process.env[flag]; else process.env[flag] = previous; });
  }
  // The settler needs a durable miner whose cargo stack already exists in SQLite.
  f.put("npcCargo", "cargo", {
    ...f.disk(),
    [String(cargoID)]: {cargoID, entityID: shipID, ownerID, typeID: oreTypeID, categoryID: 25,
      quantity: 37, moduleID: 0, transient: false},
  });
  f.cache.npcCargo = f.load("npcCargo");
  f.cache.npcCargo.cargo[String(transientID)] = {cargoID: transientID, entityID: 980000000401,
    ownerID, typeID: 34, categoryID: 25, quantity: 2, moduleID: 0, transient: true};

  const asteroid = {itemID: rockID};
  let live = {entityID: rockID, yieldTypeID: oreTypeID, originalQuantity: 1000,
    remainingQuantity: 1000, updatedAtMs: 1};
  const miner = {itemID: shipID, ownerID, transient: false, nativeCargoItems: [
    {itemID: cargoID, ownerID, locationID: shipID, moduleID: 0, typeID: oreTypeID, quantity: 37},
  ]};
  const gameStore = {
    coopAtomicNativeRows: {transact: (tables, mutation) => f.bridge.transact(tables, mutation)},
    read(table, pointer){
      const match = /^\/systems\/(\d+)\/entities\/(\d+)$/.exec(pointer);
      if (table !== "miningRuntimeState" || !match) return {success: false};
      const record = f.load("miningRuntimeState")[rockKey]?.entities?.[match[2]];
      return record ? {success: true, data: record} : {success: false};
    },
  };
  const nativeStore = {
    allocateCargoID: () => ({success: true, data: 980200000077}),
    listNativeCargoForEntity: (id) => Object.values(f.disk()).filter((x) => Number(x.entityID) === Number(id)),
  };
  const settler = createAtomicMiningSettler({gameStore, nativeStore,
    resolveType: (id) => ({typeID: id, groupID: 465, categoryID: 25, name: "Veldspar", volume: 0.1})});
  const ghost = copy(f.transient());
  const outcome = settler.settle({
    scene: {systemID, getEntityByID: (id) => (id === rockID ? asteroid : null)},
    entity: miner,
    targetEntity: asteroid,
    mineableState: {...live},
    miningResult: {normalQuantity: 10, wastedQuantity: 0},
    transferredQuantity: 10,
    cycleBoundaryMs: 1793031234567,
    moduleItem: {itemID: 77},
    readState: () => live,
    commitScene: () => { live = {...live, remainingQuantity: live.remainingQuantity - 10};
      return {success: true, data: {depleted: false}}; },
  });
  assert.equal(outcome.success, true, JSON.stringify(outcome));
  assert.equal(f.disk()[String(cargoID)].quantity, 47);
  assert.equal(f.load("miningRuntimeState")[rockKey].entities[String(rockID)].remainingQuantity, 990);
  assert.equal(f.load("miningRuntimeState")[opKey]?.status, undefined,
    "the settler writes its own op key, not this fixture's");
  const committed = Object.values(f.load("miningRuntimeState"))
    .filter((row) => row && row.status === "COMMITTED" && Number(row.nextCargo) === 47);
  assert.equal(committed.length, 1, "exactly one committed journal row authorizes the cargo delta");
  assert.equal(f.disk()[String(transientID)], undefined);
  assert.deepEqual(f.transient(), ghost);
});

test("a journal-shaped row missing its identifying fields does not count as one", (t) => {
  const f = fixture(t);
  assert.throws(() => f.bridge.transact(["miningRuntimeState", "npcCargo"], (tx) => {
    const cargo = tx.get("npcCargo", "cargo");
    cargo[String(cargoID)] = {...cargo[String(cargoID)], quantity: 47};
    tx.put("npcCargo", "cargo", cargo);
    tx.put("miningRuntimeState", opKey, {status: "COMMITTED", cargoID, nextCargo: 47});
  }), /ALIFE11_INCOMPLETE_NATIVE_MINING_CYCLE_JOURNAL/);
  assert.equal(f.disk()[String(cargoID)].quantity, 37);
});
