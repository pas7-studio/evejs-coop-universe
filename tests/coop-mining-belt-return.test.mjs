import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, "..");
const beltReturn = require(path.join(ROOT, "integration", "coopMiningBeltReturn.cjs"));

const AU = 149_597_870_700;
const NOW = 1_793_080_000_000;
function fleet() {
  return { fleetID: 960004609, systemID: 30000144, minerEntityIDs: [1], haulerEntityIDs: [] };
}
function ship(overrides = {}) {
  return { itemID: 1, kind: "ship", nativeNpc: true, mode: "STOP", radius: 40, position: { x: 4 * AU, y: 0, z: 0 }, ...overrides };
}
function rock() {
  return { itemID: 40000001, kind: "asteroid", radius: 1_500, position: { x: 0, y: 0, z: 0 } };
}
function harness({ entity = ship(), target = rock(), ack = { success: true } } = {}) {
  const calls = [];
  return {
    calls,
    run(extra = {}) {
      return beltReturn.ensure({ systemID: 30000144 }, fleet(), entity, target, {
        orbitDistanceMeters: 1_000,
        now: NOW,
        warp: (entityID, point, options) => { calls.push({ entityID, point, options }); return ack; },
        ...extra,
      });
    },
  };
}

test("a miner AU-scale from its rock really warps instead of following it", () => {
  process.env.EVEJS_COOP_MINING_BELT_RETURN = "1";
  beltReturn.reset();
  const probe = harness();
  assert.equal(probe.run(), true);
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0].entityID, 1);
  // The landing point is one rock radius plus one orbit radius from the centre,
  // never closer than the native minimum warp distance (5 km).
  const point = probe.calls[0].point;
  assert.equal(Math.round(Math.hypot(point.x, point.y, point.z)), 5_000);
  assert.equal(probe.calls[0].options.forceImmediateStart, true);
  assert.equal(probe.calls[0].options.ingressDurationMs, 2_500);
});

test("a miner already within the subwarp threshold is never warped", () => {
  process.env.EVEJS_COOP_MINING_BELT_RETURN = "1";
  beltReturn.reset();
  const probe = harness({ entity: ship({ position: { x: 50_000, y: 0, z: 0 } }) });
  assert.equal(probe.run(), false);
  assert.equal(probe.calls.length, 0);
});

test("a hull already flying a warp is left alone", () => {
  process.env.EVEJS_COOP_MINING_BELT_RETURN = "1";
  beltReturn.reset();
  for (const overrides of [
    { mode: "WARP" },
    { pendingWarp: true },
    { sessionlessWarpIngress: { targetPoint: { x: 1, y: 0, z: 0 } } },
    { warpState: { targetPoint: { x: 1, y: 0, z: 0 } } },
  ]) {
    const probe = harness({ entity: ship(overrides) });
    assert.equal(probe.run(), false, JSON.stringify(overrides));
    assert.equal(probe.calls.length, 0);
  }
});

test("the same rock is not re-ordered every tick", () => {
  process.env.EVEJS_COOP_MINING_BELT_RETURN = "1";
  beltReturn.reset();
  const probe = harness();
  assert.equal(probe.run(), true);
  assert.equal(probe.run({ now: NOW + 1_000 }), false);
  assert.equal(probe.calls.length, 1);
});

test("a rejected warp falls back to the stock order and reports why", () => {
  process.env.EVEJS_COOP_MINING_BELT_RETURN = "1";
  beltReturn.reset();
  const probe = harness({ ack: { success: false, errorMsg: "WARP_DISTANCE_TOO_CLOSE" } });
  assert.equal(probe.run(), false);
  assert.equal(probe.calls.length, 1);
});

test("the feature is OFF unless the flag is set", () => {
  delete process.env.EVEJS_COOP_MINING_BELT_RETURN;
  beltReturn.reset();
  const probe = harness();
  assert.equal(probe.run(), false);
  assert.equal(probe.calls.length, 0);
});

test("the landing point never collapses onto the rock", () => {
  const point = beltReturn.landingPoint({ x: 0, y: 0, z: 0 }, {
    position: { x: 0, y: 0, z: 0 }, radius: 0, orbitDistanceMeters: 0,
  });
  assert.ok(Math.hypot(point.x, point.y, point.z) >= 5_000);
});
