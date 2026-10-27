import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildEnlistHint } = require("../integration/coopMilitiaEnlistHint.cjs");

const faction = { factionID: 500001, name: "Caldari State", militiaCorporationID: 1000180 };
const agents = [{ agentID: 3010879, agentName: "Okamainen Niuranto", stationID: 60000358 }];
const station = { stationID: 60000358, stationName: "Perimeter VI - Ytiri Storage", solarSystemID: 30000144, solarSystemName: "Perimeter" };

test("a character docked elsewhere is told exactly where to fly", () => {
  const hint = buildEnlistHint({
    record: { characterID: 140000005, stationID: 60015262 },
    faction, agents, stations: station,
  });
  assert.equal(hint.status, "ENLIST_ELSEWHERE");
  assert.equal(hint.agentID, 3010879);
  assert.equal(hint.stationName, "Perimeter VI - Ytiri Storage");
  assert.equal(hint.solarSystemName, "Perimeter");
  assert.match(hint.instruction, /Perimeter VI - Ytiri Storage/);
  assert.match(hint.instruction, /Okamainen Niuranto/);
});

test("a character already at the agent's station is told to just accept", () => {
  const hint = buildEnlistHint({
    record: { characterID: 140000005, stationID: 60000358 },
    faction, agents, stations: station,
  });
  assert.equal(hint.status, "ENLIST_HERE");
  assert.match(hint.instruction, /accept the enlistment/);
});

test("no real agent means no hint, never an invented one", () => {
  assert.equal(buildEnlistHint({ record: { characterID: 1, stationID: 2 }, faction, agents: [], stations: station }), null);
  assert.equal(buildEnlistHint({ record: { characterID: 1, stationID: 2 }, faction: null, agents, stations: station }), null);
  assert.equal(buildEnlistHint({}), null);
});

test("an agent without a station is not a usable answer", () => {
  assert.equal(buildEnlistHint({
    record: { characterID: 1, stationID: 2 },
    faction,
    agents: [{ agentID: 5, agentName: "in space", stationID: 0 }],
    station,
  }), null);
});

test("a station record that does not match the agent is not claimed as the venue", () => {
  const hint = buildEnlistHint({
    record: { characterID: 1, stationID: 2 },
    faction, agents,
    station: { stationID: 999, stationName: "Somewhere Else", solarSystemID: 1, solarSystemName: "X" },
  });
  assert.equal(hint.status, "ENLIST_ELSEWHERE");
  assert.equal(hint.stationName, "");
  assert.match(hint.instruction, /station 60000358/);
});
