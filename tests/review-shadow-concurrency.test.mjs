import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

// Finding 2 (independent review of 15c374a): persist() merges the file and then rewrites it with
// no cross-process serialisation. Two writers can both read the same version and the second rename
// erases the first. A conflicting cargoID is resolved by whichever copy is in memory.
const require = createRequire(import.meta.url);
const root = process.env.EVEJS_FORK_ROOT;
if (!root) throw new Error("EVEJS_FORK_ROOT is unset");
const MODULE_PATH = path.join(root, "Code/server/src/space/coopEconomyV2.js");

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-v2-lock-"));
  const stateFile = path.join(dir, "shadow.json");
  const enableFile = path.join(dir, "enable");
  process.env.EVEJS_COOP_ECONOMY_V2_FILE = stateFile;
  process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE = enableFile;
  delete process.env.EVEJS_COOP_ECONOMY_V2;
  delete require.cache[MODULE_PATH];
  return {
    dir, stateFile, enableFile,
    enable: () => fs.writeFileSync(enableFile, "1"),
    load: () => { delete require.cache[MODULE_PATH]; return require(MODULE_PATH); },
  };
}

function record(cargoID, quantity = 100, stationID = 60000358) {
  return {
    version: 1, cargoID, haulerID: 2001, fleetID: 3001, systemID: 30000144,
    stationID, corporationID: 1000129, typeID: 17470, quantity,
    phase: "COMMITTED", at: 1793552053418, updatedAt: 1793552053418, itemID: 900000000000 + cargoID,
  };
}
function target(cargoID, quantity = 100, stationID = 60000358) {
  return { itemID: 900000000000 + cargoID, typeID: 17470, locationID: stationID, quantity, ownerID: 1000129 };
}
const readState = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("a writer does not rewrite the state file while another writer holds the lock", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  v2.noteWarehouse(record(1), target(1), true);
  const before = fs.readFileSync(box.stateFile, "utf8");

  fs.writeFileSync(box.stateFile + ".lock", JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
  v2.noteWarehouse(record(2), target(2), true);
  const during = fs.readFileSync(box.stateFile, "utf8");
  assert.equal(during, before, "persist() rewrote the file under a lock held by another writer");

  fs.unlinkSync(box.stateFile + ".lock");
  v2.noteWarehouse(record(3), target(3), true);
  const after = readState(box.stateFile);
  assert.deepEqual(after.receipts.map((r) => r.cargoID).sort((a, b) => a - b), [1, 2, 3],
    "a receipt observed while the lock was busy was lost instead of being written later");
});

test("a conflicting cargoID is resolved by evidence and reported, not silently kept in memory", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  v2.noteWarehouse(record(7, 100), target(7, 100), true);

  // a second writer (a reconcile tool or a second probe) corrects the same cargoID on disk
  const disk = readState(box.stateFile);
  const row = disk.receipts.find((r) => r.cargoID === 7);
  row.quantity = 999;
  row.updatedAt = Date.now() + 5000;
  row.proof = "STOCK_PROVEN";
  disk.stations["60000358"]["17470"] = 999;
  fs.writeFileSync(box.stateFile, JSON.stringify(disk, null, 2), "utf8");

  v2.noteWarehouse(record(8, 5), target(8, 5), true);
  const after = readState(box.stateFile);
  const kept = after.receipts.find((r) => r.cargoID === 7);
  assert.equal(kept.quantity, 999, "a newer on-disk correction was silently discarded by the in-memory copy");
  const view = v2.status();
  assert.ok(Array.isArray(view.conflicts) && view.conflicts.some((c) => Number(c.cargoID) === 7),
    "the disagreement was resolved without being reported");
  assert.ok(after.stations["60000358"]["17470"] >= 999,
    "the station total was not repaired from the corrected receipt");
});

test("two independent processes writing at the same time lose no receipt", () => {
  const box = sandbox();
  box.enable();
  const writer = path.join(box.dir, "writer.cjs");
  fs.writeFileSync(writer, `
const v2 = require(${JSON.stringify(MODULE_PATH)});
const [from, count] = process.argv.slice(2).map(Number);
for (let i = 0; i < count; i += 1) {
  const id = from + i;
  const q = 1;
  v2.noteWarehouse(
    { cargoID: id, stationID: 60000358, corporationID: 1000129, typeID: 17470, quantity: q,
      phase: "COMMITTED", at: Date.now(), itemID: 900000000000 + id },
    { itemID: 900000000000 + id, typeID: 17470, locationID: 60000358, quantity: q, ownerID: 1000129 },
    true,
  );
}
`, "utf8");

  const run = (from) => new Promise((resolve, reject) => {
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, [writer, String(from), "40"], {
      env: { ...process.env, EVEJS_COOP_ECONOMY_V2_FILE: box.stateFile,
        EVEJS_COOP_ECONOMY_V2_ENABLE_FILE: box.enableFile, EVEJS_COOP_ECONOMY_V2: "" },
      stdio: "ignore",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("writer exit " + code))));
    child.on("error", reject);
  });

  return Promise.all([run(1000), run(2000)]).then(() => {
    const after = readState(box.stateFile);
    const ids = new Set(after.receipts.map((r) => r.cargoID));
    for (let i = 0; i < 40; i += 1) {
      assert.ok(ids.has(1000 + i), "writer A lost receipt " + (1000 + i));
      assert.ok(ids.has(2000 + i), "writer B lost receipt " + (2000 + i));
    }
  });
});

test("an interrupted merge leaves the previous file readable and no half state", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  v2.noteWarehouse(record(21), target(21), true);
  // a crash between the tmp write and the rename leaves a tmp file behind
  fs.writeFileSync(box.stateFile + ".tmp", "{ half", "utf8");
  const after = readState(box.stateFile);
  assert.equal(after.receipts.length, 1, "the durable file was damaged by an interrupted write");
  v2.noteWarehouse(record(22), target(22), true);
  const next = readState(box.stateFile);
  assert.deepEqual(next.receipts.map((r) => r.cargoID).sort((a, b) => a - b), [21, 22]);
});
