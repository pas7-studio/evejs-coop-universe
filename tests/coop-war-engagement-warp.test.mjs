// FW-030 guard: a mustered assault whose fleets sit outside the native 250 km
// engagement range must produce exactly one real native warp to the nearest
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
      wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE", attackerFactionID: 500001, defenderFactionID: 500004 } },
      campaigns: {
        c1: { campaignID: "c1", warID: "war:a-b", state: "ASSAULT", targetSystemID: 30045344 },
      },
    }),
    registry: { snapshot: () => ({ ships }) },
    sceneForSystem: () => scene,
    getController: id => controllers[id] || { entityID: id, systemID: 30045344 },
  };
}

test("warps an idle war ship at the nearest enemy when the fleets are AU apart", () => {
  const warpCalls = [];
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1", pilotID: "coop-pilot-001" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1", pilotID: "coop-pilot-002" },
    3: { entityID: 3, systemID: 30045344, factionID: 500004, campaignID: "c1", pilotID: "coop-pilot-003" },
  };
  const positions = {
    1: { x: 0, y: 0, z: 0 },
    2: { x: 900000, y: 0, z: 0 },
    3: { x: 1200000, y: 0, z: 0 },
  };
  const authority = world({ ships, positions });
  const warp = createWarEngagementWarp({
    ...authority,
    warpToEntity: (id, targetID) => { warpCalls.push({ id, targetID }); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(out.status, "WARP_ORDERED");
  assert.deepEqual(warpCalls, [{ id: 1, targetID: 2 }]);
  assert.equal(out.orders[0].status, "NATIVE_WARP_STARTED");
  assert.equal(out.orders[0].distanceMeters, 900000);
});

test("never warps inside the native firing envelope and never spawns", () => {
  const warpCalls = [];
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  };
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 120000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({ ships, positions }),
    warpToEntity: () => { warpCalls.push(1); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(out.orders.length, 0);
  assert.equal(warpCalls.length, 0);
});

test("cooldown prevents a second warp while the first is still running", () => {
  const warpCalls = [];
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  };
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  let now = 1000;
  const warp = createWarEngagementWarp({
    ...world({ ships, positions }),
    warpToEntity: () => { warpCalls.push(now); return { success: true }; },
    env: ON,
    clock: () => now,
    cooldownMs: 60000,
  });
  warp.tick({ systemIDs: [30045344] });
  now = 30000;
  warp.tick({ systemIDs: [30045344] });
  assert.equal(warpCalls.length, 1);
  now = 62000;
  warp.tick({ systemIDs: [30045344] });
  assert.equal(warpCalls.length, 2);
});

test("a ship already fighting, warping or owned by a manual order is left alone", () => {
  const warpCalls = [];
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  };
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const warp = createWarEngagementWarp({
    ...world({
      ships, positions,
      controllers: { 1: { entityID: 1, systemID: 30045344, currentTargetID: 2 } },
    }),
    warpToEntity: () => { warpCalls.push(1); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = warp.tick({ systemIDs: [30045344] });
  assert.equal(warpCalls.length, 0);
  assert.equal(out.orders.length, 0);
});

test("flag OFF is inert and a refused native warp is reported as refused", () => {
  const ships = {
    1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
    2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
  };
  const positions = { 1: { x: 0, y: 0, z: 0 }, 2: { x: 900000, y: 0, z: 0 } };
  const authority = world({ ships, positions });
  const off = createWarEngagementWarp({
    ...authority, warpToEntity: () => ({ success: true }), env: {}, clock: () => 1000,
  });
  assert.equal(off.tick({ systemIDs: [30045344] }).status, "DISABLED");
  const refused = createWarEngagementWarp({
    ...authority,
    warpToEntity: () => ({ success: false, errorMsg: "NOT_ENOUGH_CAPACITOR" }),
    env: ON, clock: () => 1000,
  });
  const out = refused.tick({ systemIDs: [30045344] });
  assert.equal(out.orders[0].status, "NOT_ENOUGH_CAPACITOR");
});

test("enabled() only accepts the explicit flag and authorities are required", () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ EVEJS_COOP_WAR_ENGAGE_WARP: "true" }), false);
  assert.equal(enabled(ON), true);
  assert.throws(() => createWarEngagementWarp({}), /WAR_ENGAGEMENT_WARP_AUTHORITIES_REQUIRED/);
});
