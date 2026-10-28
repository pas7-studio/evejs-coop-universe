import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const require = createRequire(import.meta.url);
const view = require("../integration/coopFactionWarMgrView.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));

// The pinned server implemented only the four rank getters on facWarMgr, so every other
// call fell through baseService's "Unhandled method" branch and answered null. The client
// then did cfg.eveowners.Get(null).name and factionalWarStatus.startDate on None while
// building the faction-warfare dashboard, so the dashboard threw instead of opening.
const factionRecords = {
  500001: {factionID: 500001, militiaCorporationID: 1000180},
  500004: {factionID: 500004, militiaCorporationID: 1000181},
  500019: {factionID: 500019, militiaCorporationID: 0},
};
const getFactionRecord = (factionID) => factionRecords[Number(factionID)] || null;

test("the militia corporation comes from the native faction record", () => {
  assert.equal(view.militiaCorporation(500001, {getFactionRecord}), 1000180);
  assert.equal(view.militiaCorporation(500004, {getFactionRecord}), 1000181);
});

test("a faction without a militia answers null instead of inventing a corporation", () => {
  assert.equal(view.militiaCorporation(500019, {getFactionRecord}), null);
  assert.equal(view.militiaCorporation(999999, {getFactionRecord}), null);
  assert.equal(view.militiaCorporation(0, {getFactionRecord}), null);
  assert.equal(view.militiaCorporation(500001, {}), null, "no authority, no answer");
});

test("a character with no militia has no corporation war status", () => {
  assert.equal(view.corpFactionalWarStatus({charData: {}, session: {}}), null);
  assert.equal(view.corpFactionalWarStatus({}), null);
});

test("an enlisted character reports an ACTIVE status with a numeric start date", () => {
  const status = view.corpFactionalWarStatus({
    charData: {warFactionID: 500001}, nowMs: 1700000000000,
  });
  assert.equal(status.status, view.CORPORATION_ACTIVE, "appConst.facwarCorporationActive");
  assert.equal(status.factionID, 500001);
  assert.equal(typeof status.startDate, "number", "the client subtracts it from the wallclock");
  assert.ok(status.startDate > 116444736000000000, "a real FILETIME, not zero");
});

test("the session war faction is honoured when the record does not carry one", () => {
  const status = view.corpFactionalWarStatus({
    charData: {}, session: {warfactionid: 500004}, nowMs: 1700000000000,
  });
  assert.equal(status.factionID, 500004);
});

test("the fork service answers all five client getters from this projection", () => {
  // A stock omission, not a co-op rule: the client calls these on every dashboard open.
  const source = readFileSync(path.join(
    process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs",
    "Code/server/src/services/faction/facWarMgrService.js",
  ), "utf8");
  for (const method of [
    "GetFactionMilitiaCorporation", "GetCorpFactionalWarStatus",
    "GetCorporationWarFactionID", "GetAllianceWarFactionID", "GetFactionCorporations",
  ]) {
    assert.match(source, new RegExp(`Handle_${method}\\(`), `${method} must be handled`);
  }
  assert.match(source, /coopFactionWarMgrView/,
    "the projection lives in the deployable module, not inline in the stock service");
  assert.doesNotMatch(source, /militiaCorporationID:\s*1000/,
    "a corporation is read from native state, never hardcoded");
});
