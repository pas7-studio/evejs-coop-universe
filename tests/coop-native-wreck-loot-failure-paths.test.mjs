import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fork = process.env.EVEJS_FORK_ROOT;
if (!fork) throw new Error("EVEJS_FORK_ROOT must point at the EveJS checkout under test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "m001-wreck-failure-"));
fs.cpSync(path.join(fork, "Code/server/src/gameStore/data"), path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, ".evejs-test-store-attestation.json"), JSON.stringify({
  schemaVersion: 1, kind: "evejs-test-store",
  createdBy: "server/tests/helpers/isolatedGameStore.js",
  storeRoot: fs.realpathSync(root), dataDir: fs.realpathSync(path.join(root, "data")),
}));
process.env.EVEJS_TEST_STORE_ISOLATED = "1";
process.env.EVEJS_TEST_STORE_ROOT = root;
process.env.EVEJS_GAMESTORE_DATA_DIR = path.join(root, "data");
for (const key of ["EVEJS_COOP_NPC_EXPEDITION_WRECK", "EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER",
  "EVEJS_COOP_NATIVE_LOOT_QUARANTINE", "EVEJS_COOP_PVE_BOSS_LOOT_FENCE",
  "EVEJS_COOP_NATIVE_LOOT_EVIDENCE"]) delete process.env[key];
process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE_FILE = path.join(root, "coop-native-loot-quarantine.json");
const gameStore = require(path.join(fork, "Code/server/src/gameStore"));
const itemStore = require(path.join(fork, "Code/server/src/services/inventory/itemStore"));
const nativeNpcStore = require(path.join(fork, "Code/server/src/space/npc/nativeNpcStore"));
const wreckService = require(path.join(fork, "Code/server/src/space/npc/nativeNpcWreckService"));
const lootQuarantine = require(path.join(fork, "Code/server/src/space/coopNativeLootQuarantine.js"));
const STATION = 60003760;
let nextID = 1;
function seedWreck(quantity, singleton) {
  const n = nextID++;
  const characterID = 140000000 + n;
  const wreckID = 900000 + n;
  const wreckItemID = 910000 + n;
  gameStore.write("characters", String(characterID), { characterID, name: "Fixture Pilot " + n,
    shipID: 0, corporationID: 1000001, stationID: STATION, solarSystemID: 30000142 });
  nativeNpcStore.upsertNativeWreck({ wreckID, systemID: 30000142, itemName: "Wreck",
    ownerID: 500001, typeID: 25, transient: false });
  nativeNpcStore.upsertNativeWreckItem({ wreckItemID, wreckID, typeID: 34, quantity,
    singleton, itemName: "Tritanium", ownerID: 500001, volume: 0.01 });
  return { characterID, wreckID, wreckItemID };
}
function destination(characterID) {
  return Object.values(itemStore.getAllItems()).filter((item) =>
    item.locationID === STATION && item.ownerID === characterID);
}
function pickup(fixture, extra = {}) {
  return wreckService.transferNativeWreckItemToCharacterLocation({
    characterID: fixture.characterID, wreckID: fixture.wreckID,
    wreckItemID: fixture.wreckItemID, destinationLocationID: STATION, ...extra });
}
function total(stack) {
  return stack.reduce((sum, item) => sum + (item.quantity > 0 ? item.quantity : 1), 0);
}

test("a granted inventory failure is returned and the wreck source is untouched", () => {
  const fixture = seedWreck(3, false);
  const result = wreckService.transferNativeWreckItemToCharacterLocation({
    characterID: 999999999, wreckID: fixture.wreckID, wreckItemID: fixture.wreckItemID,
    destinationLocationID: STATION });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "CHARACTER_NOT_FOUND");
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity, 3);
  assert.equal(total(destination(fixture.characterID)), 0);
});

test("the destination grant happens before the wreck source row is removed", () => {
  const fixture = seedWreck(5, false);
  const originalRemove = nativeNpcStore.removeNativeWreckItem;
  let observed = null;
  nativeNpcStore.removeNativeWreckItem = (id) => {
    observed = { atRemoval: total(destination(fixture.characterID)),
      sourceStillThere: nativeNpcStore.getNativeWreckItem(fixture.wreckItemID) !== null };
    return originalRemove(id);
  };
  try { pickup(fixture); } finally { nativeNpcStore.removeNativeWreckItem = originalRemove; }
  // CHARACTERIZATION: the destination grant is committed before the source row is removed,
  // so this sequence is not atomic.
  assert.equal(observed.atRemoval, 5);
  assert.equal(observed.sourceStillThere, true);
});

// BASELINE-DEFECT (pre-existing; this refactor preserves it and must not fix it): the destination
// grant is committed before the source update, and removeNativeWreckItem's result is not checked,
// so a failing source store leaves the same units in the wreck and in the character's inventory
// while the call reports success. Recorded here so the behaviour cannot change silently; the
// separately reviewed fix is proposed in its own change, not in this refactor.
test("a failing source store duplicates the granted units and still reports success", () => {
  const fixture = seedWreck(4, false);
  const originalRemove = nativeNpcStore.removeNativeWreckItem;
  nativeNpcStore.removeNativeWreckItem = () => ({ success: false, errorMsg: "SIMULATED_SOURCE_FAILURE" });
  let result;
  try {
    result = pickup(fixture);
  } finally {
    nativeNpcStore.removeNativeWreckItem = originalRemove;
  }
  assert.equal(result.success, true);
  assert.equal(result.data.quantity, 4);
  assert.equal(result.data.changes[0].removed, true);
  const granted = total(destination(fixture.characterID));
  const stillInWreck = nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity;
  assert.equal(granted, 4);
  assert.equal(stillInWreck, 4);
  assert.equal(granted + stillInWreck, 8);
});

test("the native loot quarantine flag is consulted when it is enabled", () => {
  const fixture = seedWreck(2, false);
  const previous = process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE;
  process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE = "1";
  try {
    const allowed = pickup(fixture, { quantity: 1 });
    assert.equal(allowed.success, true);
    lootQuarantine.quarantine({ wreckID: fixture.wreckID, wreckItemID: fixture.wreckItemID,
      reason: "NATIVE_LOOT_SOURCE_NOT_REMOVED" });
    const refused = pickup(fixture, { quantity: 1 });
    assert.equal(refused.success, false);
    assert.equal(refused.errorMsg, "COOP_LOOT_QUARANTINED");
    assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity, 1);
    assert.equal(total(destination(fixture.characterID)), 1);
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE;
    else process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE = previous;
  }
});
