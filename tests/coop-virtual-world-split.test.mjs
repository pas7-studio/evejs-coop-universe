// The virtual world runtime's pure helpers used to live inside one 5 349-line
// scope where nothing could be tested in isolation. They now live in
// coopVirtualWorldRuntime.pure.js (see docs/FORK_PATCH_AUDIT_20261028.md), and
// this file is the reason the split is worth having: behaviour of the moved code
// is pinned directly, and the parent must still re-export every one of them.
//
// The split must not lose a single export, so that is asserted first.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const runtime = require("../integration/coopVirtualWorldRuntime.cjs");
const pure = require("../integration/coopVirtualWorldRuntime.pure.cjs");

// The split must not lose a single export. Freezing the exact current set made every
// feature that added an export edit this test - it drifted twice in one hour while the
// war and territory work landed - so what is frozen here is the pre-split surface: those
// names must all still be exported, and no export may be undefined. New names are the
// business of the feature that adds them.
const RUNTIME_EXPORTS_BEFORE_SPLIT = [
  "alifeOrderArbitrationEnabled", "confirmedNativeNpcWreck", "confirmedWreck",
  "createWarRecoveryAdmin", "diagnoseCombat", "diagnoseMobilization",
  "diagnoseNativeRaids", "diagnoseNpcOrder", "diagnoseWarFunding", "diagnoseWarState",
  "isHeadlessNativeReady", "linkSpawnedIdentity", "livingWorldPhases",
  "nativeWarFleetRegistry", "nextHeadlessRetryMs", "observeSession",
  "releaseSpawnedIdentity", "sellOnArrival", "start", "warFrontChat",
  "witnessedNativeBossWreck",
];

test("the split did not change what the runtime exports", () => {
  const exported = Object.keys(runtime);
  for (const name of RUNTIME_EXPORTS_BEFORE_SPLIT) {
    assert.ok(exported.includes(name), `the split dropped ${name}`);
    assert.ok(runtime[name] !== undefined, name);
  }
  assert.equal(exported.filter((name) => runtime[name] === undefined).length, 0,
    "an undefined export is a name that exists on paper only");
  // The moved declarations are still real: they run inside the runtime through
  // the sibling, they are simply not part of the public surface (they were
  // internal before the split too).
  assert.ok(Object.keys(pure).length > 40, "the slice is a real module");
  assert.equal(pure.distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.ok(pure.visitedSystems instanceof Set, "moved mutable state is one instance, not a copy");
  assert.ok(pure.observedNpcIDs instanceof Set);
});

test("distanceBetween is metres between two real points, null when it cannot know", () => {
  const p = pure.distanceBetween;
  assert.equal(p({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(p({ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }), 1000);
  // A missing side or a missing coordinate is "unknown", never 0 and never NaN:
  // callers use null to skip a check instead of treating it as touching.
  assert.equal(p(null, { x: 0, y: 0, z: 0 }), null);
  assert.equal(p({ x: 0, y: 0, z: 0 }, { x: undefined, y: 0, z: 0 }), null);
  assert.equal(p({ x: 0, y: 0 }, { x: 0, y: 0, z: 0 }), null);
});

test("nearestBeltMeters measures only real belts with a position", () => {
  const scene = {
    staticEntities: [
      { kind: "asteroidBelt", position: { x: 1000, y: 0, z: 0 } },
      { kind: "asteroidBelt", position: { x: 500, y: 0, z: 0 } },
      { kind: "stargate", position: { x: 1, y: 0, z: 0 } },
      { kind: "asteroidBelt" }, // no position: not a usable distance
    ],
  };
  assert.equal(pure.nearestBeltMeters(scene, { x: 0, y: 0, z: 0 }), 500);
  assert.equal(pure.nearestBeltMeters({ staticEntities: [{ kind: "stargate", position: { x: 1, y: 0, z: 0 } }] }, { x: 0, y: 0, z: 0 }), null);
  assert.equal(pure.nearestBeltMeters({}, { x: 0, y: 0, z: 0 }), null, "no scene means no belt, not a crash");
  assert.equal(pure.nearestBeltMeters(scene, null), null);
});
