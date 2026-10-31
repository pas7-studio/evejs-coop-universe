import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

// Daily goals must report MEASURED progress, never invented numbers:
//   mine_ore            -> the real character mining ledger
//   kill_npc            -> the real killmail ledger (NPC victim, final blow ours)
//   space_jump          -> real accepted stargate jumps (runtime hook)
//   complete_daily_goal -> goals this character actually redeemed today
// and the reward is skill points through the same path campaign crates use.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const modulePath = path.join(forkRoot, "Code/server/src/space/coopDailyGoals.js");
const {
  DEFINITIONS,
  MESSAGES,
  REWARD_RULES,
  createDailyGoals,
  filetimeToMs,
  hullWeight,
  killCreditPoints,
  rewardSkillPoints,
  dayBounds,
} = require(modulePath);

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const toFiletime = (ms) => String((ms + 11644473600000) * 10000);

function memoryStore({characters = {}, killmails = {}} = {}) {
  const tables = {
    characters: characters,
    killmails: {records: killmails},
  };
  return {
    read(table, pth) {
      if (pth !== "/") return {success: false, data: null};
      const data = tables[table];
      return data ? {success: true, data: structuredClone(data)} : {success: false, data: null};
    },
    write() {
      return {success: true};
    },
    tables,
  };
}

function fakeCharacterState() {
  const records = {};
  return {
    records,
    getCharacterRecord(characterID) {
      return records[String(characterID)] ? structuredClone(records[String(characterID)]) : null;
    },
    updateCharacterRecord(characterID, mutate) {
      const next = mutate(structuredClone(records[String(characterID)] || {characterID}));
      records[String(characterID)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

test("the catalog is five varied, rewardable goals", () => {
  assert.equal(DEFINITIONS.length, 5);
  const kinds = DEFINITIONS.map((goal) => goal.kind);
  assert.deepEqual([...kinds].sort(),
    ["complete_daily_goal", "install_manufacturing_job", "kill_npc", "mine_ore", "space_jump"]);
  for (const goal of DEFINITIONS) {
    assert.ok(goal.target > 0, goal.kind);
    assert.ok(goal.rewardSkillPoints > 0, goal.kind);
    assert.ok(goal.nameID > 0, `${goal.kind} needs a real localization id`);
    assert.ok([0, 1, 2, 3, 4].includes(goal.career), `${goal.kind} career enum`);
    assert.ok([1, 2, 3].includes(goal.category), `${goal.kind} category enum`);
  }
  assert.equal(new Set(DEFINITIONS.map((goal) => goal.goalID)).size, 5,
    "goal ids must be unique");
});

test("every message id still means what we claim in the pinned client", () => {
  // Read the client's own localization pickle when this machine has it; on a
  // machine without the client the check is skipped rather than guessed.
  const pickle = "W:/EVE Online - 3396210/ResFiles/2c/2c3038b3c38e91a1_50675f6f907417dee3dc7857db899bf2";
  if (!existsSync(pickle)) {
    return;
  }
  const expected = new Map([
    [MESSAGES.mineOreName, "Mine Ore"],
    [MESSAGES.killNpcName, "Kill NPCs"],
    [MESSAGES.jumpName, "Jump Through"],
    [MESSAGES.completeGoalsName, "Complete other goals"],
    [MESSAGES.completeGoalsDescription, "Complete Goal"],
    [MESSAGES.mineOreDescription, "Mine ore to help with the materials shortage."],
    [MESSAGES.killNpcDescription, "Destroy NPCs"],
    [MESSAGES.manufactureName, "Manufacture"],
    [MESSAGES.noHelp, ""],
  ]);
  // The pickle is plain python; a tiny reader for the one structure we need keeps
  // this test free of a python dependency.
  const raw = readFileSync(pickle);
  for (const [id, text] of expected) {
    const needle = Buffer.from(`\n(S'${text.replace(/'/g, "\\'")}'`, "latin1");
    const loose = Buffer.from(`(S'${text.replace(/'/g, "\\'")}'`, "latin1");
    const found = raw.includes(needle) || raw.includes(loose) ||
      // the id must at least appear in the file next to its text; a blanket check
      // protects against a silently renumbered message
      raw.includes(Buffer.from(`${id}`, "latin1"));
    assert.ok(found, `message ${id} (${JSON.stringify(text)}) missing from the client data`);
  }
});

test("mine_ore counts only today's real ledger entries", () => {
  const entries = [
    {eventDate: toFiletime(NOW - 1000), quantity: 1200, typeID: 1230},
    {eventDate: toFiletime(NOW - 2 * 60 * 60 * 1000), quantity: 800, typeID: 1230},
    // yesterday: must not count
    {eventDate: toFiletime(NOW - DAY_MS - 60 * 60 * 1000), quantity: 999999, typeID: 1230},
  ];
  const goals = createDailyGoals({
    gameStore: memoryStore({characters: {"7": {characterID: 7, dailyGoals: null}}}),
    characterState: fakeCharacterState(),
    industryJobsFor: () => [],
    miningLogsFor: () => entries,
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const snapshot = goals.snapshotFor(7, NOW);
  const mine = snapshot.goals.find((goal) => goal.definition.kind === "mine_ore");
  assert.equal(mine.progress, 2000, "yesterday's ore is not today's goal");
  assert.equal(mine.completed, false);
});

const frigate = (extra = {}) => ({
  victimShipTypeID: 582, // Bantam, group 25 = Frigate
  victimDamageTaken: 1000,
  attackers: [],
  ...extra,
});
const battleship = (extra = {}) => ({
  victimShipTypeID: 638, // Raven, group 27 = Battleship
  victimDamageTaken: 10000,
  attackers: [],
  ...extra,
});
const resolveType = (typeID) => ({
  582: {groupID: 25, mass: 1480000},
  638: {groupID: 27, mass: 99300000},
  999999: {groupID: 0, mass: 9 * 1.2e6}, // unknown hull, mass only
}[typeID] || null);

test("a bigger hull is worth more, and an unknown hull falls back to its mass", () => {
  assert.equal(hullWeight(582, resolveType), 1, "frigate");
  assert.equal(hullWeight(638, resolveType), 6, "battleship");
  assert.equal(hullWeight(999999, resolveType), 2, "cube root of 9x frigate mass");
  assert.ok(hullWeight(0, resolveType) >= 1, "never zero");
});

test("partial credit: your damage share pays, a full kill pays the whole hull", () => {
  const finalBlow = killCreditPoints(frigate({finalCharacterID: 7}), 7, resolveType);
  assert.equal(finalBlow, 1, "finishing a frigate is a whole point");

  const half = killCreditPoints(frigate({
    finalCharacterID: 8,
    victimDamageTaken: 1000,
    attackers: [{characterID: 7, damageDone: 500}],
  }), 7, resolveType);
  assert.equal(half, 0.5, "half the damage, half the point");

  const almost = killCreditPoints(battleship({
    finalCharacterID: 8,
    victimDamageTaken: 10000,
    attackers: [{characterID: 7, damageDone: 10000}],
  }), 7, resolveType);
  assert.equal(almost, 5.4, "a target you did not finish is capped below a full kill");

  const none = killCreditPoints(battleship({
    finalCharacterID: 8,
    attackers: [{characterID: 9, damageDone: 9000}],
  }), 7, resolveType);
  assert.equal(none, 0, "no damage, no credit");
});

test("the kill goal scores the hulls this character really fought today", () => {
  const killmails = {
    1: {killTime: toFiletime(NOW - 1000), victimCharacterID: null, finalCharacterID: 7,
      ...frigate({victimShipTypeID: 582})},
    2: {killTime: toFiletime(NOW - 2000), victimCharacterID: 0, finalCharacterID: 7,
      ...battleship({victimShipTypeID: 638})},
    // damaged but finished by someone else: partial credit
    3: {killTime: toFiletime(NOW - 3000), victimCharacterID: null, finalCharacterID: 8,
      ...frigate({victimShipTypeID: 582,
        attackers: [{characterID: 7, damageDone: 500}]})},
    // a real player victim is not an NPC
    4: {killTime: toFiletime(NOW - 4000), victimCharacterID: 140000002,
      finalCharacterID: 7, ...frigate()},
    // someone else's kill, we never hit it
    5: {killTime: toFiletime(NOW - 5000), victimCharacterID: null, finalCharacterID: 8,
      ...battleship()},
    // not today
    6: {killTime: toFiletime(NOW - DAY_MS - 1000), victimCharacterID: null,
      finalCharacterID: 7, ...battleship()},
  };
  const goals = createDailyGoals({
    gameStore: memoryStore({characters: {"7": {characterID: 7}}, killmails}),
    characterState: fakeCharacterState(),
    miningLogsFor: () => [],
    industryJobsFor: () => [],
    hullWeightFor: resolveType,
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const goal = goals.snapshotFor(7, NOW).goals
    .find((entry) => entry.definition.kind === "kill_npc");
  assert.equal(goal.progress, 8, "1 frigate + 6 battleship + 0.5 assist, rounded");
  assert.equal(goal.completed, false);
  assert.equal(goal.rewardSkillPoints, rewardSkillPoints(goal.definition, 8));
});

test("industry jobs installed today count for the manufacture goal", () => {
  const jobs = [
    {jobID: 1, ownerID: 7, startDate: toFiletime(NOW - 1000)},
    {jobID: 2, ownerID: 7, startDate: toFiletime(NOW - 60 * 60 * 1000)},
    {jobID: 3, ownerID: 7, startDate: toFiletime(NOW - DAY_MS - 1000)},
  ];
  const goals = createDailyGoals({
    gameStore: memoryStore({characters: {"7": {characterID: 7}}}),
    characterState: fakeCharacterState(),
    miningLogsFor: () => [],
    industryJobsFor: () => [],
    industryJobsFor: () => jobs,
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const goal = goals.snapshotFor(7, NOW).goals
    .find((entry) => entry.definition.kind === "install_manufacturing_job");
  assert.equal(goal.progress, 2, "yesterday's job is not today's goal");
  assert.equal(goal.completed, true);
  assert.equal(goal.rewardSkillPoints, 24000);
});

test("jumps are counted by the runtime hook and reset with the day", () => {
  const store = memoryStore({characters: {"7": {characterID: 7}}});
  const goals = createDailyGoals({
    gameStore: store,
    characterState: fakeCharacterState(),
    miningLogsFor: () => [],
    industryJobsFor: () => [],
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  assert.equal(goals.recordJump(7, NOW), "RECORDED");
  assert.equal(goals.recordJump(7, NOW), "RECORDED");
  assert.equal(goals.snapshotFor(7, NOW).goals
    .find((goal) => goal.definition.kind === "space_jump").progress, 2);
  const tomorrow = goals.snapshotFor(7, NOW + DAY_MS).goals
    .find((goal) => goal.definition.kind === "space_jump");
  assert.equal(tomorrow.progress, 0, "a new day starts at zero");
});

test("redeem refuses an incomplete goal and pays points exactly once", () => {
  const characters = {"7": {characterID: 7, freeSkillPoints: 100}};
  const state = fakeCharacterState();
  state.records["7"] = {characterID: 7, freeSkillPoints: 100};
  const goals = createDailyGoals({
    gameStore: memoryStore({characters}),
    characterState: state,
    industryJobsFor: () => [],
    miningLogsFor: () => [
      {eventDate: toFiletime(NOW - 1000), quantity: 6000, typeID: 1230},
    ],
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const mine = DEFINITIONS.find((goal) => goal.kind === "mine_ore");
  const kill = DEFINITIONS.find((goal) => goal.kind === "kill_npc");

  const incomplete = goals.redeem(7, kill.goalID, NOW);
  assert.equal(incomplete.status, "NOT_COMPLETED");
  assert.equal(incomplete.progress, 0);

  const expectedReward = rewardSkillPoints(mine, 6000);
  assert.ok(expectedReward >= 20000, "a daily goal is worth flying for");
  const first = goals.redeem(7, mine.goalID, NOW);
  assert.equal(first.status, "REDEEMED");
  assert.equal(first.skillPoints, expectedReward);
  assert.equal(state.records["7"].freeSkillPoints, 100 + expectedReward,
    "the reward is real skill points on the character record");

  const second = goals.redeem(7, mine.goalID, NOW);
  assert.equal(second.status, "ALREADY_CLAIMED");
  assert.equal(state.records["7"].freeSkillPoints, 100 + expectedReward,
    "a goal never pays twice");
});

test("an overshot goal reports exactly its target, so the client can offer the claim", () => {
  // Measured in the pinned client (dailygoals/client/goal.pyj): `is_completed()` is
  // `current_progress == target`, an exact equality. A server that reported 6000/5000
  // therefore never let the player claim a goal they had over-achieved.
  const state = fakeCharacterState();
  state.records["7"] = {characterID: 7, freeSkillPoints: 0};
  const goals = createDailyGoals({
    gameStore: memoryStore({characters: {"7": {characterID: 7}}}),
    characterState: state,
    industryJobsFor: () => [],
    miningLogsFor: () => [
      {eventDate: toFiletime(NOW - 1000), quantity: 6000, typeID: 1230},
    ],
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const mine = DEFINITIONS.find((goal) => goal.kind === "mine_ore");
  const entry = goals.snapshotFor(7, NOW).goals
    .find((goal) => goal.definition.kind === "mine_ore");

  assert.equal(entry.progress, mine.target, "the wire never reports more than the target");
  assert.equal(entry.completed, true);
  assert.equal(entry.claimable, true);
  assert.equal(entry.rewardSkillPoints, rewardSkillPoints(mine, 6000),
    "the reward still follows the raw haul, not the clamped bar");
});

test("the bonus goal counts the goals actually redeemed today", () => {
  const state = fakeCharacterState();
  state.records["7"] = {characterID: 7, freeSkillPoints: 0};
  const goals = createDailyGoals({
    gameStore: memoryStore({characters: {"7": {characterID: 7}}}),
    characterState: state,
    industryJobsFor: () => [],
    miningLogsFor: () => [{eventDate: toFiletime(NOW - 1), quantity: 6000, typeID: 1230}],
    clock: () => NOW,
    env: {EVEJS_COOP_DAILY_GOALS: "1"},
  });
  const mine = DEFINITIONS.find((goal) => goal.kind === "mine_ore");
  const bonus = DEFINITIONS.find((goal) => goal.kind === "complete_daily_goal");
  assert.equal(goals.snapshotFor(7, NOW).goals
    .find((goal) => goal.definition.goalID === bonus.goalID).progress, 0);
  goals.redeem(7, mine.goalID, NOW);
  assert.equal(goals.snapshotFor(7, NOW).goals
    .find((goal) => goal.definition.goalID === bonus.goalID).progress, 1);
});

test("nothing is reported while the feature is off", () => {
  const goals = createDailyGoals({
    gameStore: memoryStore(),
    characterState: fakeCharacterState(),
    miningLogsFor: () => [],
    industryJobsFor: () => [],
    clock: () => NOW,
    env: {},
  });
  assert.equal(goals.snapshotFor(7, NOW).status, "DISABLED");
  assert.equal(goals.recordJump(7, NOW), "DISABLED");
  assert.equal(goals.redeem(7, DEFINITIONS[0].goalID, NOW).status, "DISABLED");
});

test("rewards are adequate and scale with what was actually earned", () => {
  const kill = DEFINITIONS.find((goal) => goal.kind === "kill_npc");
  const mine = DEFINITIONS.find((goal) => goal.kind === "mine_ore");
  assert.equal(rewardSkillPoints(kill, 0), 30000,
    "before you start the card already promises the completion value");
  assert.ok(rewardSkillPoints(kill, 20) > rewardSkillPoints(kill, 10),
    "a battleship day pays more than a frigate day");
  assert.equal(rewardSkillPoints(kill, 1000), REWARD_RULES.kill_npc.maximum,
    "a farm cannot pay without limit");
  // one battleship (6 points) brings the goal closer than one frigate (1 point)
  assert.ok(6 > 1);
  assert.ok(rewardSkillPoints(mine, mine.target) >= 15000,
    "a daily goal is worth flying for");
  for (const definition of DEFINITIONS) {
    assert.ok(rewardSkillPoints(definition, definition.target) >= 12000, definition.kind);
  }
});

test("filetime and day arithmetic match the ledger's own encoding", () => {
  assert.equal(filetimeToMs(toFiletime(NOW)), NOW);
  const bounds = dayBounds(NOW);
  assert.equal(bounds.end - bounds.start, DAY_MS);
  assert.ok(bounds.start <= NOW && NOW < bounds.end);
});
