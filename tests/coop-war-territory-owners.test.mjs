// FW-044 guard: military control needs a military presence.
// Measured: raw presence let ORE (mining hulls, no combat doctrine) own four systems,
// so every border resolved to a party that cannot fight and no front could open.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { deriveTerritoryOwners } = require("../integration/coopVirtualWorldRuntime.cjs");

const P = (systemID, factionID, role) => ({ systemID, factionID, role });

test("a mining fleet cannot claim military control of a system", () => {
  const owners = deriveTerritoryOwners([
    P(30000142, 500014, "miner"), P(30000142, 500014, "miner"), P(30000142, 500014, "hauler"),
  ]);
  assert.deepEqual(owners, [], "no armed presence means no owner");
});

test("an armed presence makes the biggest faction the owner", () => {
  const owners = deriveTerritoryOwners([
    P(30045344, 500011, "patrol"),
    P(30045344, 500014, "miner"), P(30045344, 500014, "miner"), P(30045344, 500014, "hauler"),
  ]);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].factionID, 500011, "the only faction that can defend owns the system");
  assert.equal(owners[0].armed, 1);
  assert.equal(owners[0].ships, 1, "only the owner's own resolved pilots are counted");
});

test("a tie between two armed factions owns nothing", () => {
  const owners = deriveTerritoryOwners([
    P(1, 500004, "patrol"), P(1, 500011, "patrol"),
  ]);
  assert.deepEqual(owners, []);
});

test("an unarmed faction never wins even with more hulls", () => {
  const owners = deriveTerritoryOwners([
    P(2, 500011, "pirate"),
    P(2, 500014, "miner"), P(2, 500014, "miner"), P(2, 500014, "miner"), P(2, 500014, "miner"),
  ]);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].factionID, 500011);
});

// FW-045 guard: a map derived under the OLD rule must be repairable without wiping the world.
// A territory never fought over whose owner fields no armed presence is re-derived; a system
// with nobody armed loses its owner; anything captured (revision > 1) is never touched.
const { planTerritoryBootstrap } = require("../integration/coopVirtualWorldRuntime.cjs");
const terr = (owner, revision = 1) => ({ militaryControllerFactionID: owner, revision });

test("a mining-owned system is corrected to the faction that can actually defend it", () => {
  const plan = planTerritoryBootstrap({
    territories: { 30003837: terr(500014) },
    pilots: [P(30003837, 500014, "miner"), P(30003837, 500014, "miner"), P(30003837, 500004, "patrol")],
  });
  assert.equal(plan.correct.length, 1);
  assert.equal(plan.correct[0].factionID, 500004);
});

test("a system with no armed presence loses its owner, a captured one is never touched", () => {
  const plan = planTerritoryBootstrap({
    territories: { 30000142: terr(500014), 30045344: terr(500011, 3) },
    pilots: [P(30000142, 500014, "miner"), P(30045344, 500011, "patrol")],
  });
  assert.deepEqual(plan.release.map((r) => r.systemID), [30000142]);
  assert.ok(plan.keep.some((k) => k.systemID === 30045344 && k.reason === "ALREADY_FOUGHT_OVER"));
});

test("an owner that is still armed keeps its system", () => {
  const plan = planTerritoryBootstrap({
    territories: { 30045344: terr(500011) },
    pilots: [P(30045344, 500011, "patrol"), P(30045344, 500014, "miner")],
  });
  assert.equal(plan.correct.length, 0);
  assert.equal(plan.release.length, 0);
  assert.equal(plan.keep[0].reason, "OWNER_STILL_ARMED");
});
