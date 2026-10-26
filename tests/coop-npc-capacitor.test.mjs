import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { refill, topUp } = require("../integration/coopNpcCapacitor.cjs");

function sceneWith(...entities) {
  const byID = new Map(entities.map((e) => [e.itemID, e]));
  return { getEntityByID: (id) => byID.get(Number(id)) || null };
}

function npc(overrides = {}) {
  return { kind: "ship", itemID: 900, nativeNpc: true, capacitorCapacity: 400, capacitorChargeRatio: 0.2, ...overrides };
}

function withFlag(fn) {
  const previous = process.env.EVEJS_COOP_NPC_CAPACITOR;
  process.env.EVEJS_COOP_NPC_CAPACITOR = "1";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_NPC_CAPACITOR;
    else process.env.EVEJS_COOP_NPC_CAPACITOR = previous;
  }
}

test("the fix does nothing unless the feature flag is on", () => {
  const ship = npc();
  delete process.env.EVEJS_COOP_NPC_CAPACITOR;
  assert.equal(topUp(ship), false);
  assert.equal(ship.capacitorChargeRatio, 0.2);
});

test("an idle native NPC is topped up at its behaviour think", () => {
  withFlag(() => {
    const ship = npc();
    assert.equal(refill(sceneWith(ship), { entityID: 900 }), true);
    assert.equal(ship.capacitorChargeRatio, 1);
  });
});

test("a ship running its own modules is not topped up by the behaviour think", () => {
  withFlag(() => {
    const ship = npc({ activeModuleEffects: new Map([[1, { moduleID: 1 }]]) });
    assert.equal(refill(sceneWith(ship), { entityID: 900 }), false);
    assert.equal(ship.capacitorChargeRatio, 0.2);
  });
});

test("the mining loop may top up a ship it is about to start a module on", () => {
  withFlag(() => {
    const ship = npc({ activeModuleEffects: new Map([[1, { moduleID: 1 }]]) });
    assert.equal(topUp(ship), true);
    assert.equal(ship.capacitorChargeRatio, 1);
  });
});

test("a full capacitor is not rewritten", () => {
  withFlag(() => {
    assert.equal(topUp(npc({ capacitorChargeRatio: 1 })), false);
  });
});

test("a real player ship is never touched", () => {
  withFlag(() => {
    const ship = npc({ session: { characterID: 1 }, capacitorChargeRatio: 0 });
    assert.equal(topUp(ship), false);
    assert.equal(ship.capacitorChargeRatio, 0);
  });
});

test("a non-native or capless entity is not topped up", () => {
  withFlag(() => {
    assert.equal(topUp(npc({ nativeNpc: false })), false);
    assert.equal(topUp(npc({ capacitorCapacity: 0 })), false);
  });
});

test("condition state charge is kept in sync when it exists", () => {
  withFlag(() => {
    const ship = npc({ conditionState: { charge: 0.2 } });
    assert.equal(topUp(ship), true);
    assert.equal(ship.conditionState.charge, 1);
  });
});
