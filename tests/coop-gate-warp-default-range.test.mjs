import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";

// Measured live 2026-11-05 (server log, his Megathron Navy Issue, two autopilot gate warps):
//
//   [WarpComplete] ... stopDistance=1269 ... distToTargetCenter=14541 distToTargetEdge=11009
//                                                targetRadius=3532
//   [WarpComplete] ... stopDistance=716  ... distToTargetCenter=14847 distToTargetEdge=11315
//
// The client's autopilot asks for a gate warp with a 10 km requested range. The gate target
// builder treated EVERY request above the 2 500 m jump range as an explicit surface offset,
// so the destination became gateSurface + 10 000 m + up to 2 500 m exit variance: the ship
// landed ~11 km from the gate edge, outside jump range, and the autopilot had to crawl in.
// Only a request above 10 km is a real "warp to within X".
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const SERVER = path.join(forkRoot, "Code/server/src");

test("a gate warp stop distance stays inside jump range for the default and 10 km requests", () => {
  const {createMovementWarpStateHelpers} = require(
    path.join(SERVER, "space/movement/warp/movementWarpState.js"));
  const toFiniteNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const helpers = createMovementWarpStateHelpers({toFiniteNumber, clamp: (v, a, b) => Math.min(Math.max(v, a), b)});
  const ship = {radius: 250};
  const gate = {kind: "stargate", radius: 3532};
  assert.equal(helpers.getWarpStopDistanceForTarget(ship, gate, 0), 2000);
  assert.equal(helpers.getWarpStopDistanceForTarget(ship, gate, 10000), 2000,
    "10 km is the client's own default for a gate, not a request to stand 10 km away");
  assert.equal(helpers.getWarpStopDistanceForTarget(ship, gate, 20000), 20000,
    "a real 'warp to within 20 km' is still honoured");
});

test("only a request above 10 km offsets a gate landing from its surface", () => {
  const source = fs.readFileSync(path.join(SERVER, "space/runtime.js"), "utf8");
  assert.match(source, /const STARGATE_EXPLICIT_WARP_RANGE_METERS = 10000;/);
  assert.match(source, /const MAX_STARGATE_JUMP_DISTANCE_METERS = 2500;/,
    "the jump range itself is unchanged");
  const envelope = source.slice(source.indexOf("function getStargateWarpExitEnvelopePoint("));
  const scatter = source.slice(source.indexOf("function getStargateWarpLandingPoint("));
  for (const [name, body] of [["envelope", envelope], ["landing", scatter]]) {
    assert.match(body, /STARGATE_EXPLICIT_WARP_RANGE_METERS/,
      `${name}: the 10 km threshold decides whether an explicit offset exists`);
    assert.doesNotMatch(body, /requested(Range|Clearance) > MAX_STARGATE_JUMP_DISTANCE_METERS/,
      `${name}: the 2 500 m jump range must never be reused as the 'explicit range' test`);
  }
});
