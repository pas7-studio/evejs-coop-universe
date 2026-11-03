import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Live regression 2026-11-03 (owner, F10 map): the map scene construction threw
//   TypeError: Could not match argument 0 to expected type: double
// in eve/client/script/ui/shared/mapView/filters/BaseMapFilterColorRange._GetColorCurveValue,
// called from MapFilterAllMilitias.GetStarColorAffected. The militia filter colours a
// star with GetFactionColor(occupationState.occupierID); fwwarzone FACTION_ID_TO_COLOR
// only knows the four empires, Angels, Gurisats and CONCORD. Our war state also assigns
// pirate factions (500019, 500020) as military controller, so the colour was None, the
// native GetValueAt(double) refused it and mapView._ConstructScene_thread aborted: the
// F10 map loaded for minutes and often never opened.
//
// The wire projection must therefore only ever carry client-colourable faction ids.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const view = require(path.join(forkRoot, "Code/server/src/space/coopWarClientView.js"));
const core = require(path.join(forkRoot, "Code/server/src/space/coopFactionWarCore.js"));

// fwwarzone/client/dashboard/const.py: FACTION_ID_TO_COLOR keys.
const COLORABLE = new Set([500001, 500002, 500003, 500004, 500006, 500011, 500012]);
const WARZONE_ID = 2;
const WARZONE_FACTIONS = [500001, 500002, 500003, 500004];

const buildKeyVal = (pairs) => Object.fromEntries(pairs);

function pirateControllerState() {
  const state = core.empty();
  state.wars["war:500020-500001"] = {
    warID: "war:500020-500001", state: "ACTIVE",
    attackerFactionID: 500020, defenderFactionID: 500001, declaredAt: 1,
  };
  // 30000142: held by pirate faction 500020, owned by Caldari 500001.
  state.territories["30000142"] = {
    systemID: 30000142, originalOwnerFactionID: 500001,
    militaryControllerFactionID: 500020, state: "OCCUPIED", revision: 1, changedAt: 1,
  };
  // 30000144: contested front, still controller 500020.
  state.territories["30000144"] = {
    systemID: 30000144, originalOwnerFactionID: 500001,
    militaryControllerFactionID: 500020, state: "CONTESTED", revision: 2, changedAt: 2,
  };
  state.campaigns["camp:1"] = {
    campaignID: "camp:1", warID: "war:500020-500001", state: "ASSAULT",
    sourceSystemID: 30000142, targetSystemID: 30000144, startedAt: 1,
    objectiveEvidence: [], revision: 2,
  };
  return state;
}

test("a pirate military controller never reaches the client as occupier", () => {
  const { entries } = view.occupationPairs(buildKeyVal, { [WARZONE_ID]: WARZONE_FACTIONS }, {
    state: pirateControllerState(),
  });
  assert.ok(entries.length > 0, "the contested systems must still be reported");
  for (const [systemID, entry] of entries) {
    for (const key of ["ownerID", "occupierID", "attackerID"]) {
      assert.equal(
        COLORABLE.has(entry[key]) || entry[key] === 0,
        true,
        `${systemID} ${key}=${entry[key]} is not a faction the client can colour`,
      );
    }
  }
  const bySystem = new Map(entries);
  // The occupier falls back to the real owner, so the star keeps a valid colour.
  assert.equal(bySystem.get(30000142).occupierID, 500001);
  assert.equal(bySystem.get(30000142).contested, true);
});

test("a system with no client-colourable side is dropped, not sent as 0", () => {
  const state = core.empty();
  state.territories["30000140"] = {
    systemID: 30000140, originalOwnerFactionID: 500020,
    militaryControllerFactionID: 500019, state: "SECURE", revision: 1, changedAt: 1,
  };
  const { entries } = view.occupationPairs(buildKeyVal, { [WARZONE_ID]: WARZONE_FACTIONS }, { state });
  assert.deepEqual(entries, []);
});

test("empire-only war state is unchanged by the guard", () => {
  const state = core.empty();
  state.territories["30000142"] = {
    systemID: 30000142, originalOwnerFactionID: 500001,
    militaryControllerFactionID: 500001, state: "SECURE", revision: 1, changedAt: 1,
  };
  const { entries } = view.occupationPairs(buildKeyVal, { [WARZONE_ID]: WARZONE_FACTIONS }, { state });
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].ownerID, 500001);
  assert.equal(entries[0][1].occupierID, 500001);
  assert.equal(entries[0][1].contested, false);
});
