import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The career portal used to render from stubs that were always "not completed", so Claim
// could never exist. Completion is now an explicit record (space/coopCareerGoals) and the
// claim pays skill points once - the reward type the client's own career proto carries.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const modulePath = path.join(forkRoot, "Code/server/src/space/coopCareerGoals.js");
const {
  CAREER_GOAL_REWARD_SKILL_POINTS,
  DEFINITIONS,
  createCareerGoals,
} = require(modulePath);

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

function fakeCharacterState(initial = {}) {
  const records = structuredClone(initial);
  return {
    records,
    getCharacterRecord(characterID) {
      const record = records[String(characterID)];
      return record ? structuredClone(record) : null;
    },
    updateCharacterRecord(characterID, mutate) {
      const next = mutate(structuredClone(records[String(characterID)] || {characterID}));
      records[String(characterID)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

function makeGoals(state, env = {EVEJS_COOP_CAREER_GOALS: "1"}) {
  let granted = 0;
  const goals = createCareerGoals({
    characterState: state,
    clock: () => NOW,
    env,
    grantSkillPoints: (characterID, amount) => {
      granted += amount;
      state.updateCharacterRecord(characterID, (record) => ({
        ...record,
        freeSkillPoints: (record.freeSkillPoints || 0) + amount,
      }));
      return amount;
    },
  });
  return {goals, granted: () => granted};
}

test("the portal starts every career goal incomplete and unclaimable", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state);
  const snapshot = goals.snapshotFor(7);
  assert.equal(snapshot.length, 4);
  for (const entry of snapshot) {
    assert.equal(entry.progress, 0);
    assert.equal(entry.completed, false);
    assert.equal(entry.claimable, false);
  }
  assert.deepEqual(snapshot.map((entry) => entry.definition.career), [1, 2, 3, 4]);
});

test("an admin completion makes exactly that goal claimable", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state);
  const target = DEFINITIONS[1];
  assert.equal(goals.completeFor(7, target.goalID, NOW).status, "COMPLETED");
  const entry = goals.snapshotFor(7).find((row) => row.definition.goalID === target.goalID);
  assert.equal(entry.completed, true);
  assert.equal(entry.progress, 1);
  assert.equal(entry.claimable, true);
  assert.ok(entry.completedAt > 0);
  const other = goals.snapshotFor(7)[0];
  assert.equal(other.completed, false, "other careers are untouched");
});

test("claiming pays the reward once and only when complete", () => {
  const state = fakeCharacterState({"7": {characterID: 7, freeSkillPoints: 500}});
  const {goals, granted} = makeGoals(state);
  const target = DEFINITIONS[0];

  const early = goals.claim(7, target.goalID, NOW);
  assert.equal(early.status, "NOT_COMPLETED");
  assert.equal(early.progress, 0);
  assert.equal(granted(), 0);

  goals.completeFor(7, target.goalID, NOW);
  const claimed = goals.claim(7, target.goalID, NOW);
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.skillPoints, CAREER_GOAL_REWARD_SKILL_POINTS);
  assert.equal(state.records["7"].freeSkillPoints, 500 + CAREER_GOAL_REWARD_SKILL_POINTS);

  const twice = goals.claim(7, target.goalID, NOW);
  assert.equal(twice.status, "ALREADY_CLAIMED");
  assert.equal(state.records["7"].freeSkillPoints, 500 + CAREER_GOAL_REWARD_SKILL_POINTS,
    "a career reward is never paid twice");
});

test("progress comes from the recorded value, never from a guess", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state);
  const target = DEFINITIONS[2];
  const half = goals.setProgressFor(7, target.goalID, 1);
  assert.equal(half.status, "RECORDED");
  const entry = goals.snapshotFor(7).find((row) => row.definition.goalID === target.goalID);
  assert.equal(entry.completed, true, "reaching the target completes the goal");
});

test("an unknown goal id is refused instead of invented", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state);
  assert.equal(goals.completeFor(7, "11111111-1111-4111-8111-111111111111").status,
    "UNKNOWN_GOAL");
  assert.equal(goals.claim(7, "11111111-1111-4111-8111-111111111111").status, "UNKNOWN_GOAL");
});

test("nothing is reported while the feature is switched off", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state, {EVEJS_COOP_CAREER_GOALS: "0"});
  assert.deepEqual(goals.snapshotFor(7), []);
  assert.equal(goals.claim(7, DEFINITIONS[0].goalID).status, "DISABLED");
});

test("gateway: both claim packages answer, and an incomplete claim is refused with numbers", () => {
  const {createCareerGatewayService, CAREER_PROTO_ROOT} = require(path.join(forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/careerGatewayService.js"));
  const state = fakeCharacterState({"7": {characterID: 7}});
  const {goals} = makeGoals(state);
  const service = createCareerGatewayService({careerGoals: goals});

  const encode = (name, value) => {
    const type = CAREER_PROTO_ROOT.lookupType(name);
    return Buffer.from(type.encode(type.create(value)).finish());
  };
  const envelope = (value) => ({
    payload: {value},
    authoritative_context: {identity: {character: {sequential: 7}}},
  });
  const uuid = Buffer.from(DEFINITIONS[0].goalID.replace(/-/g, ""), "hex");

  const refused = service.handleRequest("eve_public.career.goal.api.ClaimRewardRequest",
    envelope(encode("eve_public.career.goal.api.ClaimRewardRequest", {goal: {uuid}})));
  assert.equal(refused.statusCode, 9);
  assert.match(refused.statusMessage, /not complete \(0\/1\)/);

  goals.completeFor(7, DEFINITIONS[0].goalID, NOW);
  const claimed = service.handleRequest("eve_public.career.goal.api.ClaimRewardRequest",
    envelope(encode("eve_public.career.goal.api.ClaimRewardRequest", {goal: {uuid}})));
  assert.equal(claimed.statusCode, 200);

  // the app.eveonline package claims the same record and echoes the goal back
  goals.completeFor(7, DEFINITIONS[3].goalID, NOW);
  const appUUID = Buffer.from(DEFINITIONS[3].goalID.replace(/-/g, ""), "hex");
  const app = service.handleRequest(
    "eve_public.app.eveonline.career.goal.ClaimRewardRequest",
    envelope(encode("eve_public.app.eveonline.career.goal.ClaimRewardRequest",
      {goal: {uuid: appUUID}})),
  );
  assert.equal(app.statusCode, 200);
  const body = CAREER_PROTO_ROOT
    .lookupType("eve_public.app.eveonline.career.goal.ClaimRewardResponse")
    .decode(app.responsePayloadBuffer);
  assert.equal(body.goal.uuid.toString("hex"), appUUID.toString("hex"));
});
