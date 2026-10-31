// FW-118: every hull used to orbit at the same distance.
//
// MEASURED on the play stack 2026-10-31: the posture phase applied one orbitDistanceMeters to
// every war ship in the system, so a battleship sniper, an EWAR cruiser and a tackle frigate all
// sat in the same 500 m ball. A role now keeps its own engagement range - the native behaviour
// loop really orbits there and really leashes there.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { postureForRole, ROLE_POSTURE } = require("../integration/coopWarEngagementPosture.cjs");

const DEFAULTS = { leashRangeMeters: 0, orbitDistanceMeters: 500, movementMode: "orbit" };

test("each role keeps its own range instead of one shared ball", () => {
  assert.equal(postureForRole("tackle", DEFAULTS).orbitDistanceMeters, 2500);
  assert.equal(postureForRole("anti-tackle", DEFAULTS).orbitDistanceMeters, 6000);
  assert.equal(postureForRole("brawler", DEFAULTS).orbitDistanceMeters, 5000);
  assert.equal(postureForRole("heavy", DEFAULTS).orbitDistanceMeters, 12000);
  assert.equal(postureForRole("ewar", DEFAULTS).orbitDistanceMeters, 45000);
  assert.equal(postureForRole("sniper", DEFAULTS).orbitDistanceMeters, 60000);
  assert.equal(postureForRole("logistics", DEFAULTS).orbitDistanceMeters, 70000);
});

test("support stands off further than the line, tackle closes", () => {
  const range = (role) => postureForRole(role, DEFAULTS).orbitDistanceMeters;
  assert.ok(range("tackle") < range("brawler"));
  assert.ok(range("brawler") < range("heavy"));
  assert.ok(range("heavy") < range("ewar"));
  assert.ok(range("ewar") < range("sniper"));
  assert.ok(range("sniper") < range("logistics"),
    "the repair ship is the last thing to be reached");
});

test("a role never orbits outside its own leash", () => {
  for (const [role, row] of Object.entries(ROLE_POSTURE)) {
    assert.ok(row.leashRangeMeters >= row.orbitDistanceMeters,
      role + " would orbit outside its leash");
  }
});

test("an unknown or empty role keeps the operator posture exactly", () => {
  for (const role of ["", null, undefined, "captain", 42]) {
    assert.deepEqual(postureForRole(role, DEFAULTS), DEFAULTS);
  }
  const custom = { leashRangeMeters: 90000, orbitDistanceMeters: 30000, movementMode: "hold" };
  assert.deepEqual(postureForRole("", custom), custom);
  assert.equal(postureForRole("sniper", custom).movementMode, "hold",
    "the role changes the range, never the operator's movement mode");
});

test("garbage defaults still produce a usable posture", () => {
  const posture = postureForRole("tackle", { leashRangeMeters: -5, orbitDistanceMeters: "x" });
  assert.equal(posture.orbitDistanceMeters, 2500);
  assert.equal(posture.leashRangeMeters, 60000);
  assert.equal(posture.movementMode, "orbit");
  assert.equal(postureForRole("tackle").orbitDistanceMeters, 2500);
});
