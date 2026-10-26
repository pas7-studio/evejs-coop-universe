import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { promote } = require("../integration/coopDurableCargoWrite.cjs");

function fakeStore(behaviour = {}) {
  const calls = [];
  return {
    calls,
    upsertNativeCargo(row, options) {
      calls.push({ row, options });
      if (behaviour.throwUpsert) throw new Error("database closed");
      return behaviour.upsert || { success: true };
    },
  };
}

function fakeDatabase(behaviour = {}) {
  const calls = [];
  return {
    calls,
    setTransientPath(table, path, value) {
      calls.push({ op: "setTransientPath", table, path, value });
    },
    flushTableSync(table) {
      calls.push({ op: "flushTableSync", table });
      return behaviour.flush || { success: true };
    },
  };
}

test("promotes the exact cargo path and flushes the table", () => {
  const store = fakeStore();
  const database = fakeDatabase();
  const result = promote({ store, database, cargoID: 7001, row: { cargoID: 7001, quantity: 10 } });
  assert.equal(result.status, "DURABLE");
  assert.deepEqual(database.calls, [
    { op: "setTransientPath", table: "npcCargo", path: "/cargo/7001", value: false },
    { op: "flushTableSync", table: "npcCargo" },
  ]);
  assert.equal(store.calls[0].row.cargoID, 7001);
});

test("a rejected write is never reported as durable", () => {
  const result = promote({
    store: fakeStore({ upsert: { success: false, errorMsg: "NPC_NATIVE_CARGO_ID_REQUIRED" } }),
    database: fakeDatabase(),
    cargoID: 7002,
    row: { cargoID: 7002 },
  });
  assert.equal(result.status, "UPSERT_REJECTED");
  assert.equal(result.detail, "NPC_NATIVE_CARGO_ID_REQUIRED");
});

test("a throw during the write is reported as uncertain, not clean", () => {
  const result = promote({
    store: fakeStore({ throwUpsert: true }),
    database: fakeDatabase(),
    cargoID: 7003,
    row: { cargoID: 7003 },
  });
  assert.equal(result.status, "UPSERT_UNCERTAIN");
});

test("a failed fsync is reported as FLUSH_FAILED", () => {
  const result = promote({
    store: fakeStore(),
    database: fakeDatabase({ flush: { success: false } }),
    cargoID: 7004,
    row: { cargoID: 7004 },
  });
  assert.equal(result.status, "FLUSH_FAILED");
});

test("refuses a row without a valid cargo id", () => {
  const store = fakeStore();
  const database = fakeDatabase();
  assert.equal(promote({ store, database, cargoID: 0, row: {} }).status, "INVALID_CARGO_ID");
  assert.equal(store.calls.length, 0);
  assert.equal(database.calls.length, 0);
});
