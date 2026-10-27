// FW-030 guard: a mustered assault whose fleets sit outside real gun range must
// produce exactly one real native warp to a standoff point beside the nearest
// opposing war ship - never a spawn, a teleport, a scripted hit or a duplicate
// order while the previous warp is still cooling down. Inside the last leg the
// native attack order's own movement flies the hull in, so no manual orbit order
// is issued (that would block the war director with manualBusy).
import test from "node:test";
import assert from "node:assert/strict";
import { createWarEngagementWarp, enabled } from "../integration/coopWarEngagementWarp.cjs";

const ON = { EVEJS_COOP_WAR_ENGAGE_WARP: "1" };

function world({ ships, positions, controllers = {} }) {
  const scene = {
    systemID: 30045344,
    getEntityByID: id => positions[id]
      ? { kind: "ship", itemID: id, nativeNpc: true, mode: "STOP", position: positions[id] }
      : null,
  };
  return {
    scene,
    readWarState: () => ({
      version: 1,
      wars: {
        "war:a-b": {
          warID: "war:a-b", state: "ACTIVE",
          attackerFactionID: 500001, defenderFactionID: 500004,
        },
      },
      campaigns: {
        c1: { campaignID: "c1", warID: "war:a-b", state: "ASSAULT", targetSystemID: 30045344 },
      },
    }),
    registry: { snapshot: () => ({ ships }) },
    sceneForSystem: () => scene,
    getController: id => controllers[id] || { entityID: id, systemID: 30045344 },
  };
}

const PAIR = {
  ships: {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  },
};

test("warps the attacker to a standoff point beside the nearest enemy", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({ ...PAIR, positions }),
    warpToPoint: (id, point) => { calls.push({ id, point }); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(out.status, "WARP_ORDERED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 1);
  // Lands 50 km short of the enemy; the attack order flies the last leg in.
  assert.deepEqual(calls[0].point, { x: 850000, y: 0, z: 0 });
  assert.equal(out.orders[0].status, "NATIVE_WARP_STARTED");
  assert.equal(out.orders[0].targetID, 2);
  assert.equal(out.orders[0].distanceMeters, 900000);
});

test("never warps inside the last leg a native warp refuses anyway", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 120000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({ ...PAIR, positions }),
    warpToPoint: () => { calls.push(1); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(out.orders.length, 0);
  assert.equal(calls.length, 0);
});

test("cooldown prevents a second warp while the first is still running", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  let now = 1000;
  const warp = createWarEngagementWarp({
    ...world({ ...PAIR, positions }),
    warpToPoint: () => { calls.push(now); return { success: true }; },
    env: ON,
    clock: () => now,
    cooldownMs: 60000,
  });
  warp.tick({ systemIDs: [30045344] });
  now = 30000;
  warp.tick({ systemIDs: [30045344] });
  assert.equal(calls.length, 1);
  now = 62000;
  warp.tick({ systemIDs: [30045344] });
  assert.equal(calls.length, 2);
});

test("a ship that already has a live target is left to the native loop", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({
      ...PAIR, positions,
      controllers: { 1: { entityID: 1, systemID: 30045344, currentTargetID: 2 } },
    }),
    warpToPoint: () => { calls.push(1); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(calls.length, 0);
  assert.equal(out.orders.length, 0);
});

test("a hull with an accepted attack order but no target also closes", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({
      ...PAIR, positions,
      controllers: {
        1: { entityID: 1, systemID: 30045344, currentTargetID: 0, manualOrder: { type: "attack", targetID: 2 } },
      },
    }),
    warpToPoint: (id) => { calls.push(id); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.deepEqual(calls, [1]);
  assert.equal(out.orders[0].entityID, 1);
});

test("a side of several hulls warps together in formation with one native batch", () => {
  const batch = [];
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    3: { entityID: 3, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    9: { entityID: 9, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  };
  const positions = {
    1: { x: 0, y: 0, z: 0 },
    2: { x: 2000, y: 0, z: 0 },
    3: { x: 0, y: 2000, z: 0 },
    9: { x: 900000, y: 0, z: 0 },
  };
  const warp = createWarEngagementWarp({
    ...world({ ships, positions }),
    warpToPoint: () => { throw new Error("a fleet must not warp one hull at a time"); },
    warpBatchToPoints: (requests) => { batch.push(requests); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(out.status, "WARP_ORDERED");
  assert.equal(batch.length, 1);
  assert.equal(batch[0].length, 3);
  const points = batch[0].map(r => r.point);
  // Three distinct formation points, all near the standoff anchor, none equal.
  const keys = new Set(points.map(p => `${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.z)}`));
  assert.equal(keys.size, 3);
  for (const p of points) assert.ok(Math.hypot(p.x - 850000, p.y, p.z) < 3000);
  assert.deepEqual(out.orders.map(o => o.status),
    ["NATIVE_FORMATION_WARP_STARTED", "NATIVE_FORMATION_WARP_STARTED", "NATIVE_FORMATION_WARP_STARTED"]);
  assert.equal(out.orders[0].formation, 3);
});

test("a lone hull still warps on its own", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({ ...PAIR, positions }),
    warpToPoint: (id) => { calls.push(id); return { success: true }; },
    warpBatchToPoints: () => { throw new Error("no batch for one hull"); },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.deepEqual(calls, [1]);
  assert.equal(out.orders[0].status, "NATIVE_WARP_STARTED");
});

test("flag OFF is inert and a refused native warp is reported as refused", () => {
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const authority = world({ ...PAIR, positions });
  const off = createWarEngagementWarp({
    ...authority, warpToPoint: () => ({ success: true }), env: {}, clock: () => 1000,
  });
  assert.equal(off.tick({ systemIDs: [30045344] }).status, "DISABLED");
  const refused = createWarEngagementWarp({
    ...authority,
    warpToPoint: () => ({ success: false, errorMsg: "NOT_ENOUGH_CAPACITOR" }),
    env: ON, clock: () => 1000,
  });
  const out = refused.tick({ systemIDs: [30045344] });
  assert.equal(out.orders[0].status, "NOT_ENOUGH_CAPACITOR");
});

test("the defender never warps and a missing attacker faction is reported", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const base = world({ ...PAIR, positions });
  const defenderOnly = createWarEngagementWarp({
    ...base,
    registry: { snapshot: () => ({ ships: { 2: PAIR.ships[2] } }) },
    warpToPoint: () => { calls.push(1); return { success: true }; },
    env: ON, clock: () => 1000,
  });
  assert.equal(defenderOnly.tick({ systemIDs: [30045344] }).orders.length, 0);
  assert.equal(calls.length, 0);
  const noAttacker = createWarEngagementWarp({
    ...base,
    readWarState: () => ({
      version: 1,
      wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE" } },
      campaigns: base.readWarState().campaigns,
    }),
    warpToPoint: () => ({ success: true }),
    env: ON, clock: () => 1000,
  });
  const out = noAttacker.tick({ systemIDs: [30045344] });
  assert.equal(out.orders.length, 0);
  assert.equal(out.skips[0].reason, "NO_ATTACKER_FACTION");
});

test("enabled() only accepts the explicit flag and authorities are required", () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ EVEJS_COOP_WAR_ENGAGE_WARP: "true" }), false);
  assert.equal(enabled(ON), true);
  assert.throws(() => createWarEngagementWarp({}), /WAR_ENGAGEMENT_WARP_AUTHORITIES_REQUIRED/);
});
