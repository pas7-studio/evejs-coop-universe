import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The owner hunts difficulty-4 combat anomalies and was flying 5-9 jumps for one.
// The dungeon authority's spawn profile owns both the slot count and the eligible
// difficulty pool, so the tuning must raise density/coverage and shift the pool
// upward for combat families only. Mining and gas profiles stay untouched.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const tuning = require(path.join(forkRoot, "Code/server/src/space/coopSiteTuning.js"));

const profile = () => ({
  bands: {
    highsec: {slotsPerSystem: 2, targetSystems: 4, targetSystemRatio: 0.4, difficultyRange: [1, 3]},
    nullsec: {slotsPerSystem: 3, targetSystems: 6, targetSystemRatio: 0.5, difficultyRange: [2, 4]},
  },
});

test("combat density is doubled and the difficulty pool moves up one tier", () => {
  const result = tuning.applySpawnProfileTuning(profile(), tuning.readTuning({}), "combat");
  assert.equal(result.bands.highsec.slotsPerSystem, 4);
  assert.equal(result.bands.nullsec.slotsPerSystem, 6);
  assert.deepEqual(result.bands.highsec.difficultyRange, [2, 4]);
  assert.deepEqual(result.bands.nullsec.difficultyRange, [3, 5]);
  assert.equal(result.bands.highsec.targetSystems, 6);
  assert.equal(result.bands.highsec.targetSystemRatio, 0.6);
});

test("mining and gas families keep their original density", () => {
  const original = profile();
  const result = tuning.applySpawnProfileTuning(original, tuning.readTuning({}), "ore");
  assert.equal(result.bands.highsec.slotsPerSystem, 2);
  assert.deepEqual(result.bands.highsec.difficultyRange, [1, 3]);
});

test("env knobs tune the transform and EVEJS_COOP_SITE_TUNING=0 disables it", () => {
  const custom = tuning.readTuning({
    EVEJS_COOP_SITE_DENSITY: "3",
    EVEJS_COOP_SITE_DIFFICULTY_SHIFT: "2",
  });
  assert.equal(custom.density, 3);
  assert.equal(custom.difficultyShift, 2);
  const result = tuning.applySpawnProfileTuning(profile(), custom, "combat_anomaly");
  assert.equal(result.bands.highsec.slotsPerSystem, 6);
  assert.deepEqual(result.bands.highsec.difficultyRange, [3, 5]);
  assert.equal(tuning.enabled({EVEJS_COOP_SITE_TUNING: "0"}), false);
  assert.equal(tuning.enabled({}), true);
});
