import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The client formats a daily goal card itself (dailygoals/client/utils.pyj
// format_goal_from_payload) and drops any goal it cannot unpack. So the answer must
// carry: a name/description message id, an assigner, a category, a career enum, a
// contribution configuration the client recognises, a target, an active window and a
// payment whose asset uuid is 16 bytes. Every one of those is checked here against
// the wire bytes, because a missing field silently removes the whole card.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const servicePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/dailyGoalGatewayService.js");
const {
  DAILY_GOAL_PROTO_ROOT,
  createDailyGoalGatewayService,
} = require(servicePath);
const {DEFINITIONS} = require(path.join(forkRoot, "Code/server/src/space/coopDailyGoals.js"));

const DEFINITION = DEFINITIONS.find((goal) => goal.kind === "space_jump");
const BONUS = DEFINITIONS.find((goal) => goal.kind === "complete_daily_goal");
const UUID_BYTES = 16;

function fakeDailyGoals(overrides = {}) {
  return {
    snapshotFor: () => ({
      status: "OBSERVED",
      goals: [{
        definition: DEFINITION,
        progress: 4,
        target: DEFINITION.target,
        // the module computes the reward from the real progress (hull sizes, units)
        rewardSkillPoints: 42000,
        completed: false,
        claimedAt: 0,
        claimable: false,
      }],
    }),
    redeem: () => ({status: "REDEEMED", skillPoints: DEFINITION.rewardSkillPoints}),
    recordManualProgress: () => ({status: "RECORDED", progress: 7}),
    enabled: () => true,
    recordJump: () => "RECORDED",
    ...overrides,
  };
}

function envelope(value, characterID = 140000001) {
  return {
    payload: {value: value || Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: characterID}}},
  };
}

function decoded(typeName, buffer) {
  return DAILY_GOAL_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));
}

const service = createDailyGoalGatewayService({dailyGoals: fakeDailyGoals()});

test("GetAllCurrent answers a card the client can actually unpack", () => {
  const result = service.handleRequest(
    "eve_public.dailygoal.api.GetAllCurrentRequest",
    envelope(),
  );
  assert.equal(result.statusCode, 200);
  const body = decoded("eve_public.dailygoal.api.GetAllCurrentResponse",
    result.responsePayloadBuffer);
  assert.equal(body.goals.length, 1);
  const goal = body.goals[0];
  assert.equal(goal.id.uuid.length, UUID_BYTES);
  assert.equal(goal.goal.name_message.sequential, DEFINITION.nameID);
  assert.equal(goal.goal.description_message.sequential, DEFINITION.descriptionID);
  assert.equal(goal.goal.career, DEFINITION.career);
  assert.equal(goal.goal.category, DEFINITION.category);
  assert.equal(Number(goal.goal.target), DEFINITION.target);
  assert.ok(goal.goal.active_after.seconds > 0, "the client calls ToDatetime() on it");
  assert.ok(goal.goal.active_until.seconds > goal.goal.active_after.seconds);
  assert.equal(Number(goal.current_progress), 4, "uint64 decodes as a Long");

  // payment: the client does uuid.UUID(bytes=asset.uuid) and reads unit.sp.amount
  assert.equal(goal.goal.payment.length, 1);
  assert.equal(goal.goal.payment[0].asset.uuid.length, UUID_BYTES);
  assert.equal(goal.goal.payment[0].period, 1);
  assert.equal(goal.goal.payment[0].unit.sp.amount, 42000,
    "the card must promise exactly what redeem will pay");

  // the configuration branch must be PRESENT, or format_goal_from_payload drops it
  assert.ok(result.responsePayloadBuffer.length > 0);
  const raw = result.responsePayloadBuffer.toString("hex");
  assert.ok(raw.includes(goal.id.uuid.toString("hex").slice(0, 8)));
});

test("each goal kind encodes its own contribution branch", () => {
  for (const definition of DEFINITIONS) {
    const local = createDailyGoalGatewayService({
      dailyGoals: fakeDailyGoals({
        snapshotFor: () => ({
          status: "OBSERVED",
          goals: [{
            definition,
            progress: 0,
            target: definition.target,
            rewardSkillPoints: definition.rewardSkillPoints,
            completed: false,
            claimedAt: 0,
            claimable: false,
          }],
        }),
      }),
    });
    const result = local.handleRequest(
      "eve_public.dailygoal.api.GetAllCurrentRequest",
      envelope(),
    );
    const body = decoded("eve_public.dailygoal.api.GetAllCurrentResponse",
      result.responsePayloadBuffer);
    const config = body.goals[0].goal.contribution_configuration;
    const present = config.kill_npc !== null || config.mine_ore !== null ||
      config.complete_daily_goal !== null || config.space_jump !== null ||
      config.install_manufacturing_job !== null;
    assert.ok(present, `${definition.kind} must set a configuration branch`);
  }
});

test("the bonus goal is a daily bonus category", () => {
  assert.equal(BONUS.category, 2);
  assert.equal(BONUS.career, 0);
});

test("Get answers one goal and GetAllWithRewards lists their ids", () => {
  const request = DAILY_GOAL_PROTO_ROOT
    .lookupType("eve_public.dailygoal.api.GetRequest")
    .encode(DAILY_GOAL_PROTO_ROOT.lookupType("eve_public.dailygoal.api.GetRequest")
      .create({goal: {uuid: Buffer.from(DEFINITION.goalID.replace(/-/g, ""), "hex")}}))
    .finish();
  const one = service.handleRequest("eve_public.dailygoal.api.GetRequest",
    envelope(Buffer.from(request)));
  assert.equal(one.statusCode, 200);
  const body = decoded("eve_public.dailygoal.api.GetResponse", one.responsePayloadBuffer);
  assert.equal(Number(body.progress), 4);

  const all = service.handleRequest("eve_public.dailygoal.api.GetAllWithRewardsRequest",
    envelope());
  assert.equal(all.statusCode, 200);
  const ids = decoded("eve_public.dailygoal.api.GetAllWithRewardsResponse",
    all.responsePayloadBuffer);
  assert.equal(ids.ids.length, 1);
  assert.equal(ids.ids[0].uuid.length, UUID_BYTES);
});

test("redeem pays once; an incomplete goal and pay-for-completion are refused", () => {
  const redeemed = service.handleRequest("eve_public.dailygoal.api.RedeemRequest",
    envelope());
  assert.equal(redeemed.statusCode, 200);

  const incomplete = createDailyGoalGatewayService({
    dailyGoals: fakeDailyGoals({
      redeem: () => ({status: "NOT_COMPLETED", progress: 2, target: 5}),
    }),
  });
  const refused = incomplete.handleRequest("eve_public.dailygoal.api.RedeemRequest",
    envelope());
  assert.equal(refused.statusCode, 9, "FAILED_PRECONDITION, never a silent success");
  assert.match(refused.statusMessage, /not complete \(2\/5\)/);

  const pay = service.handleRequest("eve_public.dailygoal.api.PayForCompletionRequest",
    envelope());
  assert.equal(pay.statusCode, 12,
    "paying ISK to finish a goal would mint money nobody funds");
});

test("a redeem publishes RedeemedNotice to the client that asked", () => {
  const published = [];
  const local = createDailyGoalGatewayService({
    dailyGoals: fakeDailyGoals(),
    publishGatewayNotice(typeName, payload, target) {
      published.push({typeName, payload, target});
    },
  });
  const Request = DAILY_GOAL_PROTO_ROOT.lookupType("eve_public.dailygoal.api.RedeemRequest");
  const payload = Request.encode(Request.create({
    goal: {uuid: Buffer.from(DEFINITION.goalID.replace(/-/g, ""), "hex")},
  })).finish();
  const result = local.handleRequest("eve_public.dailygoal.api.RedeemRequest",
    envelope(Buffer.from(payload)));
  assert.equal(result.statusCode, 200);

  assert.equal(published.length, 1, "the card updates from this notice");
  assert.equal(published[0].typeName, "eve_public.dailygoal.api.RedeemedNotice");
  assert.deepEqual(published[0].target, {character: 140000001});
  const notice = decoded("eve_public.dailygoal.api.RedeemedNotice", published[0].payload);
  assert.deepEqual([...notice.goal.uuid],
    [...Buffer.from(DEFINITION.goalID.replace(/-/g, ""), "hex")]);
});

test("a refused redeem publishes nothing", () => {
  const published = [];
  const local = createDailyGoalGatewayService({
    dailyGoals: fakeDailyGoals({redeem: () => ({status: "NOT_COMPLETED", progress: 1, target: 2})}),
    publishGatewayNotice(typeName, payload, target) {
      published.push({typeName, payload, target});
    },
  });
  const Request = DAILY_GOAL_PROTO_ROOT.lookupType("eve_public.dailygoal.api.RedeemRequest");
  const payload = Request.encode(Request.create({
    goal: {uuid: Buffer.from(DEFINITION.goalID.replace(/-/g, ""), "hex")},
  })).finish();
  local.handleRequest("eve_public.dailygoal.api.RedeemRequest", envelope(Buffer.from(payload)));
  assert.deepEqual(published, [], "a goal that was not paid must not announce a reward");
});

test("the QA progress knob records through the measured module", () => {
  let recorded = null;
  const local = createDailyGoalGatewayService({
    dailyGoals: fakeDailyGoals({
      recordManualProgress: (goalID, characterID, amount) => {
        recorded = {goalID, characterID, amount};
        return {status: "RECORDED", progress: 7};
      },
    }),
  });
  const Request = DAILY_GOAL_PROTO_ROOT.lookupType(
    "eve_public.dailygoal.api.admin.ProgressRequest");
  const payload = Request.encode(Request.create({
    goal: {uuid: Buffer.from(DEFINITION.goalID.replace(/-/g, ""), "hex")},
    character: {sequential: 140000001},
    progress: 3,
  })).finish();
  const result = local.handleRequest("eve_public.dailygoal.api.admin.ProgressRequest",
    envelope(Buffer.from(payload)));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(recorded, {
    goalID: DEFINITION.goalID,
    characterID: 140000001,
    amount: 3,
  });
});

test("a goal that really advances is announced, and completing it says so once", () => {
  let progress = 2;
  const published = [];
  const local = createDailyGoalGatewayService({
    disableDailyGoalTicker: true,
    dailyGoals: fakeDailyGoals({
      snapshotFor: () => ({
        status: "OBSERVED",
        goals: [{
          definition: DEFINITION,
          progress,
          target: DEFINITION.target,
          rewardSkillPoints: 42000,
          completed: progress >= DEFINITION.target,
          claimedAt: 0,
          claimable: progress >= DEFINITION.target,
        }],
      }),
    }),
    publishGatewayNotice(typeName, payload, target) {
      published.push({typeName, payload, target});
    },
  });

  // First sight is a baseline, never an announcement: the card the client has is the truth.
  local.announceProgress(140000001, Date.UTC(2026, 9, 31, 10, 0, 0));
  assert.equal(published.length, 0);

  // Nothing moved, so nothing is said.
  local.announceProgress(140000001, Date.UTC(2026, 9, 31, 10, 0, 1));
  assert.equal(published.length, 0);

  progress = 4;
  local.announceProgress(140000001, Date.UTC(2026, 9, 31, 10, 0, 2));
  assert.equal(published.length, 1, "a real step forward is one notice");
  assert.equal(published[0].typeName, "eve_public.dailygoal.api.ProgressedNotice");
  assert.deepEqual(published[0].target, {character: 140000001});
  const progressed = DAILY_GOAL_PROTO_ROOT.lookupType(published[0].typeName)
    .decode(published[0].payload);
  assert.equal(Buffer.from(progressed.goal.uuid).toString("hex"),
    DEFINITION.goalID.replace(/-/g, ""));

  progress = DEFINITION.target;
  local.announceProgress(140000001, Date.UTC(2026, 9, 31, 10, 0, 3));
  assert.deepEqual(published.slice(1).map((row) => row.typeName), [
    "eve_public.dailygoal.api.ProgressedNotice",
    "eve_public.dailygoal.api.CompletedNotice",
  ], "reaching the target announces the step and the completion");

  local.announceProgress(140000001, Date.UTC(2026, 9, 31, 10, 0, 4));
  assert.equal(published.length, 3, "and a completed goal is not announced again");
});
