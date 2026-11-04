import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const view = require("../integration/coopWarClientView.cjs");
const core = require("../integration/coopFactionWarCore.cjs");

// Live client 2026-11-03 22:38:41: EXCEPTION #33 "KeyError: 30000132" while the
// theaters-of-war landing page loaded. It picks the newest dateTaken across every
// occupation state (fwwarzone/client/dashboard/mapData.GetSolarsystemWithMostRecentOccupancyChange)
// and then indexes its own frontlines map: systems[focus_system_id]. Any system we publish
// that the client's map does not render therefore kills the warzone window, so the payload
// may only carry systems from the warzone set the client actually draws.
function stateWithFarFront() {
  const state = core.empty();
  state.wars["war:500010-500014"] = {
    warID: "war:500010-500014",
    state: "ACTIVE",
    attackerFactionID: 500010,
    defenderFactionID: 500014,
    declaredAt: 1,
  };
  // 30000142 is a real warzone system, 30000132 (Ansila) is not on the client's map.
  state.campaigns["camp:1"] = {
    campaignID: "camp:1",
    warID: "war:500010-500014",
    state: "ASSAULT",
    sourceSystemID: 30000142,
    targetSystemID: 30000132,
    startedAt: 1,
    objectiveEvidence: [],
    revision: 2,
  };
  state.territories["30000142"] = {
    systemID: 30000142,
    originalOwnerFactionID: 500010,
    militaryControllerFactionID: 500010,
    state: "SECURE",
    revision: 1,
    changedAt: 1,
  };
  return state;
}

test("a front outside the rendered warzone never reaches the payload", () => {
  const state = stateWithFarFront();
  const payload = view.warzoneOccupationStates(state, {
    factionIDs: [500010],
    systems: [{solarSystemID: 30000142, factionID: 500010}],
  });
  assert.ok(payload[30000142], "the warzone system must be published");
  assert.equal(
    payload[30000132],
    undefined,
    "Ansila is not on the client's frontlines map and would raise KeyError",
  );
});

test("without a systems list the old behaviour is kept", () => {
  const state = stateWithFarFront();
  const payload = view.warzoneOccupationStates(state, {factionIDs: [500010]});
  assert.ok(payload[30000132], "no filter requested means no filtering");
});
