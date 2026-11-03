import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The career portal builds one node per static client activity
// (careerGoalsConst.CAREER_PATH_GROUPS) and divides by len(goals) in
// activityNode.UpdateDashedCircle. A group with no goal raised
// ZeroDivisionError and the window never opened (live client, 2026-11-04).
// Every activity below must therefore own at least one goal definition.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {DEFINITIONS} = require(path.join(
  forkRoot,
  "Code/server/src/space/coopCareerGoals.js",
));

const ACTIVITIES = {
  1: ["CareerAgentMissions", "Scanning", "Hacking", "AdvancedHacking", "Wormholes",
    "GasSites", "CombatSites", "Navigation", "AdvancedNavigation", "ProjectDiscovery"],
  2: ["IndustrialistCareerAgentsMissions", "Market", "Salvage", "ResourceHarvesting",
    "Refining", "Manufacturing", "DistributionAgent", "MiningAgent", "Research"],
  3: ["CareerAgentMissions", "SecurityAgent", "AbyssalDeadspace", "Combat", "Bounties",
    "CombatSites", "EpicArc", "Market", "Standings", "LoyaltyPoints"],
  4: ["CareerAgentMissions", "Social", "ElectronicWarfare", "Combat", "PvP",
    "CapacitorWarfare", "FactionWarfare", "Support", "Destruction", "Duels"],
};

test("every static career activity owns at least one goal", () => {
  for (const [career, groups] of Object.entries(ACTIVITIES)) {
    for (const group of groups) {
      const goals = DEFINITIONS.filter(
        (d) => d.career === Number(career) && d.group === group,
      );
      assert.ok(
        goals.length > 0,
        `career ${career} activity ${group} has no goal - UpdateDashedCircle would divide by zero`,
      );
    }
  }
});

test("each career keeps exactly one career-path goal and non-zero values", () => {
  for (const career of [1, 2, 3, 4]) {
    const pathGoals = DEFINITIONS.filter((d) => d.career === career && !d.group);
    assert.equal(pathGoals.length, 1);
    assert.equal(pathGoals[0].subtype, "CAREER_PATH_GOAL");
  }
  for (const definition of DEFINITIONS) {
    assert.ok(definition.target > 0, "target 0 breaks progress math");
    assert.ok(definition.careerPoints > 0, "career_points 0 breaks progress math");
    assert.ok(definition.threat >= 0);
  }
});

test("goal ids are unique and 16-byte UUIDs", () => {
  const ids = DEFINITIONS.map((d) => d.goalID);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});
