import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fork = process.env.EVEJS_FORK_ROOT;
if (!fork) throw new Error("EVEJS_FORK_ROOT must point at the EveJS checkout under test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "m001-wreck-loot-"));
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
const gameStore = require(path.join(fork, "Code/server/src/gameStore"));
const itemStore = require(path.join(fork, "Code/server/src/services/inventory/itemStore"));
const nativeNpcStore = require(path.join(fork, "Code/server/src/space/npc/nativeNpcStore"));
const wreckService = require(path.join(fork, "Code/server/src/space/npc/nativeNpcWreckService"));
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

test("full stack pickup moves the whole stack and removes the wreck source row", () => {
  const fixture = seedWreck(10, false);
  const result = pickup(fixture);
  assert.equal(result.success, true);
  assert.equal(result.data.quantity, 10);
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID), null);
  assert.equal(total(destination(fixture.characterID)), 10);
  assert.equal(result.data.changes[0].removed, true);
});

test("partial stack pickup preserves the exact conserved total", () => {
  const fixture = seedWreck(10, false);
  const result = pickup(fixture, { quantity: 4 });
  assert.equal(result.success, true);
  const sourceRow = nativeNpcStore.getNativeWreckItem(fixture.wreckItemID);
  assert.equal(sourceRow.quantity, 6);
  assert.equal(total(destination(fixture.characterID)), 4);
  assert.equal(6 + 4, 10);
  assert.equal(result.data.changes[0].removed, false);
  assert.equal(result.data.changes[0].previousData.quantity, 10);
  assert.equal(result.data.changes[0].item.quantity, 6);
});

test("singleton pickup grants one unit and removes the source row", () => {
  const fixture = seedWreck(1, true);
  const result = pickup(fixture);
  assert.equal(result.success, true);
  assert.equal(result.data.quantity, 1);
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID), null);
  const stack = destination(fixture.characterID);
  assert.equal(total(stack), 1);
  assert.ok(stack[0].singleton);
});

// BASELINE-BEHAVIOUR: a singleton row holds one unit, so an explicit request for more than one is
// refused with INSUFFICIENT_ITEMS instead of being clamped. Characterization only.
test("a singleton pickup that asks for more than one is refused", () => {
  const fixture = seedWreck(1, true);
  const result = pickup(fixture, { quantity: 50 });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INSUFFICIENT_ITEMS");
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity, 1);
  assert.equal(total(destination(fixture.characterID)), 0);
});

test("repeated pickup of the same wreck item cannot grant a second copy", () => {
  const fixture = seedWreck(5, false);
  const first = pickup(fixture);
  assert.equal(first.success, true);
  const second = pickup(fixture);
  assert.equal(second.success, false);
  assert.equal(second.errorMsg, "ITEM_NOT_FOUND");
  assert.equal(total(destination(fixture.characterID)), 5);
});

test("invalid ids are refused with ITEM_NOT_FOUND and change nothing", () => {
  const fixture = seedWreck(5, false);
  const calls = [
    { characterID: 0, wreckID: fixture.wreckID, wreckItemID: fixture.wreckItemID, destinationLocationID: STATION },
    { characterID: fixture.characterID, wreckID: 0, wreckItemID: fixture.wreckItemID, destinationLocationID: STATION },
    { characterID: fixture.characterID, wreckID: fixture.wreckID, wreckItemID: 0, destinationLocationID: STATION },
    { characterID: fixture.characterID, wreckID: fixture.wreckID, wreckItemID: fixture.wreckItemID, destinationLocationID: 0 },
  ];
  for (const call of calls) {
    const result = wreckService.transferNativeWreckItemToCharacterLocation(call);
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "ITEM_NOT_FOUND");
  }
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity, 5);
  assert.equal(total(destination(fixture.characterID)), 0);
});

test("a wreck item that belongs to another wreck is refused with ITEM_NOT_FOUND", () => {
  const a = seedWreck(5, false);
  const b = seedWreck(5, false);
  const result = wreckService.transferNativeWreckItemToCharacterLocation({
    characterID: b.characterID, wreckID: b.wreckID, wreckItemID: a.wreckItemID, destinationLocationID: STATION,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "ITEM_NOT_FOUND");
  assert.equal(nativeNpcStore.getNativeWreckItem(a.wreckItemID).quantity, 5);
  assert.equal(nativeNpcStore.getNativeWreckItem(b.wreckItemID).quantity, 5);
  assert.equal(total(destination(a.characterID)), 0);
  assert.equal(total(destination(b.characterID)), 0);
});

test("requesting more than the source holds is refused with INSUFFICIENT_ITEMS", () => {
  const fixture = seedWreck(3, false);
  const result = pickup(fixture, { quantity: 4 });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INSUFFICIENT_ITEMS");
  assert.equal(nativeNpcStore.getNativeWreckItem(fixture.wreckItemID).quantity, 3);
  assert.equal(total(destination(fixture.characterID)), 0);
});
