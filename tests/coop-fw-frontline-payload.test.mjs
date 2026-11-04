import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Live client 2026-11-04 12:42:44: EXCEPTION #18 "KeyError: 30002803" while the
// theaters-of-war landing page loaded (Juunigaishi, security 0.62). The page picks
// the newest dateTaken across every published occupation state
// (fwwarzone/client/dashboard/mapData.GetSolarsystemWithMostRecentOccupancyChange)
// and indexes its own frontlines map with it (warZoneMap.py systems[focus_system_id]).
// The war state legitimately names belligerent systems of every touched region, so
// the payload must be restricted to the system set of the client's own
// res:/staticdata/warZonesPositionData.fsdbinary.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const view = require("../integration/coopWarClientView.cjs");
const core = require("../integration/coopFactionWarCore.cjs");
const {buildKeyVal, buildDict} = require(path.join(
  forkRoot, "Code/server/src/services/_shared/serviceHelpers.js"));

const WARZONES = {1: [500002, 500003], 2: [500001, 500004]};

function stateWithSystems(systemIDs) {
  const state = core.empty();
  state.wars["war:500001-500004"] = {
    warID: "war:500001-500004",
    state: "ACTIVE",
    attackerFactionID: 500001,
    defenderFactionID: 500004,
    declaredAt: 1,
  };
  for (const [index, systemID] of systemIDs.entries()) {
    state.territories[String(systemID)] = {
      systemID,
      originalOwnerFactionID: 500001,
      militaryControllerFactionID: 500001,
      state: "CONTESTED",
      revision: 1,
      // the newest change must stay on a system the client can draw
      changedAt: 1000 + index,
    };
  }
  return state;
}

function systemIDsOf(entries) {
  return entries.map(([systemID]) => systemID).sort((left, right) => left - right);
}

test("a published occupation state never names a system outside the client's map", () => {
  const state = stateWithSystems([30045324, 30003788, 30002803, 30000132]);
  const {entries} = view.occupationPairs(buildKeyVal, WARZONES, {state});
  const ids = systemIDsOf(entries);
  assert.ok(ids.includes(30045324), "Onnamon is on the frontlines map");
  assert.ok(ids.includes(30003788), "Intaki is on the frontlines map");
  assert.ok(!ids.includes(30002803), "Juunigaishi (0.62) is not on the map");
  assert.ok(!ids.includes(30000132), "Ansila (0.91) is not on the map");
});

test("the encoded warzone dict only carries map systems in the live warzone", () => {
  const state = stateWithSystems([30045324, 30002803]);
  const payload = view.warzonesResponse(buildKeyVal, buildDict, WARZONES, {state});
  const byWarzone = new Map(payload.entries.map(([warzoneID, dict]) => [
    Number(warzoneID),
    dict.entries.map(([systemID]) => Number(systemID)),
  ]));
  assert.deepEqual(byWarzone.get(2), [30045324]);
  assert.deepEqual(byWarzone.get(1), [], "the other warzone stays an empty shell");
});
