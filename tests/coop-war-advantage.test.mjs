// FW-034 guard: the client's faction-warfare advantage surfaces must be derived
// from real evidence (war state, war fleet registry, casualty ledger) and must
// never invent progress for a side that has no kills and no hulls.
import test from "node:test";
import assert from "node:assert/strict";
import { createWarAdvantage, LOSS_WEIGHT, HULL_WEIGHT, DEFAULT_THRESHOLD } from "../integration/coopWarAdvantage.cjs";

const WAR_KEY = "coop-faction-war\u001fstate-v1";
const FLEET_KEY = "coop-faction-war\u001ffleet-registry-v1";
const CASUALTY_KEY = "coop-faction-war\u001fcasualties-v1";

function store({ war, fleet, casualties }) {
  return {
    read: (table, p) => {
      const key = String(p).replace(/^\//, "").replace("/", "\u001f");
      const rows = { [WAR_KEY]: war, [FLEET_KEY]: fleet, [CASUALTY_KEY]: casualties };
      const row = rows[key];
      return row ? { success: true, data: row } : { success: false, error: "ENTRY_NOT_FOUND" };
    },
  };
}

const WAR = {
  version: 1,
  wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE", attackerFactionID: 500004, defenderFactionID: 500001 } },
  campaigns: { c1: { campaignID: "c1", warID: "war:a-b", state: "ASSAULT", targetSystemID: 30045344 } },
  territories: {
    30045344: { systemID: 30045344, originalOwnerFactionID: 500001, militaryControllerFactionID: 500001, state: "CONTESTED" },
    30003837: { systemID: 30003837, originalOwnerFactionID: 500004, militaryControllerFactionID: 500004, state: "SECURE" },
  },
};

const FLEET = {
  version: 1,
  ships: {
    1: { entityID: 1, systemID: 30045344, factionID: 500001 },
    2: { entityID: 2, systemID: 30045344, factionID: 500004 },
    3: { entityID: 3, systemID: 30045344, factionID: 500004 },
  },
};

const CASUALTIES = {
  version: 1,
  count: 2,
  byWreck: {
    900: { wreckID: 900, systemID: 30045344, entityID: 11, pilotID: "coop-pilot-011", victimFactionID: 500004, corporationID: 1000120, warID: "war:a-b", campaignID: "c1", observedAt: 1, attribution: "NATIVE_VICTIM_WRECK_ONLY_NO_KILLER", kind: "WARSHIP_DESTROYED" },
    901: { wreckID: 901, systemID: 30045344, entityID: 12, pilotID: "coop-pilot-012", victimFactionID: 500001, corporationID: 1000035, warID: "war:a-b", campaignID: "c1", observedAt: 2, attribution: "NATIVE_VICTIM_WRECK_ONLY_NO_KILLER", kind: "WARSHIP_DESTROYED" },
  },
};

const ON = { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_ADVANTAGE: "1" };

test("scores come from real wrecks and real hulls, per faction and system", () => {
  const view = createWarAdvantage({
    gameStore: store({ war: WAR, fleet: FLEET, casualties: CASUALTIES }),
    env: ON,
    clock: () => 1000,
  });
  const out = view.snapshot();
  assert.equal(out.status, "OBSERVED");
  const system = out.systems["30045344"];
  const caldari = system.scores.find(s => s.factionID === 500001);
  const gallente = system.scores.find(s => s.factionID === 500004);
  // Caldari: one Gallente wreck taken (1000) + one hull present (100).
  assert.equal(caldari.contribution, LOSS_WEIGHT + HULL_WEIGHT);
  assert.equal(caldari.lossesTaken, 1);
  assert.equal(caldari.hulls, 1);
  // Gallente: one Caldari wreck taken (1000) + two hulls present (200).
  assert.equal(gallente.contribution, LOSS_WEIGHT + 2 * HULL_WEIGHT);
  assert.equal(system.score, Math.max(caldari.contribution, gallente.contribution));
  assert.equal(system.threshold, DEFAULT_THRESHOLD);
  assert.equal(system.contested, true);
  // A system with no wrecks and no hulls scores zero, not a fake progress.
  const quiet = out.systems["30003837"];
  assert.equal(quiet.score, 0);
});

test("victory point states match the per-system score for every war system", () => {
  const view = createWarAdvantage({
    gameStore: store({ war: WAR, fleet: FLEET, casualties: CASUALTIES }),
    env: ON,
    clock: () => 1000,
  });
  const states = view.victoryPointStates();
  assert.deepEqual(Object.keys(states).sort(), ["30003837", "30045344"]);
  assert.equal(states["30045344"].threshold, DEFAULT_THRESHOLD);
  assert.equal(states["30045344"].score, LOSS_WEIGHT + 2 * HULL_WEIGHT);
});

test("the gateway score list carries both factions and never a negative value", () => {
  const view = createWarAdvantage({
    gameStore: store({ war: WAR, fleet: FLEET, casualties: CASUALTIES }),
    env: ON,
    clock: () => 1000,
  });
  const scores = view.scoresFor(30045344);
  assert.equal(scores.length, 2);
  assert.deepEqual(scores.map(s => s.factionID).sort(), [500001, 500004]);
  for (const score of scores) assert.ok(score.contribution >= 0 && score.floor === 0);
  assert.deepEqual(view.scoresFor(1), []);
});

test("flag OFF or a missing war row is a clean empty answer, never a throw", () => {
  const off = createWarAdvantage({
    gameStore: store({ war: WAR, fleet: FLEET, casualties: CASUALTIES }),
    env: { EVEJS_COOP_FACTION_WAR: "1" },
    clock: () => 1000,
  });
  assert.equal(off.snapshot().status, "DISABLED");
  assert.deepEqual(off.victoryPointStates(), {});
  const missing = createWarAdvantage({
    gameStore: store({}),
    env: ON,
    clock: () => 1000,
  });
  assert.equal(missing.snapshot().status, "WAR_STATE_UNAVAILABLE");
  assert.deepEqual(missing.scoresFor(30045344), []);
});

test("a war with no active belligerents scores nothing", () => {
  const view = createWarAdvantage({
    gameStore: store({
      war: { ...WAR, wars: { "war:a-b": { warID: "war:a-b", state: "ENDED", attackerFactionID: 500004, defenderFactionID: 500001 } } },
      fleet: FLEET,
      casualties: CASUALTIES,
    }),
    env: ON,
    clock: () => 1000,
  });
  assert.equal(view.snapshot().status, "NO_ACTIVE_WAR");
});

test("authorities are required", () => {
  assert.throws(() => createWarAdvantage({}), /WAR_ADVANTAGE_AUTHORITIES_REQUIRED/);
});

test("the client can represent every score it is given", () => {
 // factionwarfare/advantageState.py: contribution and floor are divided by 100000 and
 // must stay within (0.0, 1.0) with the pair summing to at most 1.0, otherwise
 // CreateAdvantageStateFromActivityState raises ValueError and the advantages tab
 // shows nothing at all. A fleet's raw weighted points can exceed that domain.
 // 300 losses is 300k weighted points, three times what the client can hold.
 const byWreck = {};
 for (let index = 0; index < 300; index += 1) {
  const wreckID = 9000 + index;
  byWreck[wreckID] = { wreckID, systemID: 30045344, entityID: 4000 + index,
   pilotID: "coop-pilot-0" + (index % 100), victimFactionID: 500004,
   corporationID: 1000181, warID: "war:a-b", campaignID: "c1",
   observedAt: 1000 + index,
   attribution: "NATIVE_VICTIM_WRECK_ONLY_NO_KILLER", kind: "WARSHIP_DESTROYED" };
 }
 const casualties = { version: 1, count: 300, byWreck };
 const view = createWarAdvantage({gameStore: store({war: WAR, fleet: FLEET, casualties}), env: ON});
 const scores = view.scoresFor(30045344);
 assert.ok(scores.length > 0);
 for (const score of scores) {
  assert.ok(score.contribution >= 0 && score.contribution <= 100000,
   "contribution inside the client domain: " + score.contribution);
  assert.ok(score.floor >= 0 && score.contribution + score.floor <= 100000);
 }
});

test("every system the warzone payload lists has a victory point state", () => {
 // In EVEJS_COOP_FW_ALL_SYSTEMS=1 mode the occupation payload lists every static warzone
 // system, and warzoneStats.py dereferences `victoryPointsState.contestedFraction` for each
 // one: a missing entry is an AttributeError, not an empty progress bar.
 const view = createWarAdvantage({
  gameStore: store({war: WAR, fleet: FLEET, casualties: CASUALTIES}),
  env: {...ON, EVEJS_COOP_FW_ALL_SYSTEMS: "1"},
 });
 const states = view.victoryPointStates();
 assert.ok(Object.keys(states).length > 0);
 for (const [systemID, state] of Object.entries(states)) {
  assert.ok(Number.isSafeInteger(state.score) && state.score >= 0, systemID + " score");
  assert.ok(state.threshold > 0, systemID + " threshold");
 }
 // the real system keeps its real score, the rest are honest zeros
 assert.equal(states[30045344].score, 1000 + 200);
});
