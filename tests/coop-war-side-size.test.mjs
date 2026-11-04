import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";

// FW-141: a war side may field four hulls by default and up to eight when a deployment
// has measured stable ticks. The size is a deployment decision, never an unbounded knob.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const mobilizer = require(path.join(forkRoot, "Code/server/src/space/coopWarMobilizer.js"));

function authorities(overrides = {}) {
  return {
    registry: {snapshot: () => ({fleets: [], pilots: []}), execute: () => ({ok: true})},
    readWarState: () => ({wars: []}),
    readLinks: () => [],
    sceneForSystem: () => null,
    getNativeEntity: () => null,
    getController: () => null,
    getFactionForCorporation: () => 0,
    inspectReadiness: () => ({ready: true}),
    getOrderLeases: () => [],
    isTactical: () => false,
    clock: () => 1_800_000_000_000,
    ...overrides,
  };
}

test("a side may be configured from one to eight hulls", () => {
  for (const size of [1, 4, 5, 8]) {
    assert.doesNotThrow(() => mobilizer.createWarMobilizer({
      ...authorities(), maxPerTick: 2, maxPerSide: size}),
    `maxPerSide ${size} must be accepted`);
  }
  for (const size of [0, 9, 16, 2.5]) {
    assert.throws(() => mobilizer.createWarMobilizer({
      ...authorities(), maxPerTick: 2, maxPerSide: size}),
    /WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED/, `maxPerSide ${size} must be refused`);
  }
});

test("the per-tick budget stays small enough for the world tick", () => {
  for (const perTick of [1, 4, 6]) {
    assert.doesNotThrow(() => mobilizer.createWarMobilizer({
      ...authorities(), maxPerTick: perTick, maxPerSide: 4}));
  }
  for (const perTick of [0, 7]) {
    assert.throws(() => mobilizer.createWarMobilizer({
      ...authorities(), maxPerTick: perTick, maxPerSide: 4}),
    /WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED/);
  }
});

test("the default side size is four, and the environment can only move it inside 1..8", () => {
  // The default is what a deployment gets when nobody says anything.
  assert.doesNotThrow(() => mobilizer.createWarMobilizer(authorities()));
  const source = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopVirtualWorldRuntime.war.js"), "utf8");
  assert.match(source, /maxPerSide:Math\.max\(1,Math\.min\(8,Math\.trunc\(Number\(process\.env\.EVEJS_COOP_WAR_SIDE_SIZE\)\|\|4\)\)\)/,
    "the deployment knob is clamped to 1..8 with a default of four");
  assert.match(source, /EVEJS_COOP_WAR_SIDE_TICK/);
});
