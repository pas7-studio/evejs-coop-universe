import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const Atomic = require(join(fork, "Code/server/src/space/coopGameStoreAtomic.js"));
const limits = Atomic.rowSizeLimits;

function bigRow(entries) {
  const row = {};
  for (let i = 0; i < entries; i += 1) {
    row["c" + i] = { cargoID: 980200000000 + i, entityID: 980000000000 + i, typeID: 222, quantity: 1, itemName: "Charge", singleton: false, transient: false };
  }
  return row;
}

test("row size: the global npcCargo row has its own ceiling above the standard guard", () => {
  assert.equal(limits.STANDARD_MAX_ROW_CHARS, 2000000);
  assert.ok(limits.maxRowChars("npcCargo") > limits.STANDARD_MAX_ROW_CHARS);
  assert.equal(limits.maxRowChars("items"), limits.STANDARD_MAX_ROW_CHARS);
  const row = bigRow(20000);
  const size = JSON.stringify(row).length;
  assert.ok(size > limits.STANDARD_MAX_ROW_CHARS, "fixture is not over the standard limit: " + size);
  assert.ok(size < limits.maxRowChars("npcCargo"), "fixture is over the universe ceiling: " + size);
  assert.equal(limits.serialize(row, "npcCargo", "cargo").length, size, "a real universe row must be writable");
});

test("row size: an ordinary table at the same size is still refused", () => {
  const row = bigRow(20000);
  assert.throws(() => limits.serialize(row, "items", "row"), /NATIVE_ROW_INVALID_SIZE/);
  assert.throws(() => limits.serialize(row, "industryJobs", "jobs"), /NATIVE_ROW_INVALID_SIZE/);
});

test("row size: the environment can only raise or lower the base, never below a sane guard", () => {
  const previous = process.env.EVEJS_COOP_ATOMIC_MAX_ROW_CHARS;
  try {
    process.env.EVEJS_COOP_ATOMIC_MAX_ROW_CHARS = "500";
    assert.equal(limits.maxRowChars("items"), 500);
    assert.ok(limits.maxRowChars("npcCargo") >= limits.STANDARD_MAX_ROW_CHARS, "the universe ceiling must not collapse to the test value");
    assert.throws(() => limits.serialize({ a: "x".repeat(1000) }, "items", "k"), /NATIVE_ROW_INVALID_SIZE/);
    process.env.EVEJS_COOP_ATOMIC_MAX_ROW_CHARS = "not-a-number";
    assert.equal(limits.maxRowChars("items"), limits.STANDARD_MAX_ROW_CHARS, "a bad value falls back to the standard guard");
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_ATOMIC_MAX_ROW_CHARS;
    else process.env.EVEJS_COOP_ATOMIC_MAX_ROW_CHARS = previous;
  }
});
