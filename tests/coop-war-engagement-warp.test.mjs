// FW-030 guard: a mustered assault whose fleets sit outside real gun range must
// produce exactly one real native warp to a standoff point beside the nearest
// opposing war ship - never a spawn, a teleport, a scripted hit or a duplicate
// order while the previous warp is still cooling down.
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
  // Lands 1 km short of the enemy, inside real autocannon range.
  assert.deepEqual(calls[0].point, { x: 899000, y: 0, z: 0 });
  assert.equal(out.orders[0].status, "NATIVE_WARP_STARTED");
  assert.equal(out.orders[0].targetID, 2);
  assert.equal(out.orders[0].distanceMeters, 900000);
});

test("never warps a hull that is already inside gun range", () => {
  const calls = [];
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 2000, y: 0, z: 0 } };
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

test("a ship already fighting, warping or owned by a manual order is left alone", () => {
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
