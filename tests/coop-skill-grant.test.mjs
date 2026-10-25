import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { skillPointsFor, skillItemID, buildSkillEntry, planSkillGrants, applyPlan } = require("../integration/coopSkillGrant.cjs");

const TEMPLATE = {
  itemID: 14000000503300,
  typeID: 3300,
  ownerID: 140000005,
  locationID: 140000005,
  flagID: 7,
  categoryID: 16,
  groupID: 255,
  groupName: "Gunnery",
  itemName: "Gunnery",
  published: true,
  skillLevel: 4,
  trainedSkillLevel: 4,
  effectiveSkillLevel: 4,
  virtualSkillLevel: null,
  skillRank: 1,
  skillPoints: 45255,
};

const CORP_MGMT = {
  typeID: 3340,
  name: "Corporation Management",
  groupID: 266,
  groupName: "Corporation Management",
  categoryID: 16,
  published: true,
  rank: 1,
  level: 5,
};

test("skill points follow the retail curve for rank 1 and scale with rank", () => {
  assert.equal(skillPointsFor(1, 1), 250);
  assert.equal(skillPointsFor(1, 2), 1414);
  assert.equal(skillPointsFor(1, 3), 8000);
  assert.equal(skillPointsFor(1, 4), 45255);
  assert.equal(skillPointsFor(1, 5), 256000);
  assert.equal(skillPointsFor(3, 5), 768000);
  assert.equal(skillPointsFor(1, 0), 0);
  assert.equal(skillPointsFor(1, 9), 256000, "levels are clamped to 5");
});

test("a granted skill is a complete native item row, not a partial patch", () => {
  const entry = buildSkillEntry({ template: TEMPLATE, type: CORP_MGMT, characterID: 140000005, level: 5 });
  assert.equal(entry.typeID, 3340);
  assert.equal(entry.itemName, "Corporation Management");
  assert.equal(entry.itemID, skillItemID(140000005, 3340));
  assert.equal(String(entry.itemID).startsWith("140000005"), true);
  assert.equal(entry.ownerID, 140000005);
  assert.equal(entry.categoryID, 16);
  assert.equal(entry.trainedSkillLevel, 5);
  assert.equal(entry.effectiveSkillLevel, 5);
  assert.equal(entry.skillPoints, 256000);
  for (const key of Object.keys(TEMPLATE)) assert.ok(key in entry, `row keeps ${key}`);
});

test("planning never downgrades and never duplicates an owned skill", () => {
  const existing = { 3300: TEMPLATE, 3340: { ...TEMPLATE, typeID: 3340, trainedSkillLevel: 5, skillLevel: 5 } };
  const plan = planSkillGrants({
    existing,
    characterID: 140000005,
    wanted: [CORP_MGMT, { ...CORP_MGMT, typeID: 3732, name: "Empire Control", level: 4 }],
  });
  assert.deepEqual(plan.add.map((entry) => entry.typeID), [3732]);
  assert.deepEqual(plan.skip.map((entry) => entry.reason), ["ALREADY_TRAINED"]);
  const next = applyPlan(existing, plan);
  assert.equal(next["3300"].trainedSkillLevel, 4, "existing skills are untouched");
  assert.equal(next["3732"].trainedSkillLevel, 4);
  assert.equal(Object.keys(existing).length, 2, "the source document is not mutated in place");
});

test("an empty skill document is refused instead of guessed", () => {
  assert.throws(() => planSkillGrants({ existing: {}, wanted: [CORP_MGMT], characterID: 1 }), /template/);
  assert.throws(() => buildSkillEntry({ template: TEMPLATE, type: { typeID: 0 }, characterID: 1, level: 1 }), /typeID/);
});
