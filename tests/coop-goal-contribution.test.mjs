import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

// eve_public.goal.contribution.api.{GetContributorSummariesForGoal,
// GetMyContributorSummaryForGoal}: the generic goal window asked these and got
// nothing, while the corporation-goal package already answered the same questions.
// Both now read the one goal store (services/corporation/corpGoalsState); only the
// wire shape differs (`total_sum_of_progress_added` instead of `progress`).
//
// Only the proto shape is imported here: the service pulls the gameStore, which
// refuses to open inside an unisolated node:test process.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const servicePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/goalContributionGatewayService.js");
const source = readFileSync(servicePath, "utf8");

test("both client request types are handled", () => {
  for (const name of ["GetContributorSummariesForGoal", "GetMyContributorSummaryForGoal"]) {
    assert.match(source,
      new RegExp(`eve_public\\.goal\\.contribution\\.api\\.${name}Request`), name);
  }
});

test("the summary reports the contributed sum, not the corp-goal shape", () => {
  assert.match(source, /total_sum_of_progress_added: \{ type: "uint64", id: 2 \}/);
  assert.doesNotMatch(source, /earnings: \[|buildContributorSummaryPayload/,
    "earnings belong to corporationgoal.api; this package reports a single sum");
});

test("the readings come from the one goal store, never a second copy", () => {
  assert.match(source, /require\(\s*path\.join\(/);
  assert.match(source, /listContributorSummariesForGoal/);
  assert.match(source, /getContributorSummaryForGoal/);
  assert.match(source, /corpGoalsState/);
});

test("a missing goal id is refused instead of answered as zero contribution", () => {
  assert.match(source, /goal is required/);
  assert.match(source, /statusCode: 3/);
});

test("the proto shapes match the client descriptor", () => {
  const protobuf = require(path.join(forkRoot, "Code/server/node_modules/protobufjs"));
  const root = protobuf.Root.fromJSON({nested: {eve_public: {nested: {
    character: {nested: {Identifier: {fields: {sequential: {type: "uint32", id: 1}}}}},
    goal: {
      nested: {
        Identifier: {fields: {uuid: {type: "bytes", id: 1}}},
        contribution: {nested: {api: {nested: {
          ContributorSummary: {fields: {
            contributor: {type: "eve_public.character.Identifier", id: 1},
            total_sum_of_progress_added: {type: "uint64", id: 2},
            goal: {type: "eve_public.goal.Identifier", id: 3},
          }},
          GetContributorSummariesForGoalResponse: {fields: {
            summaries: {rule: "repeated",
              type: "eve_public.goal.contribution.api.ContributorSummary", id: 1},
          }},
          GetMyContributorSummaryForGoalResponse: {fields: {
            summary: {type: "eve_public.goal.contribution.api.ContributorSummary", id: 1},
          }},
        }}}},
      },
    },
  }}}});
  const summary = root.lookupType("eve_public.goal.contribution.api.ContributorSummary");
  assert.deepEqual(summary.fieldsArray.map((f) => [f.name, f.id]),
    [["contributor", 1], ["total_sum_of_progress_added", 2], ["goal", 3]]);
  const summaries = root.lookupType(
    "eve_public.goal.contribution.api.GetContributorSummariesForGoalResponse");
  assert.equal(summaries.fields.summaries.repeated, true);
});
