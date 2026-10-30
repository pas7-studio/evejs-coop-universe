import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Wormhole entrances from known space. The engine creates a J-space source endpoint as visible and
// the K162 end in known space as invisible, so a player in Jita could not scan a way in at all
// (measured live: listSignatureSites(30000142) = 0 with 1193 active J->k pairs map-wide). This test
// pins the selection rules: a direct entrance wins, a hole in the neighbouring constellation does not
// count as "this system already has one", a collapsed/expired pair is never used, and one pair is
// opened only once.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {plan, isWormholeSystemID} = require(
  path.join(forkRoot, "Code/server/src/space/coopWormholeEntrances.js"));

const SYS = {regionID: 10000002, constellationID: 20000020};
const NEAR = {regionID: 10000002, constellationID: 20000021};
const FAR = {regionID: 10000043, constellationID: 20000099};
const world = {
  getSolarSystemByID(systemID) {
    if (systemID === 30000142 || systemID === 30000144) return SYS;
    if (systemID === 30000200) return NEAR;
    if (systemID === 30004022) return FAR;
    return null;
  },
};
const now = 1_800_000_000_000;
const pair = (pairID, sourceSystemID, destinationSystemID, extra = {}) => ({
  pairID,
  state: "active",
  expiresAtMs: now + 60 * 60 * 1000,
  source: {systemID: sourceSystemID, endpointID: pairID * 2, visibilityState: "visible"},
  destination: {systemID: destinationSystemID, endpointID: (pairID * 2) + 1, visibilityState: "hidden"},
  ...extra,
});

test("J-space is classified by id range, not by a missing column", () => {
  assert.equal(isWormholeSystemID(31000001), true);
  assert.equal(isWormholeSystemID(30000142), false);
});

test("a direct entrance is planned and satisfies its own system", () => {
  const planned = plan({
    systemIDs: [30000142, 30000144],
    pairs: [pair(10, 31000140, 30000142)],
    world,
    nowMs: now,
  });
  assert.equal(planned.entrances.length, 1);
  assert.equal(planned.entrances[0].targetSystemID, 30000142);
  assert.equal(planned.entrances[0].destinationSystemID, 30000142);
  assert.equal(planned.entrances[0].scope, "direct");
  // 30000144 has no entrance of its own, so it gets a real wandering pair instead.
  assert.deepEqual(planned.spawnSystemIDs, [30000144]);
});

test("a hole elsewhere in the region gives that system the signature, not ours", () => {
  const planned = plan({
    systemIDs: [30000142],
    pairs: [pair(11, 31000150, 30000200)],
    world,
    nowMs: now,
  });
  assert.equal(planned.entrances.length, 1);
  assert.equal(planned.entrances[0].destinationSystemID, 30000200);
  assert.equal(planned.entrances[0].scope, "region");
  // Jita itself still has nothing scannable, so it must still get a hole.
  assert.deepEqual(planned.spawnSystemIDs, [30000142]);
});

test("collapsed, expired and invisible-destination pairs are ignored", () => {
  const planned = plan({
    systemIDs: [30000142],
    pairs: [
      pair(12, 31000160, 30000142, {state: "collapsed"}),
      pair(13, 31000161, 30000142, {expiresAtMs: now - 1}),
      // destination already visible: the signature is there, nothing to open
      pair(14, 31000162, 30000142, {destination: {systemID: 30000142, endpointID: 31, visibilityState: "visible"}}),
    ],
    world,
    nowMs: now,
  });
  assert.equal(planned.entrances.length, 0);
  assert.deepEqual(planned.spawnSystemIDs, []);
});

test("the same pair is never opened twice for two systems", () => {
  const planned = plan({
    systemIDs: [30000142, 30000144],
    pairs: [pair(15, 31000170, 30000142)],
    world,
    nowMs: now,
  });
  assert.equal(planned.entrances.length, 1);
  assert.equal(new Set(planned.entrances.map((entry) => entry.pairID)).size, planned.entrances.length);
});

test("an entrance only counts from the same region", () => {
  const planned = plan({
    systemIDs: [30000142],
    pairs: [pair(16, 31000180, 30004022)],
    world,
    nowMs: now,
  });
  assert.equal(planned.entrances.length, 0);
  assert.deepEqual(planned.spawnSystemIDs, [30000142]);
});
