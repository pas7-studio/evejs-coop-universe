import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const isolate = require("../integration/coopNativeCargoTransientIsolation.cjs");
const { createSqliteAdapter, createGameStoreAdapter } = require("../integration/coopGameStoreAtomic.cjs");

// Live finding: the atomic NPC ammo bank declares three native tables, so the
// GameStore owner found no transient-cargo contract for that table set and
// refused every bank transaction as NATIVE_TRANSIENT_STATE_UNSAFE whenever any
// transient NPC hull existed. A fully loaded warship could activate a turret
// and never debit a charge or apply damage. This contract is the reviewable
// declaration for exactly that write set.
const cargoID = 980200004763, entityID = 980000016639, moduleID = 980100051793;
const charge = { cargoID, entityID, ownerID: 1000135, moduleID, typeID: 20057,
  categoryID: 8, quantity: 1, transient: false };
const ghostID = 980200009999;
const ghost = { cargoID: ghostID, entityID: 980000009999, ownerID: 1000035,
  moduleID: 0, typeID: 34, categoryID: 25, quantity: 2, transient: true };
const copy = v => JSON.parse(JSON.stringify(v));

function fixture(t) {
  const flags = ["EVEJS_COOP_NATIVE_ATOMIC_ROWS", "EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION",
    "EVEJS_COOP_NPC_STRICT_AMMO", "EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE", "EVEJS_COOP_NPC_BANK_ATOMIC"];
  const prev = Object.fromEntries(flags.map(k => [k, process.env[k]]));
  flags.forEach(k => { process.env[k] = "1"; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-ammo-bank-contract-"));
  const db = new DatabaseSync(path.join(dir, "gamestore.sqlite"));
  db.exec('PRAGMA journal_mode=WAL;' +
    ' CREATE TABLE "npcCargo" (key TEXT PRIMARY KEY,json TEXT NOT NULL);' +
    ' CREATE TABLE "npcEntities" (key TEXT PRIMARY KEY,json TEXT NOT NULL);' +
    ' CREATE TABLE "npcModules" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const put = (table, key, value) => db.prepare('INSERT INTO "' + table + '"(key,json) VALUES(?,?)' +
    ' ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key, JSON.stringify(value));
  put("npcCargo", "cargo", { [cargoID]: copy(charge) });
  put("npcEntities", "entities\u001f" + entityID, { entityID, ownerID: 1000135, systemID: 30001363 });
  put("npcModules", "modules\u001f" + moduleID, { moduleID, entityID, ownerID: 1000135, categoryID: 7, flagID: 27, typeID: 13884 });
  const load = table => Object.fromEntries(db.prepare('SELECT key,json FROM "' + table + '"').all()
    .map(row => [row.key, JSON.parse(row.json)]));
  const cache = { npcCargo: load("npcCargo"), npcEntities: load("npcEntities"), npcModules: load("npcModules") };
  cache.npcCargo.cargo[ghostID] = ghost;
  const transientPaths = { npcCargo: new Set(["/cargo/" + ghostID]) };
  const store = { coopAtomicNativeRows: createSqliteAdapter(() => db), loadTableObject: table => load(table) };
  const bridge = createGameStoreAdapter({
    sqliteStore: store, ensureSqliteReady: () => {}, ensureCached: table => Boolean(cache[table]),
    flushTableSync: () => ({ success: true }), cache,
    dirty: new Set(), flushTimers: {}, inFlightFlushes: new Map(),
    transientPaths, dirtyRowKeys: {}, fullDirty: new Set(),
    rebuildFlushBaselineFromDisk: () => {}, invalidateNativeItems: () => true, fatal: () => {},
  });
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[key]; else process.env[key] = v;
    }
  });
  const bank = (whenMs, mutate) => bridge.transact(["npcCargo"], tx => {
    const root = tx.get("npcCargo", "cargo");
    assert.equal(root[String(ghostID)], undefined, "transient cargo must never reach SQL");
    delete root[String(cargoID)];
    const fences = { [String(moduleID)]: whenMs };
    mutate?.(tx, root);
    tx.put("npcCargo", "cargo", root);
    tx.put("npcCargo", "coopAmmoCycles_" + entityID,
      { version: 1, entityID, modules: fences, outcomeRequired: true });
    return "COMMITTED";
  }, { contract: "npc-ammo-bank" });
  return { bridge, bank, load, disk: () => load("npcCargo").cargo, cache };
}

test("the ammo-bank table set now has a declared contract", () => {
  const contract = isolate.contractForTables(["npcCargo"], null, "npc-ammo-bank");
  assert.ok(contract, "the ammo bank must be declared");
  assert.equal(contract.name, "npc-ammo-bank");
  assert.equal(contract.cargoRootWrites.min, 1);
  assert.equal(contract.cargoRootWrites.max, 1);
  for (const flag of ["EVEJS_COOP_NPC_STRICT_AMMO", "EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE",
    "EVEJS_COOP_NPC_BANK_ATOMIC", "EVEJS_COOP_NATIVE_ATOMIC_ROWS"])
    assert.ok(contract.flags.includes(flag), flag + " must gate the contract");
  // Order is irrelevant, a different table set is still undeclared.
  assert.equal(isolate.contractForTables(["npcCargo"], null, "npc-ammo-bank").name, "npc-ammo-bank");
  assert.equal(isolate.contractForTables(["npcCargo"]).name, "haul-transfer");
  assert.equal(isolate.contractForTables(["npcCargo", "characters"]), null);
});

test("a real ammo-bank cycle commits while a transient hull exists", t => {
  const f = fixture(t);
  assert.equal(f.bank(1793063200000), "COMMITTED");
  const disk = f.disk();
  assert.equal(disk[String(cargoID)], undefined, "the spent charge is gone from SQL");
  assert.equal(disk[String(ghostID)], undefined, "the transient row was never persisted");
  const fence = f.load("npcCargo")["coopAmmoCycles_" + entityID];
  assert.equal(fence.version, 1);
  assert.equal(fence.modules[String(moduleID)], 1793063200000);
  assert.deepEqual(f.cache.npcCargo.cargo[String(ghostID)], ghost, "the live shadow is untouched");
});

test("the write set must be exactly one cargo root and one fence", t => {
  const f = fixture(t);
  // A second fence row is not this cycle.
  assert.throws(() => f.bank(1793063200001, tx => tx.put("npcCargo", "coopAmmoCycles_980000000002",
    { version: 1, entityID: 980000000002, modules: {} })), /ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_FENCE/);
  // A fence for another ship under this ship's key is refused.
  assert.throws(() => f.bank(1793063200002, tx => tx.put("npcCargo", "coopAmmoCycles_" + entityID,
    { version: 1, entityID: 980000000003, modules: {} })), /ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_FENCE/);
  // An unrelated cargo side key is refused.
  assert.throws(() => f.bank(1793063200003, tx => tx.put("npcCargo", "coopNativeHaulTransfer:1",
    { cargoID: 1, status: "COMMITTED" })), /ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_FENCE/);
});

test("a cargo root that still carries a transient row is refused", t => {
  const f = fixture(t);
  assert.throws(() => f.bank(1793063200004, (tx, root) => {
    root[String(ghostID)] = ghost;
  }), /ALIFE11_TRANSIENT_CARGO_SQL_WRITE_FORBIDDEN/);
});

test("with the isolation flag off the original fail-closed behaviour returns", t => {
  const f = fixture(t);
  process.env.EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION = "0";
  // The declaration still exists, but without the flag no witness is captured
  // and the GameStore owner refuses the mixed transaction exactly as before.
  assert.equal(isolate.contractForTables(["npcCargo"], null, "npc-ammo-bank").name, "npc-ammo-bank");
  assert.throws(() => f.bank(1793063200005), /NATIVE_TRANSIENT_STATE_UNSAFE/);
});
