// FW-031 guard: a war hull spawned at a belt anchor is 150 km from home with a
// 90 km native leash, so the behaviour loop cleared its combat state on every
// think and an accepted attack order never became a target. The posture module
// clears that leash through the native behaviour overrides and sets an orbit
// inside the real gun range - without spawning, damaging or inventing a kill.
import test from "node:test";
import assert from "node:assert/strict";
import { createWarEngagementPosture, enabled } from "../integration/coopWarEngagementPosture.cjs";

const ON = { EVEJS_COOP_WAR_ENGAGEMENT_POSTURE: "1" };

function world({ ships, controllers = {} }) {
  return {
    readWarState: () => ({
      version: 1,
      wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE" } },
      campaigns: {
        c1: { campaignID: "c1", warID: "war:a-b", state: "ASSAULT", targetSystemID: 30045344 },
      },
    }),
    registry: { snapshot: () => ({ ships }) },
    getController: id => controllers[id] || { entityID: id, systemID: 30045344 },
  };
}

const SHIPS = {
  1: { entityID: 1, systemID: 30045344, factionID: 500001, campaignID: "c1" },
  2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
};

test("clears the leash and sets a gun-range orbit for a war hull in the assault system", () => {
  const calls = [];
  const posture = createWarEngagementPosture({
    ...world({ ships: SHIPS }),
    setBehaviorOverrides: (id, overrides) => { calls.push({ id, overrides }); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = posture.tick();
  assert.equal(out.status, "POSTURE_APPLIED");
  assert.deepEqual(calls.map(c => c.id), [1, 2]);
  assert.deepEqual(calls[0].overrides, { movementMode: "orbit", leashRangeMeters: 0, orbitDistanceMeters: 500 });
  assert.equal(out.applied[0].status, "NATIVE_POSTURE_APPLIED");
  assert.equal(out.applied[0].systemID, 30045344);
});

test("keeps every other override the hull already carries", () => {
  const calls = [];
  const posture = createWarEngagementPosture({
    ...world({
      ships: SHIPS,
      controllers: {
        1: { entityID: 1, systemID: 30045344, behaviorOverrides: { aggressionRangeMeters: 250000 } },
      },
    }),
    setBehaviorOverrides: (id, overrides) => { calls.push({ id, overrides }); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  posture.tick();
  assert.deepEqual(calls[0].overrides, { aggressionRangeMeters: 250000, movementMode: "orbit", leashRangeMeters: 0, orbitDistanceMeters: 500 });
});

test("is idempotent: the same posture is never re-applied", () => {
  const calls = [];
  const controllers = {
    1: { entityID: 1, systemID: 30045344, behaviorOverrides: { movementMode: "orbit", leashRangeMeters: 0, orbitDistanceMeters: 500 } },
    2: { entityID: 2, systemID: 30045344, behaviorOverrides: { movementMode: "orbit", leashRangeMeters: 0, orbitDistanceMeters: 500 } },
  };
  const posture = createWarEngagementPosture({
    ...world({ ships: SHIPS, controllers }),
    setBehaviorOverrides: () => { calls.push(1); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = posture.tick();
  assert.equal(calls.length, 0);
  assert.equal(out.status, "NO_CHANGE");
});

test("ignores a hull outside the assault system and reports a missing controller", () => {
  const calls = [];
  const posture = createWarEngagementPosture({
    ...world({
      ships: {
        1: { entityID: 1, systemID: 30000142, factionID: 500001, campaignID: "c1" },
        2: { entityID: 2, systemID: 30045344, factionID: 500004, campaignID: "c1" },
      },
      controllers: { 2: { entityID: 2, systemID: 30000142 } },
    }),
    setBehaviorOverrides: (id) => { calls.push(id); return { success: true }; },
    env: ON,
    clock: () => 1000,
  });
  const out = posture.tick();
  assert.equal(calls.length, 0);
  assert.equal(out.status, "NO_CHANGE");
  assert.equal(out.skips[0].reason, "NO_NATIVE_CONTROLLER");
});

test("no active assault is a clean no-op", () => {
  const posture = createWarEngagementPosture({
    ...world({ ships: SHIPS }),
    readWarState: () => ({
      version: 1,
      wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE" } },
      campaigns: { c1: { campaignID: "c1", warID: "war:a-b", state: "PREPARING", targetSystemID: 30045344 } },
    }),
    setBehaviorOverrides: () => ({ success: true }),
    env: ON,
    clock: () => 1000,
  });
  assert.equal(posture.tick().status, "NO_ASSAULT");
});

test("flag OFF is inert and a refused native call is reported as refused", () => {
  const authority = world({ ships: SHIPS });
  const off = createWarEngagementPosture({
    ...authority, setBehaviorOverrides: () => ({ success: true }), env: {}, clock: () => 1000,
  });
  assert.equal(off.tick().status, "DISABLED");
  const refused = createWarEngagementPosture({
    ...authority,
    setBehaviorOverrides: () => ({ success: false, errorMsg: "NPC_NOT_FOUND" }),
    env: ON, clock: () => 1000,
  });
  assert.equal(refused.tick().applied[0].status, "NPC_NOT_FOUND");
});

test("enabled() only accepts the explicit flag and authorities are required", () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ EVEJS_COOP_WAR_ENGAGEMENT_POSTURE: "1" }), true);
  assert.throws(() => createWarEngagementPosture({}), /WAR_ENGAGEMENT_POSTURE_AUTHORITIES_REQUIRED/);
});
