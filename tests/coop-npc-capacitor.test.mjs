import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { refill } = require("../integration/coopNpcCapacitor.cjs");

function sceneWith(...entities) {
  const byID = new Map(entities.map((e) => [e.itemID, e]));
  return { getEntityByID: (id) => byID.get(Number(id)) || null };
}

function npc(overrides = {}) {
  return { kind: "ship", itemID: 900, nativeNpc: true, capacitorCapacity: 500, capacitorChargeRatio: 0, ...overrides };
}

test("a drained native NPC miner gets its capacitor back at the next think", () => {
  const ship = npc();
  assert.equal(refill(sceneWith(ship), { entityID: 900 }), true);
  assert.equal(ship.capacitorChargeRatio, 1);
  assert.equal(ship.conditionState, undefined, "no condition state is invented");
});

test("a charged NPC is left alone", () => {
  const ship = npc({ capacitorChargeRatio: 0.6 });
  assert.equal(refill(sceneWith(ship), { entityID: 900 }), false);
  assert.equal(ship.capacitorChargeRatio, 0.6);
});

test("a real player ship is never touched", () => {
  const ship = npc({ session: { characterID: 1 } });
  assert.equal(refill(sceneWith(ship), { entityID: 900 }), false);
  assert.equal(ship.capacitorChargeRatio, 0);
});

test("a non-native or capless entity is not refilled", () => {
  assert.equal(refill(sceneWith(npc({ nativeNpc: false })), { entityID: 900 }), false);
  assert.equal(refill(sceneWith(npc({ capacitorCapacity: 0 })), { entityID: 900 }), false);
});

test("condition state charge is kept in sync when it exists", () => {
  const ship = npc({ conditionState: { charge: 0 } });
  assert.equal(refill(sceneWith(ship), { entityID: 900 }), true);
  assert.equal(ship.conditionState.charge, 1);
});

test("a missing controller or entity is a no-op", () => {
  assert.equal(refill(null, { entityID: 900 }), false);
  assert.equal(refill(sceneWith(), { entityID: 900 }), false);
  assert.equal(refill(sceneWith(npc()), { entityID: 0 }), false);
});
