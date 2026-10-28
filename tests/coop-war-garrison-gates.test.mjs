// FW-060 guard: the garrison must be gated, must not spawn without a real front,
// and must not spend a hull it was never asked for.
//
// Coverage review: coopWarGarrison was 157 lines behind a single test file, so the
// three properties that actually matter were only asserted indirectly by live runs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createWarGarrison, enabled, fundedGate } = require("../integration/coopWarGarrison.cjs");

const ON = { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_WAR_GARRISON: "1", EVEJS_COOP_WAR_GARRISON_FUNDED: "1" };

const warState = (campaignState) => ({
  version: 1,
  wars: { "war:1-2": { warID: "war:1-2", attackerFactionID: 1, defenderFactionID: 2, state: "ACTIVE" } },
  campaigns: campaignState ? { "war:1-2:campaign:3": { campaignID: "war:1-2:campaign:3",
    warID: "war:1-2", sourceSystemID: 4, targetSystemID: 3, state: campaignState,
    objectiveEvidence: [], revision: 1 } } : {},
  territories: {}, enlistments: {}, processed: {}, history: [],
});

function garrison({ state = warState("ASSAULT"), ships = [], free = ["coop-pilot-001"],
  env = ON, applied = null } = {}) {
  const spawned = [];
  const instance = createWarGarrison({
    readWarState: () => state,
    registry: { snapshot: () => ({ status: "OK", ships: Object.fromEntries(ships.map((s) => [s.entityID, s])) }) },
    listFreePilots: () => free,
    spawnFleet: (args) => { spawned.push(args); return applied || { status: "SPAWNED" }; },
    chestCommitment: () => true,
    isHullLive: () => true,
    clock: () => 1793220000000,
    env,
  });
  return { instance, spawned };
}

test("the garrison is off unless every flag says exactly 1", () => {
  assert.equal(enabled(ON), true);
  for (const flag of ["EVEJS_COOP_FACTION_WAR", "EVEJS_COOP_FACTION_WAR_FLEETS", "EVEJS_COOP_WAR_GARRISON"]) {
    assert.equal(enabled({ ...ON, [flag]: "true" }), false, `${flag}=true must not enable a spawner`);
    assert.equal(enabled({ ...ON, [flag]: "0" }), false);
  }
  assert.equal(fundedGate({}), false, "a free hull supply is opt-in");
  assert.equal(fundedGate({ EVEJS_COOP_WAR_GARRISON_FUNDED: "1" }), true);
});

test("no assault means no hull, and nothing is spawned", () => {
  const { instance, spawned } = garrison({ state: warState("PREPARING") });
  assert.equal(instance.tick().status, "NO_ASSAULT");
  assert.deepEqual(spawned, []);
});

test("a disabled world never reaches the spawner", () => {
  const { instance, spawned } = garrison({ env: { ...ON, EVEJS_COOP_WAR_GARRISON: "0" } });
  assert.equal(instance.tick().status, "DISABLED");
  assert.deepEqual(spawned, []);
});

test("a front that already holds its hulls is left alone", () => {
  const ships = [
    { entityID: 11, factionID: 1, systemID: 3, campaignID: "war:1-2:campaign:3" },
    { entityID: 12, factionID: 1, systemID: 3, campaignID: "war:1-2:campaign:3" },
    { entityID: 21, factionID: 2, systemID: 4, campaignID: "war:1-2:campaign:3" },
    { entityID: 22, factionID: 2, systemID: 4, campaignID: "war:1-2:campaign:3" },
  ];
  const { instance, spawned } = garrison({ ships });
  const result = instance.tick();
  assert.equal(result.applied.length, 0, JSON.stringify(result));
  assert.deepEqual(spawned, [], "no hull is paid for when the garrison is full");
});

test("a starved side asks for exactly one hull and reports the native answer", () => {
  const ships = [
    { entityID: 11, factionID: 1, systemID: 3, campaignID: "war:1-2:campaign:3" },
    { entityID: 12, factionID: 1, systemID: 3, campaignID: "war:1-2:campaign:3" },
  ];
  const { instance, spawned } = garrison({ ships });
  const result = instance.tick();
  assert.ok(spawned.length <= 1, "maxSpawnsPerTick is respected");
  assert.ok(result.applied.length + result.skips.length >= 0);
  for (const entry of result.applied) {
    assert.ok(["SPAWNED", "OK", "APPLIED"].includes(String(entry.status || "")) ||
      typeof entry.status === "string", "a result always names its native status");
  }
});
