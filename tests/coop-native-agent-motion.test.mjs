"use strict";
// The shared native motion primitives must stay usable by any server-driven
// character, not just the courier: one identity object per character across
// undock -> warp -> dock, the scene-first warp call, and an honest dock result.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const motion = require("../integration/coopNativeAgentMotion.cjs");

function character(id) {
  return { characterID: id, accountId: 9, corporationID: 1000045, allianceID: 0, stationID: 60015260 };
}

function ctx(overrides) {
  const calls = [];
  const base = {
    calls,
    character: character(140000100),
    transitions: {
      undockSession: (session) => {
        calls.push(["undock", session.characterID, session.stationID]);
        session._space = { shipID: 980000000123 };
        return { success: true, data: { ship: { itemID: 980000000123 } } };
      },
      dockSession: (session, stationID) => {
        calls.push(["dock", session.characterID, stationID, session.stationID]);
        return { success: true };
      },
    },
    space: {
      warpToPoint: (session, point, options) => {
        calls.push(["warpSession", session.characterID, point.x, options.ingressDurationMs]);
        return { success: true };
      },
    },
  };
  return Object.assign(base, overrides);
}

test("one identity object is reused for undock, warp and dock", () => {
  motion.releaseAgentSession(140000100);
  const runtime = ctx();
  const undocked = motion.undockAgent(runtime, 60015260);
  assert.equal(undocked.status, "OK");
  assert.equal(undocked.entityID, 980000000123);

  const warped = motion.warpAgent(runtime, {
    entityID: undocked.entityID,
    systemID: 30000142,
    point: { x: 1, y: 2, z: 3 },
    ingressMs: 30000,
  });
  assert.equal(warped.status, "OK");

  const docked = motion.dockAgent(runtime, 60015262);
  assert.equal(docked.status, "OK");

  // The undock attached _space; the dock saw the same object, still in space.
  assert.deepEqual(runtime.calls[0].slice(0, 3), ["undock", 140000100, 60015260]);
  assert.equal(runtime.calls.at(-1)[0], "dock");
  assert.equal(runtime.calls.at(-1)[3], 0, "dock must not claim to be docked");
});

test("the scene form of the warp is preferred over the runtime facade", () => {
  motion.releaseAgentSession(140000101);
  const entity = { itemID: 980000000124, kind: "ship" };
  const sceneCalls = [];
  const runtime = ctx({
    character: character(140000101),
    sceneForSystem: (systemID) => ({
      getEntityByID: (id) => (Number(id) === 980000000124 ? entity : null),
      startSessionlessWarpIngress: (target, point) => {
        sceneCalls.push([systemID, target, point.x]);
        return { success: true };
      },
    }),
  });
  const warped = motion.warpAgent(runtime, {
    entityID: 980000000124,
    systemID: 30000142,
    point: { x: 5, y: 0, z: 0 },
  });
  assert.equal(warped.status, "OK");
  // systemID first, then the real entity object from the scene, then the point.
  assert.deepEqual(sceneCalls[0], [30000142, entity, 5]);
});

test("a dock answered ALREADY_DOCKED is the intended end state", () => {
  motion.releaseAgentSession(140000102);
  const runtime = ctx({
    character: character(140000102),
    transitions: {
      undockSession: () => ({ success: true, data: { ship: { itemID: 1 } } }),
      dockSession: () => ({ success: false, errorMsg: "ALREADY_DOCKED" }),
    },
  });
  const docked = motion.dockAgent(runtime, 60015262);
  assert.equal(docked.status, "OK");
  assert.equal(docked.alreadyDocked, true);
});

test("a missing native capability is reported, never guessed", () => {
  const missing = motion.preflight({ transitions: {}, space: {} });
  assert.equal(missing.status, "NOT_READY");
  assert.deepEqual(missing.missing.sort(), ["space.warpToPoint", "transitions.dockSession", "transitions.undockSession"]);
});
