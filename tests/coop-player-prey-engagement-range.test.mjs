import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Measured live 2026-11-02 in Jita: three pirates 5.95e12 m away held real attack orders on the player and
// warped onto his undock point, so every login and every undock met the same three hulls at 3-8 km. A real
// order is still not permission to fight somebody on the other side of the system.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { allowsPlayerPrey } = require(
  path.join(forkRoot, "Code/server/src/space/coopPlayerPreyHostility.js"),
);

const NOW = Date.UTC(2026, 10, 2, 23, 30, 0);
const ENV = { EVEJS_COOP_PIRATE_PREY_PLAYERS: "1", EVEJS_COOP_PIRATE_PREY_HIGHSEC: "1" };

function verdict({ sourceAt, targetAt, env = ENV }) {
  const source = { itemID: 980000142453, kind: "ship", nativeNpc: true, position: sourceAt };
  const target = {
    itemID: 9988400120641,
    kind: "ship",
    position: targetAt,
    session: { characterID: 140000005 },
  };
  return allowsPlayerPrey(source, target, {
    env,
    nowMs: NOW,
    probe: false,
    registry: {
      getControllerByEntityID: () => ({
        entityID: source.itemID,
        manualOrder: { type: "attack", targetID: target.itemID },
        lastAggressorID: 0,
        lastAggressedAtMs: 0,
      }),
    },
    safety: { blocksAggression: () => false },
  });
}

test("an order does not make a player three billion kilometres away a legal target", () => {
  assert.equal(verdict({ sourceAt: { x: 0, y: 0, z: 0 }, targetAt: { x: 5.95e12, y: 0, z: 0 } }), false);
});

test("a player right next to the hull is still fought", () => {
  assert.equal(verdict({ sourceAt: { x: 0, y: 0, z: 0 }, targetAt: { x: 8300, y: 0, z: 0 } }), true);
});

test("an operator can widen the envelope explicitly", () => {
  assert.equal(
    verdict({
      sourceAt: { x: 0, y: 0, z: 0 },
      targetAt: { x: 5.95e12, y: 0, z: 0 },
      env: { ...ENV, EVEJS_COOP_PIRATE_PREY_RANGE_METERS: "6e12" },
    }),
    true,
  );
});

test("without positions the old verdict is preserved", () => {
  assert.equal(verdict({ sourceAt: undefined, targetAt: undefined }), true);
});

test("a pirate opens fire on whoever comes into its own engagement range", () => {
  // Real EVE rats do not wait for a director script: they aggro the hull that enters their site.
  const source = { itemID: 980000142453, kind: "ship", nativeNpc: true, position: { x: 0, y: 0, z: 0 } };
  const target = {
    itemID: 9988400120641,
    kind: "ship",
    position: { x: 40000, y: 0, z: 0 },
    session: { characterID: 140000005 },
  };
  assert.equal(
    allowsPlayerPrey(source, target, {
      env: ENV,
      nowMs: NOW,
      probe: false,
      registry: {
        getControllerByEntityID: () => ({
          entityID: source.itemID,
          manualOrder: null,
          lastAggressorID: 0,
          lastAggressedAtMs: 0,
        }),
      },
      safety: { blocksAggression: () => false },
    }),
    true,
  );
});

test("proximity aggro can be switched off explicitly", () => {
  const source = { itemID: 980000142453, kind: "ship", nativeNpc: true, position: { x: 0, y: 0, z: 0 } };
  const target = {
    itemID: 9988400120641,
    kind: "ship",
    position: { x: 40000, y: 0, z: 0 },
    session: { characterID: 140000005 },
  };
  assert.equal(
    allowsPlayerPrey(source, target, {
      env: { ...ENV, EVEJS_COOP_NPC_PROXIMITY_AGGRO: "0" },
      nowMs: NOW,
      probe: false,
      registry: { getControllerByEntityID: () => ({ entityID: source.itemID, manualOrder: null, lastAggressorID: 0, lastAggressedAtMs: 0 }) },
      safety: { blocksAggression: () => false },
    }),
    false,
  );
});
