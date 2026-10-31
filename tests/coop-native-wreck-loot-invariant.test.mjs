import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fork = process.env.EVEJS_FORK_ROOT;
if (!fork) throw new Error("EVEJS_FORK_ROOT must point at the EveJS checkout under test");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "m002-invariant-"));
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
function seedWreck(quantity) {
  const n = nextID++;
  const characterID = 140000000 + n;
  const wreckID = 900000 + n;
  const wreckItemID = 910000 + n;
  gameStore.write("characters", String(characterID), { characterID, name: "Invariant Pilot " + n,
    shipID: 0, corporationID: 1000001, stationID: STATION, solarSystemID: 30000142 });
  nativeNpcStore.upsertNativeWreck({ wreckID, systemID: 30000142, itemName: "Invariant Wreck",
    ownerID: 500001, typeID: 25, transient: false });
  nativeNpcStore.upsertNativeWreckItem({ wreckItemID, wreckID, typeID: 34, quantity,
    singleton: false, itemName: "Tritanium", ownerID: 500001, volume: 0.01 });
  return { characterID, wreckID, wreckItemID };
}
function destinationTotal(characterID) {
  return Object.values(itemStore.getAllItems())
    .filter((i) => Number(i.locationID) === STATION && Number(i.ownerID) === characterID)
    .reduce((n, i) => n + (Number(i.quantity) > 0 ? Number(i.quantity) : 1), 0);
}
function wreckTotal(wreckItemID) {
  const row = nativeNpcStore.getNativeWreckItem(wreckItemID);
  return row ? Number(row.quantity) : 0;
}
function pickup(fixture, extra = {}) {
  return wreckService.transferNativeWreckItemToCharacterLocation({
    characterID: fixture.characterID, wreckID: fixture.wreckID,
    wreckItemID: fixture.wreckItemID, destinationLocationID: STATION, ...extra });
}
function withFault(target, name, replacement, run) {
  const original = target[name];
  target[name] = replacement;
  try { return run(); } finally { target[name] = original; }
}
function conserved(fixture) {
  return wreckTotal(fixture.wreckItemID) + destinationTotal(fixture.characterID);
}

test("a failed wreck-source removal must not duplicate units", () => {
  const fixture = seedWreck(3);
  const result = withFault(nativeNpcStore, "removeNativeWreckItem",
    () => ({ success: false, errorMsg: "SIMULATED_REMOVE_FAILURE" }),
    () => pickup(fixture));
  assert.equal(result.success, false);
  // INVARIANT: Q_wreck + Q_inventory must equal Q_before; a failed source debit may
  // not leave the units in both places.
  assert.equal(conserved(fixture), 3);
});

test("a thrown wreck-source removal must not duplicate units", () => {
  const fixture = seedWreck(3);
  const result = withFault(nativeNpcStore, "removeNativeWreckItem",
    () => { throw new Error("SIMULATED_THROW"); },
    () => pickup(fixture));
  assert.equal(result.success, false);
  // INVARIANT: Q_wreck + Q_inventory must equal Q_before; a failed source debit may
  // not leave the units in both places.
  assert.equal(conserved(fixture), 3);
});

test("a failed partial decrement must not duplicate units", () => {
  const fixture = seedWreck(4);
  const result = withFault(nativeNpcStore, "upsertNativeWreckItem",
    () => ({ success: false, errorMsg: "SIMULATED_UPSERT_FAILURE" }),
    () => pickup(fixture, { quantity: 2 }));
  assert.equal(result.success, false);
  // INVARIANT: Q_wreck + Q_inventory must equal Q_before; a failed source debit may
  // not leave the units in both places.
  assert.equal(conserved(fixture), 4);
});

test("a failed destination grant must not lose units", () => {
  const fixture = seedWreck(3);
  const result = pickup(fixture, { characterID: 999999999 });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "CHARACTER_NOT_FOUND");
  // INVARIANT: Q_wreck + Q_inventory must equal Q_before; a failed destination credit
  // may not consume the units from the source.
  assert.equal(conserved(fixture), 3);
});

test("two competing pickups of one wreck item grant it once", () => {
  const fixture = seedWreck(5);
  const first = pickup(fixture);
  const second = pickup(fixture);
  assert.equal(first.success, true);
  assert.equal(second.success, false);
  assert.equal(destinationTotal(fixture.characterID), 5);
  // INVARIANT: Q_wreck + Q_inventory must equal Q_before; a second pickup of an already
  // granted item must not grant it a second time.
  assert.equal(conserved(fixture), 5);
});
