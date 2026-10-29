// FW-098 guard: a commit refreshes only the rows it wrote.
//
// Measured 2026-10-30 with a CPU profile of the owner's LIVE play server (inspector
// opened with SIGUSR1, no restart, 9 s window, ~12 000 samples):
//
//   36.5 %  transact            coopGameStoreAtomic.js:93
//   14.7 %  reconcileObject     coopGameStoreAtomic.js:74
//   14.3 %  loadTableObject     sqliteStore.js:697
//   16.7 %  (garbage collector)
//
// After every commit the bridge re-read the WHOLE table from SQLite (parsing every
// row), deep-reconciled it into the cache, and then re-read the same table a second
// time to rebuild the flush baseline. The writer already knows exactly which rows it
// wrote, so it now reports them and only those rows are applied - in the shape the
// store owns (`applyRowToObject`) and to the baseline the way the asynchronous flush
// acknowledgement already advances it.
//
// Three things are pinned here:
//   1. the row applier is exactly equivalent to assembleFromRows (the disk format);
//   2. a commit takes the row path - loadTableObject is NOT called - and leaves the
//      cache, the deletions and the flush baseline identical to a full reload;
//   3. production wiring cannot silently fall back to the slow path.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { ENGINE_CODE, engineAvailable, engineSource, skipWithoutEngine } from "./_support/engineCheckout.mjs";
const require = createRequire(import.meta.url);
const { createSqliteAdapter, createGameStoreAdapter } = require("../integration/coopGameStoreAtomic.cjs");

const SEP = "\u001f";
// The deployed store owns the row shape; the test uses the real functions so a
// change to the disk format cannot pass by being mirrored in a copy here.
const shape = engineAvailable
  ? require(path.join(ENGINE_CODE, "server/src/gameStore/sqliteStore.js"))
  : null;

test("the row applier is assembleFromRows, one row at a time", { skip: skipWithoutEngine(test, shape && "ok") }, () => {
  const fixtures = {
    // grouped table: entries live under a wrapper group, one row per entity
    corporationRuntime: {
      ["corporations" + SEP + "1001"]: { corporationID: 1001, wallet: { balance: 300 } },
      ["corporations" + SEP + "1002"]: { corporationID: 1002, wallet: { balance: 0 } },
      // skeleton row: proves the group exists, must not erase its entities
      corporations: {},
      ["wars" + SEP + "7"]: { warID: 7, aggressor: 500001 },
    },
    // flat table: one row per top-level key, scalars included
    items: { "91": { itemID: 91, quantity: 1 }, "92": { itemID: 92, quantity: 9 } },
    identityState: { version: 3, nextItemID: 1990000200 },
    industryJobs: { _meta: { nextJobID: 97 }, ["jobs" + SEP + "97"]: { jobID: 97, status: 1 } },
  };
  for (const [table, rows] of Object.entries(fixtures)) {
    const expected = shape.assembleFromRows(table, rows);
    for (const order of [Object.keys(rows), Object.keys(rows).reverse()]) {
      const applied = {};
      for (const rowKey of order) shape.applyRowToObject(table, applied, rowKey, rows[rowKey]);
      assert.deepEqual(applied, expected, `${table} applied in order ${order.join(",")}`);
    }
    // A deleted row disappears; a skeleton row never removes entities.
    const pruned = shape.assembleFromRows(table, rows);
    const entityKey = Object.keys(rows).find((key) => key.includes(SEP));
    if (entityKey) {
      const [group, entity] = entityKey.split(SEP);
      shape.applyRowToObject(table, pruned, entityKey, undefined);
      assert.equal(Object.prototype.hasOwnProperty.call(pruned[group], entity), false);
      shape.applyRowToObject(table, pruned, group, {});
      assert.equal(Object.prototype.hasOwnProperty.call(pruned[group], entity), false,
        "a skeleton group row must stay additive");
    }
  }
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-atomic-rows-"));
  const db = new DatabaseSync(path.join(dir, "gamestore.sqlite"));
  const names = ["items", "characters", "corporationRuntime", "npcEntities", "npcModules"];
  for (const table of names) db.exec(`CREATE TABLE "${table}"(key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
  const put = (table, key, value) => db
    .prepare(`INSERT INTO "${table}"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`)
    .run(String(key), JSON.stringify(value));
  put("items", "91", { itemID: 91, ownerID: 1001, quantity: 1 });
  put("items", "92", { itemID: 92, ownerID: 1001, quantity: 10 });
  put("characters", "701", { characterID: 701, balance: 100 });
  put("corporationRuntime", "corporations" + SEP + "1001", { corporationID: 1001, wallet: { balance: 300 } });
  put("npcEntities", "entities" + SEP + "101", { entityID: 101, systemID: 30000144, shield: 1 });
  put("npcModules", "modules" + SEP + "401", { moduleID: 401, entityID: 101 });
  put("npcModules", "modules" + SEP + "402", { moduleID: 402, entityID: 101 });

  const load = (table) => {
    const rows = {};
    for (const row of db.prepare(`SELECT key,json FROM "${table}"`).all()) rows[row.key] = JSON.parse(row.json);
    return shape.assembleFromRows(table, rows);
  };
  let loads = 0;
  const sqliteStore = {
    coopAtomicNativeRows: createSqliteAdapter(() => db),
    loadTableObject: (table) => { loads += 1; return load(table); },
    applyRowToObject: shape.applyRowToObject,
    rowGroupsFor: shape.rowGroupsFor,
  };
  const cache = Object.fromEntries(names.map((table) => [table, load(table)]));
  const dirty = new Set(), fullDirty = new Set(), flushTimers = {}, inFlightFlushes = new Map();
  const transientPaths = {}, dirtyRowKeys = {};
  const baselines = {};
  const diskBaseline = (table) => new Map(db.prepare(`SELECT key,json FROM "${table}"`).all()
    .map((row) => [row.key, JSON.stringify(JSON.parse(row.json))]));
  // Startup already loaded every table and built its baseline from disk.
  for (const table of names) baselines[table] = diskBaseline(table);
  const advanceFlushBaseline = (table, upserts = [], deletes = []) => {
    const baseline = baselines[table] || (baselines[table] = new Map());
    for (const [key, serialized] of upserts) baseline.set(key, serialized);
    for (const key of deletes) baseline.delete(key);
  };
  const bridge = createGameStoreAdapter({
    sqliteStore,
    ensureSqliteReady: () => {},
    ensureCached: (table) => Boolean(cache[table]),
    flushTableSync: (table) => { dirty.delete(table); delete flushTimers[table]; return { success: true }; },
    cache, dirty, flushTimers, inFlightFlushes, transientPaths, dirtyRowKeys, fullDirty,
    rebuildFlushBaselineFromDisk: () => { throw Error("FW-098 must not rebuild a baseline from disk"); },
    advanceFlushBaseline,
    invalidateNativeItems: () => true,
    invalidateNativeAccounts: () => true,
    fatal: (error) => { throw error; },
  });
  return { db, put, cache, bridge, baselines, diskBaseline, loads: () => loads,
    close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function run(fn) {
  const f = fixture();
  const prior = process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  try {
    process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
    return fn(f);
  } finally {
    if (prior === undefined) delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
    else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = prior;
    f.close();
  }
}

test("a commit applies its own write set: no whole-table reload, same cache, same baseline", () => run((f) => {
  const items = f.cache.items;
  const ore = items["92"];
  assert.equal(f.bridge.transact(["items", "corporationRuntime", "npcEntities", "npcModules", "characters"], (tx) => {
    const oreRow = tx.get("items", "92");
    oreRow.quantity -= 4;
    tx.put("items", "92", oreRow);
    tx.put("items", "93", { itemID: 93, ownerID: 1001, quantity: 2 });
    const corp = tx.get("corporationRuntime", "corporations" + SEP + "1001");
    corp.wallet.balance -= 50;
    tx.put("corporationRuntime", "corporations" + SEP + "1001", corp);
    tx.del("npcModules", "modules" + SEP + "402");
    const entity = tx.get("npcEntities", "entities" + SEP + "101");
    entity.shield = 0.5;
    tx.put("npcEntities", "entities" + SEP + "101", entity);
    const character = tx.get("characters", "701");
    character.balance = 40;
    tx.put("characters", "701", character);
    return "COMMITTED";
  }), "COMMITTED");

  assert.equal(f.loads(), 0, "the fast path must not re-read any table from SQLite");
  // Identity is preserved for ordinary tables, replaced for characters (which
  // caches a normalized record by raw child identity).
  assert.equal(f.cache.items, items);
  assert.equal(f.cache.items["92"], ore);
  assert.equal(ore.quantity, 6);
  assert.equal(f.cache.items["93"].quantity, 2);
  assert.equal(f.cache.corporationRuntime.corporations["1001"].wallet.balance, 250);
  assert.equal(f.cache.npcEntities.entities["101"].shield, 0.5);
  assert.equal(f.cache.npcModules.modules["401"].moduleID, 401);
  assert.equal(Object.prototype.hasOwnProperty.call(f.cache.npcModules.modules, "402"), false,
    "a committed delete must disappear from the cache");
  assert.equal(f.cache.characters["701"].balance, 40);

  // Cache, disk and the flush baseline must agree, otherwise the next flush would
  // rewrite rows that did not change (or omit a tombstone).
  for (const table of ["items", "characters", "corporationRuntime", "npcEntities", "npcModules"]) {
    const expected = f.diskBaseline(table);
    assert.deepEqual([...f.baselines[table].entries()].sort(), [...expected.entries()].sort(),
      `flush baseline of ${table} must equal a rebuild from disk`);
  }
  // The cache is what a reader would get from disk.
  assert.deepEqual({ ...f.cache.items["92"] }, { itemID: 92, ownerID: 1001, quantity: 6 });
}));

test("a declared table the transaction never wrote is not reloaded", () => run((f) => {
  const items = f.cache.items;
  f.bridge.transact(["items", "identityState" in f.cache ? "identityState" : "npcEntities"], (tx) => {
    tx.get("npcEntities", "entities" + SEP + "101");
    tx.put("items", "91", { ...tx.get("items", "91"), quantity: 5 });
    return null;
  });
  assert.equal(f.loads(), 0);
  assert.equal(f.cache.items["91"].quantity, 5);
  assert.equal(f.cache.items, items);
}));

test("production wiring passes advanceFlushBaseline, so the fast path cannot be dropped", { skip: skipWithoutEngine(test, null) }, () => {
  const wiring = engineSource("server/src/gameStore/index.js")
    .split("\n").find((line) => line.startsWith("module.exports.coopAtomicNativeRows"));
  assert.ok(wiring, "the GameStore must export the atomic rows bridge");
  assert.match(wiring, /advanceFlushBaseline,/, "without it every commit re-reads whole tables from disk");
  const atomic = engineSource("server/src/space/coopGameStoreAtomic.js");
  assert.match(atomic, /advanceBaseline\(t,upserts,deletes\)/, "the row path must advance the flush baseline");
  assert.match(atomic, /writes:Object\.fromEntries/, "the writer must report the rows it wrote");
});
