// FW-140 guard: a war nobody can fight must stop being called a war - but only the
// navy authority may say so, and a war that has a live or captured campaign is never
// touched. Measured 2026-10-31T17:40Z: war:500004-500014 and war:500014-500019 carried
// an ORE attacker (NO_NAVY) and produced six EXPIRED campaigns for one target while the
// world still reported seven ACTIVE wars.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createWarRetirement } = require("../integration/coopWarRetirement.cjs");
const warStore = require("../integration/coopFactionWarStore.cjs");

const ON = {
  EVEJS_COOP_FACTION_WAR: "1",
  EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1",
};

function baseWar(campaignState = "EXPIRED") {
  return {
    version: 1,
    wars: {
      "war:500004-500014": { warID: "war:500004-500014", state: "ACTIVE",
        attackerFactionID: 500014, defenderFactionID: 500004 },
    },
    territories: {
      30002642: { systemID: 30002642, originalOwnerFactionID: 500004,
        militaryControllerFactionID: 500004, state: "CONTESTED", revision: 2, changedAt: 1 },
    },
    campaigns: {
      c1: {
        campaignID: "c1", warID: "war:500004-500014", attackerFactionID: 500014,
        defenderFactionID: 500004, sourceSystemID: 30000144, targetSystemID: 30002642,
        supplyReservationID: "paper:x", state: campaignState, startedAt: 1,
        objectiveEvidence: [], revision: 1,
        ...(campaignState === "EXPIRED" ? { expiredAt: 2, expiredReason: "NO_ASSAULT_DEPLOYMENT_PROOF" } : {}),
      },
    },
    enlistments: {},
    processed: {},
    history: [],
  };
}

function store({ war = baseWar() } = {}) {
  const rows = new Map();
  rows.set(warStore.KEY, war);
  return {
    coopAtomicNativeRows: {
      transact: (tables, fn) => fn({
        get: (table, key) => rows.get(key) || null,
        put: (table, key, value) => rows.set(key, value),
      }),
    },
    war: () => rows.get(warStore.KEY),
  };
}

const noNavy = () => ({ open: false, reason: "NO_NAVY_CAPABILITY:ATTACKER" });
const bothNavies = () => ({ open: true, reason: "BOTH_SIDES_CAN_FIELD_NAVY" });

test("a war whose attacker has no navy is retired and really ENDED", () => {
  const s = store();
  const api = createWarRetirement({ gameStore: s, navyCapability: noNavy,
    env: ON, clock: () => 100000 });
  const result = api.tick();
  assert.equal(result.status, "RETIRED");
  assert.equal(result.ended.length, 1);
  assert.equal(result.ended[0].warID, "war:500004-500014");
  assert.equal(result.ended[0].reason, "NO_NAVY_CAPABILITY:ATTACKER");
  assert.equal(s.war().wars["war:500004-500014"].state, "ENDED");
});

test("a war that is really fighting is never touched", () => {
  const s = store({ war: baseWar("ASSAULT") });
  const api = createWarRetirement({ gameStore: s, navyCapability: noNavy,
    env: ON, clock: () => 100000 });
  const result = api.tick();
  assert.equal(result.status, "NO_CHANGE");
  assert.equal(result.ended.length, 0);
  assert.equal(result.skips[0].reason, "WAR_IS_FIGHTING");
  assert.equal(s.war().wars["war:500004-500014"].state, "ACTIVE");
});

test("a captured territory also counts as a fight, so the war stays", () => {
  const s = store({ war: baseWar("OCCUPIED") });
  const api = createWarRetirement({ gameStore: s, navyCapability: noNavy,
    env: ON, clock: () => 100000 });
  assert.equal(api.tick().status, "NO_CHANGE");
  assert.equal(s.war().wars["war:500004-500014"].state, "ACTIVE");
});

test("both sides able to field a navy keeps the war", () => {
  const s = store();
  const api = createWarRetirement({ gameStore: s, navyCapability: bothNavies,
    env: ON, clock: () => 100000 });
  const result = api.tick();
  assert.equal(result.status, "NO_CHANGE");
  assert.equal(result.skips[0].reason, "BOTH_SIDES_CAN_FIELD_NAVY");
  assert.equal(s.war().wars["war:500004-500014"].state, "ACTIVE");
});

test("the proof is re-measured: a navy that appears mid-tick blocks the retirement", () => {
  const s = store();
  let calls = 0;
  const flaky = () => {
    calls += 1;
    return calls === 1 ? { open: false, reason: "NO_NAVY_CAPABILITY:ATTACKER" }
      : { open: true, reason: "BOTH_SIDES_CAN_FIELD_NAVY" };
  };
  const api = createWarRetirement({ gameStore: s, navyCapability: flaky,
    env: ON, clock: () => 100000 });
  const result = api.tick();
  assert.equal(result.status, "NO_CHANGE");
  assert.equal(result.skips[0].reason, "RETIREMENT_REJECTED");
  assert.equal(s.war().wars["war:500004-500014"].state, "ACTIVE");
});

// MEASURED 17:54:21Z: two wars were retired in one tick and only the second one stayed
// ENDED, because each transition cloned the state read at the start of the tick and the
// later put overwrote the earlier retirement.
test("two wars retired in the same tick both stay ENDED", () => {
  const war = baseWar();
  war.wars["war:500014-500019"] = { warID: "war:500014-500019", state: "ACTIVE",
    attackerFactionID: 500014, defenderFactionID: 500019 };
  war.campaigns.c2 = { ...war.campaigns.c1, campaignID: "c2", warID: "war:500014-500019",
    targetSystemID: 30002642, supplyReservationID: "paper:y" };
  const s = store({ war });
  const api = createWarRetirement({ gameStore: s, navyCapability: noNavy,
    env: ON, clock: () => 100000 });
  const result = api.tick();
  assert.equal(result.ended.length, 2);
  assert.equal(s.war().wars["war:500004-500014"].state, "ENDED");
  assert.equal(s.war().wars["war:500014-500019"].state, "ENDED");
});

test("the phase is off unless the war really runs", () => {
  const s = store();
  const api = createWarRetirement({ gameStore: s, navyCapability: noNavy,
    env: {}, clock: () => 100000 });
  assert.equal(api.tick().status, "DISABLED");
  assert.equal(s.war().wars["war:500004-500014"].state, "ACTIVE");
});
