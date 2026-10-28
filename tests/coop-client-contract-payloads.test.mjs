import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// The client is not a guess: these expectations are read straight out of the pinned
// client's own bytecode (code.ccp is a zip of .pyj modules). Each case names the field
// the client dereferences and the module that would throw without it. A server response
// that renames or drops a column is not a cosmetic change - it is an exception inside a
// window.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = (relative) => readFileSync(path.join(forkRoot, "Code/server/src", relative), "utf8");

// eve/client/script/ui/shared/neocom/... stationService callers:
//   data.Index('stationID')            (infoWindow station lookup)
//   .Index('stationID')[stationID].solarSystemID
test("map.GetStationInfo keeps the stationID column the client indexes", () => {
  const file = source("services/map/mapService.js");
  assert.match(file, /Handle_GetStationInfo\(/);
  assert.match(file, /stationID/);
  assert.match(file, /"solarSystemID"/, "the indexed row must still carry the system");
});

// starModeHandler.py: standingInfo = map.GetMyExtraMapInfoAgents().Index('fromID')
// The call is NOT guarded, so a rowset without fromID raises before the star mode draws.
test("map.GetMyExtraMapInfoAgents keeps the fromID column the client indexes", () => {
  const file = source("services/map/mapService.js");
  const columns = file.match(/AGENT_STANDING_COLUMNS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(columns, "the agent standing rowset must be declared");
  assert.match(columns[1], /"fromID"/);
});

// starModeHandler.py: for solarSystemID, ..., each.value1 - each.value2 in history rows;
// facWarSvc.GetMostDangerousSystems does the same for the faction-warfare history.
test("map.GetHistory rows keep solarSystemID/value1/value2", () => {
  const file = source("services/map/mapService.js");
  const columns = file.match(/HISTORY_COLUMNS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(columns);
  for (const column of ["solarSystemID", "value1", "value2"]) {
    assert.match(columns[1], new RegExp(`"${column}"`), column + " is read by the map filters");
  }
});

// facWarSvc.GetSolarSystemUpgradeLevel: warZoneInfo.systemUpgradeLevel.get(solarSystemID)
// and facWarSvc line 261: GetConstellationLPData(...).Index('solarSystemID').
test("the faction-warfare map rowsets keep their indexed columns", () => {
  const file = source("services/map/mapService.js");
  assert.match(file, /FW_LP_COLUMNS = Object\.freeze\(\["solarSystemID"/,
    "GetConstellationLPData is indexed by solarSystemID");
  assert.match(file, /Handle_GetFacWarZoneInfo\(/, "the upgrade level lookup needs an answer");
});

// corporation/warRegistry callers:
//   sm.RemoteSvc('warsInfoMgr').GetWarsByOwnerID(x).Index('warID')
test("warsInfoMgr.GetWarsByOwnerID keeps the warID column", () => {
  const file = source("services/corporation/warsInfoMgrService.js");
  assert.match(file, /Handle_GetWarsByOwnerID\(/);
  const columns = file.match(/WAR_DBROW_COLUMNS = \[([\s\S]*?)\n\];/);
  assert.ok(columns);
  assert.match(columns[1], /\["warID"/);
  assert.match(columns[1], /\["againstID"/, "the client reads againstID for the target name");
});

// fwWarzoneSvc.IsWarzoneSolarSystem/GetOccupationState are fed by these two, and
// warzoneMap.py/tile + advantage gauge index FACTION_ID_TO_COLOR with the values.
test("the warzone payload keeps the fields the client renders without defaults", () => {
  const view = readFileSync(path.join(process.cwd(), "integration/coopWarClientView.cjs"), "utf8");
  for (const field of ["ownerID", "occupierID", "attackerID", "contested", "adjacencyState"]) {
    assert.match(view, new RegExp(`\\["${field}"`), field + " must be in the occupation KeyVal");
  }
});

test("the faction-warfare manager keeps every getter the dashboard calls", () => {
  const file = source("services/faction/facWarMgrService.js");
  for (const method of [
    "GetFactionMilitiaCorporation", "GetCorpFactionalWarStatus", "GetCorporationWarFactionID",
    "GetAllianceWarFactionID", "GetFactionCorporations", "GetStats_Character", "GetStats_Corp",
    "GetStats_Alliance", "GetStats_TopAndAllKillsAndVPs", "GetStats_Militia", "GetStats_FactionInfo",
  ]) {
    assert.match(file, new RegExp(`Handle_${method}\\(`), method + " is called by the FW dashboard");
  }
});

test("onlineStatus.Prime sends a real rowset descriptor, not a column list",()=>{
 // eve/client/script/ui/shared/comtool/onlineStatus.py:
 //   self.onlineStatus[charID] = blue.DBRow(self.onlineStatus.header, [charID, True])
 // With a list header the client raises "TypeError: expected DBRow or DBRowDescriptor as
 // first argument" every time a contact logs in or out (measured on 140000107's client).
 const file = source("services/online/onlineStatusService.js");
 assert.match(file, /buildPackedRowDescriptor\(ONLINE_STATUS_COLUMNS\)/,
  "the header must be a blue.DBRowDescriptor");
 assert.doesNotMatch(file, /buildRowset\(ONLINE_STATUS_COLUMNS/,
  "a list header cannot be handed to blue.DBRow");
});
