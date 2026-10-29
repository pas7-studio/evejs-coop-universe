import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

// The client reaches personal skill plans through two packages. Only
// eve_public.character.skill.plan.* had a handler, so create/rename/retarget/
// activate/delete from the newer eve_public.skill.plan.* UI did nothing.
// Both packages are the same messages (client eve_public/skill/plan/plan.proto),
// so one storage answers both, and the shapes are compared at startup instead of
// being assumed.
//
// Only the proto module is imported here: the service itself pulls the gameStore,
// which refuses to open inside an unisolated node:test process.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const protoPath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/skillPlanProto.js");
const {SKILL_PLAN_ALIASES, assertAliasShapes, buildSkillPlanProtoRoot} = require(protoPath);

const ALIASED = [
  "Create", "Delete", "Get", "SetActive", "SetDescription", "SetName", "SetSkillRequirements",
];

test("every eve_public.skill.plan.* operation the client uses has a canonical twin", () => {
  for (const name of ALIASED) {
    assert.equal(SKILL_PLAN_ALIASES[`eve_public.skill.plan.${name}Request`],
      `eve_public.character.skill.plan.${name}Request`, name);
  }
});

test("both packages really exist and describe the same wire format", () => {
  const root = buildSkillPlanProtoRoot();
  assert.doesNotThrow(() => assertAliasShapes(root));
  const signature = (type) => type.fieldsArray.map((f) =>
    `${f.name}:${f.resolvedType ? f.resolvedType.fullName.split(".").pop() : f.type}:${f.id}`)
    .sort().join("|");
  for (const name of ALIASED) {
    assert.equal(
      signature(root.lookupType(`eve_public.skill.plan.${name}Request`)),
      signature(root.lookupType(`eve_public.character.skill.plan.${name}Request`)),
      `${name}Request`,
    );
  }
});

test("the startup guard rejects a package that no longer matches", () => {
  const root = buildSkillPlanProtoRoot();
  // simulate a client change: same field, different number
  root.lookupType("eve_public.skill.plan.SetNameRequest").fields.name.id = 3;
  assert.throws(() => assertAliasShapes(root), /SKILL_PLAN_ALIAS_SHAPE_MISMATCH/);
});

test("the service delegates alias calls and rewrites the response package", () => {
  const source = readFileSync(path.join(forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/skillPlanGatewayService.js"), "utf8");
  assert.match(source, /\.\.\.Object\.keys\(SKILL_PLAN_ALIASES\)/,
    "the alias names must be in handledRequestTypes");
  assert.match(source, /assertAliasShapes\(protoRoot\)/);
  assert.match(source, /"eve_public\.character\.skill\.plan\.",\s*\n\s*"eve_public\.skill\.plan\.",/,
    "the answer must come back in the package the client asked with");
});
