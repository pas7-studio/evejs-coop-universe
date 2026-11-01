import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const space = join(fork, "Code/server/src/space");

// the live module reads its file paths at require time, so point them at a temp dir first
const dir = mkdtempSync(join(tmpdir(), "coopv2-test-"));
process.env.EVEJS_COOP_ECONOMY_V2_FILE = join(dir, "shadow.json");
process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE = join(dir, "enable");
delete process.env.EVEJS_COOP_ECONOMY_V2;

const v2 = require(join(space, "coopEconomyV2.js"));

const record = (cargoID, overrides = {}) => ({
  cargoID,
  stationID: 60003760,
  typeID: 34,
  quantity: 120,
  corporationID: 1000125,
  phase: "COMMITTED",
  itemID: 9000 + cargoID,
  ...overrides,
});

test("live shadow: OFF by default, observes nothing and writes nothing", () => {
  assert.equal(v2.enabled(), false);
  assert.equal(v2.noteWarehouse(record(1), { itemID: 9001 }, true), null);
  assert.equal(existsSync(process.env.EVEJS_COOP_ECONOMY_V2_FILE), false, "OFF must not touch the evidence file");
  const view = v2.snapshot();
  assert.equal(view.mode, "OFF");
  assert.equal(view.deliveries, 0);
});

test("live shadow: a real native receipt is observed once and proves physical stock", () => {
  writeFileSync(process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE, "1");
  assert.equal(v2.enabled(), true);
  const first = v2.noteWarehouse(record(41), { itemID: 9041 }, true);
  assert.equal(first.ok, true);
  assert.equal(first.code, "OBSERVED");
  assert.equal(first.proof, "STOCK_PROVEN", "the observed ItemStore stack is the proof");
  assert.equal(first.physical, 120);
  assert.equal(existsSync(process.env.EVEJS_COOP_ECONOMY_V2_FILE), true, "the first observation is durable immediately");

  const status = v2.status();
  assert.equal(status.mode, "SHADOW");
  assert.equal(status.deliveries, 1);
  assert.equal(status.stations["60003760"]["34"], 120);
  assert.equal(existsSync(process.env.EVEJS_COOP_ECONOMY_V2_FILE), true, "status persists the evidence file");
  const persisted = JSON.parse(readFileSync(process.env.EVEJS_COOP_ECONOMY_V2_FILE, "utf8"));
  assert.equal(persisted.deliveries, 1);
  assert.equal(persisted.receipts[0].cargoID, 41);
  assert.equal(persisted.receipts[0].durable, true);
});

test("live shadow: a replayed cargoID cannot inflate the physical total", () => {
  const replay = v2.noteWarehouse(record(41), { itemID: 9041 }, true);
  assert.equal(replay.code, "ALREADY_OBSERVED");
  const status = v2.status();
  assert.equal(status.deliveries, 1);
  assert.equal(status.replays, 1);
  assert.equal(status.stations["60003760"]["34"], 120, "120, not 240");
});

test("live shadow: a COMMITTED record without an ItemStore stack is not station stock", () => {
  const blocked = v2.noteWarehouse(record(43, { typeID: 35, quantity: 10, itemID: 0 }), null, false);
  assert.equal(blocked.ok, true);
  assert.equal(blocked.proof, "NO_PHYSICAL_STOCK", "a bare depot phase must never unlock a refinery");
  assert.equal(blocked.physical, 0);
  const status = v2.status();
  assert.equal(status.proofs.blocked, 1);
  assert.equal(status.stations["60003760"]["35"], undefined, "the type has no physical stock at all");
});

test("live shadow: the shadow stage never declares itself live", () => {
  const readiness = v2.assess();
  assert.equal(readiness.live, false);
  assert.equal(readiness.code, "MANUAL_ONLY", "an observer is not a live runtime");
  const status = v2.status();
  assert.equal(status.readiness.live, false);
  assert.equal(status.lastError, null);
});

test("live shadow: the warehouse hook is guarded, lazy and cannot break a deposit", () => {
  const source = readFileSync(join(space, "coopNativeWarehouse.js"), "utf8");
  assert.match(source, /require\("\.\/coopEconomyV2"\)/, "the hook loads the observer lazily");
  assert.match(source, /if\(v2\.enabled\(\)\)v2\.noteWarehouse\(record,target,!findCargo\(record\)\)/, "the hook runs only when the stage is on");
  assert.match(source, /catch\(error\)\{console\.warn\("\[CoopEconomyV2\]"/, "an observer failure is logged, never thrown into the deposit");
  // the deposit path must stay identical when the stage is off
  delete process.env.EVEJS_COOP_ECONOMY_V2;
  rmSync(process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE, { force: true });
  assert.equal(v2.enabled(), false);
  assert.equal(v2.noteWarehouse(record(44), { itemID: 9044 }, true), null);
});

// WAVE2-REGRESSION
test("live shadow: a numeric string is not a cargo id", () => {
  const { v2: fresh } = (() => {
    // the module captured its paths at require time; reuse the one already loaded and enable it
    const fs = require("node:fs");
    fs.writeFileSync(process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE, "1");
    return { v2 };
  })();
  for (const cargoID of ["9", 1.5, -3, 0]) {
    assert.equal(
      fresh.noteWarehouse({ cargoID, stationID: 2, typeID: 3, quantity: 4, corporationID: 5, phase: "COMMITTED", itemID: 6 }, { itemID: 6 }, true),
      null,
      "accepted cargoID " + String(cargoID),
    );
  }
  assert.equal(fresh.noteWarehouse(record(77), { itemID: 9077 }, true).code, "OBSERVED");
});
