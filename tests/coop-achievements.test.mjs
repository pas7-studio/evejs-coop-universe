import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Achievements: progress, completion and the reward completion unlocks. The catalogue is client
// content (ours - space/coopAchievementContent), and a Claim pays exactly the skill points that
// catalogue declares for the achievement, before the reward leaves the unclaimed list.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createAchievements} = require(
  path.join(forkRoot, "Code/server/src/space/coopAchievements.js"));
const {CATEGORIES} = require(
  path.join(forkRoot, "Code/server/src/space/coopAchievementContent.js"));
const {
  ACHIEVEMENT_PROTO_ROOT,
  createAchievementGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/achievementGatewayService.js"));

const NOW = Date.UTC(2026, 9, 29, 23, 30, 0);
const PKG = "eve_public.achievement";
const ACH = Buffer.alloc(16, 0x11);
const CAT = Buffer.alloc(16, 0x22);

function fakeCharacterState(initial = {}) {
  const records = structuredClone(initial);
  return {
    records,
    getCharacterRecord(id) {
      const row = records[String(id)];
      return row ? structuredClone(row) : null;
    },
    updateCharacterRecord(id, mutate) {
      const next = mutate(structuredClone(records[String(id)] || {characterID: id}));
      records[String(id)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

const make = (state, env = {EVEJS_COOP_ACHIEVEMENTS: "1"}) =>
  createAchievements({characterState: state, clock: () => NOW, env});
const encode = (typeName, value) =>
  Buffer.from(ACHIEVEMENT_PROTO_ROOT.lookupType(typeName).encode(value).finish());
const decode = (typeName, buffer) =>
  ACHIEVEMENT_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));
const envelope = (value, characterID = 7) => ({
  payload: {value: value || Buffer.alloc(0)},
  authoritative_context: {identity: {character: {sequential: characterID}}},
});

test("progress is a measured delta, and completion unlocks exactly one reward", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const achievements = make(state);
  assert.equal(achievements.get(7, ACH), null, "no row before anything happened");
  assert.equal(achievements.addProgress(7, ACH, 0).status, "DELTA_REQUIRED",
    "a zero delta is not activity");

  assert.equal(achievements.addProgress(7, ACH, 3).status, "RECORDED");
  assert.equal(achievements.addProgress(7, ACH, 2).progress, 5);
  assert.equal(achievements.unclaimed(7).length, 0, "progress alone unlocks nothing");

  assert.equal(achievements.complete(7, ACH).status, "COMPLETED");
  assert.equal(achievements.complete(7, ACH).status, "ALREADY_COMPLETE");
  assert.equal(achievements.addProgress(7, ACH, 1).status, "ALREADY_COMPLETE",
    "a finished achievement stops measuring");
  assert.equal(achievements.unclaimed(7).length, 1);
  assert.equal(achievements.unclaimed(7)[0].achievement, ACH.toString("hex"));
});

test("a reset withdraws the reward completion created, and nothing else", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const achievements = make(state);
  achievements.addProgress(7, ACH, 4);
  achievements.complete(7, ACH);
  assert.equal(achievements.claim(7, {achievement: ACH}).status, "CLAIMED");
  assert.equal(achievements.claim(7, {achievement: ACH}).status, "NOT_FOUND",
    "a reward cannot be claimed twice");
  assert.equal(achievements.reset(7, ACH).status, "RESET");
  assert.equal(achievements.get(7, ACH), null);
  assert.equal(achievements.unclaimed(7).length, 0);
  assert.equal(achievements.reset(7, ACH).status, "NOT_FOUND");
  assert.equal(achievements.claim(7, {}).status, "SOURCE_REQUIRED");
});

test("claiming an achievement the catalogue does not declare pays nothing", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const paid = [];
  const achievements = createAchievements({
    characterState: state,
    clock: () => NOW,
    env: {EVEJS_COOP_ACHIEVEMENTS: "1"},
    grantSkillPoints: (id, amount) => paid.push([id, amount]),
  });
  achievements.complete(7, ACH);
  assert.equal(achievements.unclaimed(7).length, 1);
  const result = achievements.claim(7, {achievement: ACH});
  assert.equal(result.status, "CLAIMED");
  assert.equal(result.skillPoints, 0);
  assert.deepEqual(paid, [], "an unknown achievement must not invent a payment");
  assert.equal(achievements.unclaimed(7).length, 0);
  assert.equal(achievements.score(7), 0, "no category score was invented by a claim");
});

test("a claim pays the skill points our catalogue declares, once", () => {
  const catalogueId = CATEGORIES[0].achievements[0].id;
  const uuid = Buffer.from(catalogueId, "hex");
  const state = fakeCharacterState({"7": {characterID: 7}});
  const paid = [];
  const achievements = createAchievements({
    characterState: state,
    clock: () => NOW,
    env: {EVEJS_COOP_ACHIEVEMENTS: "1"},
    grantSkillPoints: (id, amount) => paid.push([id, amount]),
  });
  achievements.complete(7, uuid);
  const result = achievements.claim(7, {achievement: uuid});
  assert.equal(result.status, "CLAIMED");
  assert.equal(result.skillPoints, 3500, "the sum of the milestones the catalogue declares");
  assert.deepEqual(paid, [[7, 3500]]);
  assert.equal(achievements.claim(7, {achievement: uuid}).status, "NOT_FOUND",
    "a paid reward cannot be claimed twice");
});

test("a reward that cannot be paid stays claimable instead of being eaten", () => {
  const uuid = Buffer.from(CATEGORIES[0].achievements[0].id, "hex");
  const state = fakeCharacterState({"7": {characterID: 7}});
  const achievements = createAchievements({
    characterState: state,
    clock: () => NOW,
    env: {EVEJS_COOP_ACHIEVEMENTS: "1"},
    grantSkillPoints: () => {
      throw Error("SKILL_POINT_GRANT_WRITE_FAILED");
    },
  });
  achievements.complete(7, uuid);
  assert.equal(achievements.claim(7, {achievement: uuid}).status, "REWARD_FAILED");
  assert.equal(achievements.unclaimed(7).length, 1, "the reward is still there to claim later");
});

test("the gateway answers Get, admin calls, categories and the showcase score", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createAchievementGatewayService({achievements: make(state)});

  const empty = decode(`${PKG}.api.GetResponse`, service.handleRequest(
    `${PKG}.api.GetRequest`, envelope(encode(`${PKG}.api.GetRequest`, {achievement: {uuid: ACH}})))
    .responsePayloadBuffer);
  assert.equal(empty.not_completed, true);
  assert.equal(Number(empty.progress_value), 0);

  const added = service.handleRequest(`${PKG}.api.admin.AddProgressRequest`, envelope(
    encode(`${PKG}.api.admin.AddProgressRequest`,
      {achievement: {uuid: ACH}, progress_delta: 7})));
  assert.equal(added.statusCode, 200);

  const completed = service.handleRequest(`${PKG}.api.admin.CompleteRequest`, envelope(
    encode(`${PKG}.api.admin.CompleteRequest`, {achievement: {uuid: ACH}})));
  assert.equal(completed.statusCode, 200);

  const got = decode(`${PKG}.api.GetResponse`, service.handleRequest(
    `${PKG}.api.GetRequest`, envelope(encode(`${PKG}.api.GetRequest`, {achievement: {uuid: ACH}})))
    .responsePayloadBuffer);
  assert.equal(got.not_completed, false);
  assert.equal(Number(got.progress_value), 7, "uint64 decodes as a Long");
  assert.equal(Number(got.completed_date.seconds), Math.floor(NOW / 1000),
    "int64 decodes as a Long");

  const unclaimed = decode(`${PKG}.reward.api.GetUnclaimedResponse`, service.handleRequest(
    `${PKG}.reward.api.GetUnclaimedRequest`, envelope()).responsePayloadBuffer);
  assert.equal(unclaimed.rewards.length, 1);
  assert.deepEqual(unclaimed.rewards[0].achievement_source.achievement.uuid, ACH);

  const claimed = service.handleRequest(`${PKG}.reward.api.ClaimRequest`, envelope(
    encode(`${PKG}.reward.api.ClaimRequest`, {achievement_source: {achievement: {uuid: ACH}}})));
  assert.equal(claimed.statusCode, 200);
  assert.equal(decode(`${PKG}.reward.api.GetUnclaimedResponse`, service.handleRequest(
    `${PKG}.reward.api.GetUnclaimedRequest`, envelope()).responsePayloadBuffer).rewards.length, 0);

  const category = decode(`${PKG}.category.api.GetResponse`, service.handleRequest(
    `${PKG}.category.api.GetRequest`, envelope(
      encode(`${PKG}.category.api.GetRequest`, {category: {uuid: CAT}}))).responsePayloadBuffer);
  assert.equal(category.score, 0, "a category nobody scored is zero, not invented");

  const showcase = decode(`${PKG}.showcase.api.GetCharacterScoreResponse`, service.handleRequest(
    `${PKG}.showcase.api.GetCharacterScoreRequest`, envelope(
      encode(`${PKG}.showcase.api.GetCharacterScoreRequest`, {character: {sequential: 7}})))
    .responsePayloadBuffer);
  assert.equal(showcase.score, 0);
});

test("a checklist delta is refused instead of being silently dropped", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createAchievementGatewayService({achievements: make(state)});
  // checklist is a message field (id 3); an empty submessage still counts as "sent"
  const payload = Buffer.concat([
    encode(`${PKG}.api.admin.AddProgressRequest`, {achievement: {uuid: ACH}, progress_delta: 1}),
    Buffer.from([0x1a, 0x00]),
  ]);
  const result = service.handleRequest(`${PKG}.api.admin.AddProgressRequest`, envelope(payload));
  assert.equal(result.statusCode, 9, "checklist progress is not stored, so it is refused");
  assert.equal(result.statusMessage, "checklist progress is not supported yet");
  assert.equal(service.handleRequest(`${PKG}.api.GetRequest`, envelope()).statusCode, 200,
    "and the refusal left no progress behind");
});
