import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// The shadow's durability was only ever proven live: it lost its evidence on every restart (D2)
// and that fix has no test. These cases pin it: a restart keeps the evidence, a corrupt state
// file is refused instead of inventing receipts, the ring stays bounded, and a replay never
// double-counts a delivery.
const require = createRequire(import.meta.url);
const root = process.env.EVEJS_FORK_ROOT;
if (!root) throw new Error("EVEJS_FORK_ROOT is unset");
const MODULE_PATH = path.join(root, "Code/server/src/space/coopEconomyV2.js");

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-v2-dur-"));
  const stateFile = path.join(dir, "shadow.json");
  const enableFile = path.join(dir, "enable");
  process.env.EVEJS_COOP_ECONOMY_V2_FILE = stateFile;
  process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE = enableFile;
  delete process.env.EVEJS_COOP_ECONOMY_V2;
  delete require.cache[MODULE_PATH];
  return {
    dir,
    stateFile,
    enableFile,
    enable: () => fs.writeFileSync(enableFile, "1"),
    load: () => {
      delete require.cache[MODULE_PATH];
      return require(MODULE_PATH);
    },
  };
}

function record(cargoID, stationID, typeID = 17470, quantity = 100) {
  return {
    version: 1, cargoID, haulerID: 2001, fleetID: 3001, systemID: 30000144,
    stationID, corporationID: 1000129, typeID, quantity,
    phase: "COMMITTED", at: 1793552053418, updatedAt: 1793552053418, itemID: 900000000000 + cargoID,
  };
}

function target(cargoID, stationID, typeID = 17470, quantity = 100) {
  return { itemID: 900000000000 + cargoID, typeID, locationID: stationID, quantity, ownerID: 1000129 };
}

test("OFF writes nothing at all", () => {
  const box = sandbox();
  const v2 = box.load();
  assert.equal(v2.enabled(), false, "the shadow enabled itself with no flag and no file");
  v2.noteWarehouse(record(1, 60000358), target(1, 60000358), true);
  const view = v2.status();
  assert.equal(view.deliveries, 0, "an OFF shadow counted a delivery");
  assert.deepEqual(view.receipts, [], "an OFF shadow recorded a receipt");
  assert.equal(fs.existsSync(box.stateFile), false, "an OFF shadow wrote a state file");
});

test("a restart keeps the evidence", () => {
  const box = sandbox();
  const first = box.load();
  box.enable();
  assert.equal(first.enabled(), true);
  first.noteWarehouse(record(11, 60000358), target(11, 60000358), true);
  first.noteWarehouse(record(12, 60000358), target(12, 60000358), true);
  assert.equal(first.status().deliveries, 2);
  const second = box.load();
  const view = second.status();
  assert.equal(view.deliveries, 2, "the restart lost the delivery count");
  assert.equal(view.receipts.length, 2, "the restart lost the receipts");
  assert.equal(view.stations[60000358][17470], 200, "the station total did not survive the restart");
});

test("a corrupt state file is refused, not invented from", () => {
  const box = sandbox();
  fs.writeFileSync(box.stateFile, "{ not json");
  const v2 = box.load();
  assert.equal(v2.enabled(), false, "a corrupt state file enabled the shadow by itself");
  const view = v2.status();
  assert.equal(view.deliveries, 0, "a corrupt state file produced deliveries out of nothing");
  assert.deepEqual(view.receipts, [], "a corrupt state file produced receipts");
  assert.equal(view.lastError, "STATE_UNREADABLE", "the unreadable state was not named: " + view.lastError);
  box.enable();
  v2.noteWarehouse(record(21, 60000358), target(21, 60000358), true);
  assert.equal(v2.status().deliveries, 1, "a real delivery after a corrupt state file was not recorded");
});

test("a replayed cargoID is counted once and does not double the station total", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  v2.noteWarehouse(record(31, 60000358, 17470, 500), target(31, 60000358, 17470, 500), true);
  v2.noteWarehouse(record(31, 60000358, 17470, 500), target(31, 60000358, 17470, 500), true);
  const view = v2.status();
  assert.equal(view.replays, 1, "the replay was not recognised");
  assert.equal(view.stations[60000358][17470], 500, "the replay doubled the station total");
  assert.equal(view.deliveries, 1, "the replay counted as a second delivery");
});

test("memory stays bounded under a flood", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  for (let i = 1; i <= 300; i += 1) {
    v2.noteWarehouse(record(1000 + i, 60000000 + i, 17470, 1), target(1000 + i, 60000000 + i, 17470, 1), true);
  }
  const view = v2.status();
  assert.equal(view.deliveries, 300);
  assert.ok(view.receipts.length <= 200, "receipts grew to " + view.receipts.length);
  assert.ok(Object.keys(view.stations).length <= 200, "stations grew to " + Object.keys(view.stations).length);
});

test("the first view after a restart is never smaller than the file", () => {
  const box = sandbox();
  const first = box.load();
  box.enable();
  first.noteWarehouse(record(51, 60000358, 17470, 300), target(51, 60000358, 17470, 300), true);
  assert.equal(first.status().stations[60000358][17470], 300);
  // A bare snapshot() (what the read-only probe prints) must hydrate by itself: building the view
  // before enabled() ran the station map empty, and status() then persisted that empty picture.
  const second = box.load();
  const raw = second.snapshot();
  assert.equal(raw.deliveries, 1, "a bare snapshot lost the delivery");
  assert.equal(raw.stations[60000358][17470], 300, "a bare snapshot lost the station total");
  const onDisk = JSON.parse(fs.readFileSync(box.stateFile, "utf8"));
  assert.equal(onDisk.stations[60000358][17470], 300, "the state file was rewritten with a smaller picture");
});

test("an unproven delivery is blocked, never proven", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  const before = v2.status().proofs;
  v2.noteWarehouse(record(41, 60000358), null, true);
  const after = v2.status();
  assert.equal(after.proofs.blocked, before.blocked + 1, "a missing physical stack was not blocked");
  assert.equal(after.proofs.proven, before.proven, "a missing physical stack was counted as proven");
});

test("a batch of receipts is on disk immediately, not after a throttle window", () => {
  const box = sandbox();
  const v2 = box.load();
  box.enable();
  // two receipts arrive together, as the warehouse writes them (25999 units and the 1-unit remainder)
  v2.noteWarehouse(record(61, 60000358, 17470, 25999), target(61, 60000358, 17470, 25999), true);
  v2.noteWarehouse(record(62, 60000358, 17470, 1), target(62, 60000358, 17470, 1), true);
  // the file must already hold BOTH: the state was throttled to one write per 2 seconds and a
  // restart inside that window dropped the second receipt (measured live: cargo 980200218463)
  const onDisk = JSON.parse(fs.readFileSync(box.stateFile, "utf8"));
  const ids = (onDisk.receipts || []).map((r) => r.cargoID).sort();
  assert.deepEqual(ids, [61, 62], "the second receipt of a batch was not on disk: " + JSON.stringify(ids));
  assert.equal(onDisk.deliveries, 2);
  assert.equal(onDisk.stations["60000358"]["17470"], 26000, "the station total lost the remainder");
});
