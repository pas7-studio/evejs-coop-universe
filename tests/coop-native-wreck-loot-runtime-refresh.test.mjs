import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fork = process.env.EVEJS_FORK_ROOT;
if (!fork) throw new Error("EVEJS_FORK_ROOT must point at the EveJS checkout under test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "m001-wreck-refresh-"));
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
const spaceRuntime = require(path.join(fork, "Code/server/src/space/runtime"));
const wreckService = require(path.join(fork, "Code/server/src/space/npc/nativeNpcWreckService"));
const STATION = 60003760;
const SYSTEM = 30000142;
let nextID = 1;

function seedWreck(quantity) {
  const n = nextID++;
  const characterID = 140000000 + n;
  const wreckID = 900000 + n;
  const wreckItemID = 910000 + n;
  gameStore.write("characters", String(characterID), { characterID, name: "Fixture Pilot " + n,
    shipID: 0, corporationID: 1000001, stationID: STATION, solarSystemID: SYSTEM });
  nativeNpcStore.upsertNativeWreck({ wreckID, systemID: SYSTEM, itemName: "Fixture Wreck",
    ownerID: 500001, typeID: 25, transient: false });
  nativeNpcStore.upsertNativeWreckItem({ wreckItemID, wreckID, typeID: 34, quantity,
    singleton: false, itemName: "Tritanium", ownerID: 500001, volume: 0.01 });
  return { characterID, wreckID, wreckItemID };
}

// A scene double for the runtime boundary: the service asks spaceRuntime for a scene and works with
// the entity it gets back, so this is the one object the test replaces. Stores stay real.
function withScene(entity, run) {
  const original = spaceRuntime.ensureScene;
  const broadcasts = [];
  const scene = {
    systemID: SYSTEM,
    getEntityByID(id) { return Number(id) === Number(entity.itemID) ? entity : null; },
    broadcastSlimItemChanges(list) { broadcasts.push(list.map((x) => x.itemID)); },
  };
  spaceRuntime.ensureScene = () => scene;
  try {
    const result = run(scene);
    return { result, broadcasts };
  } finally {
    spaceRuntime.ensureScene = original;
  }
}

test("refreshing a wreck with loot leaves the runtime entity non-empty and broadcasts once", () => {
  const fixture = seedWreck(3);
  const entity = { itemID: fixture.wreckID, isEmpty: false, itemName: "old" };
  const { result, broadcasts } = withScene(entity, () => {
    return wreckService.refreshNativeWreckRuntimeEntity(SYSTEM, fixture.wreckID, { broadcast: true });
  });
  assert.equal(result.success, true);
  assert.equal(result.data.entity.isEmpty, false);
  assert.equal(result.data.entity.itemName, "Fixture Wreck");
  assert.deepEqual(broadcasts, [[fixture.wreckID]]);
});

test("after the last unit is taken the refreshed runtime entity is empty", () => {
  const fixture = seedWreck(1);
  const entity = { itemID: fixture.wreckID, isEmpty: false, itemName: "Fixture Wreck" };
  const pickup = wreckService.transferNativeWreckItemToCharacterLocation({
    characterID: fixture.characterID, wreckID: fixture.wreckID,
    wreckItemID: fixture.wreckItemID, destinationLocationID: STATION });
  assert.equal(pickup.success, true);
  const { result, broadcasts } = withScene(entity, () => {
    return wreckService.refreshNativeWreckRuntimeEntity(SYSTEM, fixture.wreckID, { broadcast: true });
  });
  assert.equal(result.success, true);
  assert.equal(result.data.entity.isEmpty, true);
  assert.deepEqual(broadcasts, [[fixture.wreckID]]);
});

test("no broadcast happens when the caller does not ask for one", () => {
  const fixture = seedWreck(2);
  const entity = { itemID: fixture.wreckID, isEmpty: false, itemName: "Fixture Wreck" };
  const { result, broadcasts } = withScene(entity, () => {
    return wreckService.refreshNativeWreckRuntimeEntity(SYSTEM, fixture.wreckID, {});
  });
  assert.equal(result.success, true);
  assert.deepEqual(broadcasts, []);
});

test("a refresh for a wreck that is not in the scene reports WRECK_NOT_FOUND", () => {
  const fixture = seedWreck(2);
  const original = spaceRuntime.ensureScene;
  spaceRuntime.ensureScene = () => ({ systemID: SYSTEM, getEntityByID() { return null; },
    broadcastSlimItemChanges() {} });
  try {
    const result = wreckService.refreshNativeWreckRuntimeEntity(SYSTEM, fixture.wreckID, {});
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "WRECK_NOT_FOUND");
  } finally {
    spaceRuntime.ensureScene = original;
  }
});
