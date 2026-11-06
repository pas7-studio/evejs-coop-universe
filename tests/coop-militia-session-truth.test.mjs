import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-05 (owner): "the war ended and a new one started, why am I not in my faction
// again, and I cannot re-enlist". The enlistment record said LEFT while the character record
// still carried warFactionID = 500001, and the session copied that field, so the client's
// CurrentlyInSameFaction() believed he was still serving and never offered the enlist flow.
// The enlistment record is the only truth; this module is its single reader for session/UI.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const SERVER = path.join(forkRoot, "Code/server/src");
const militia = require(path.join(SERVER, "space/coopMilitiaSession.js"));

function fakeStore(enlistments) {
  return {
    read(table, key) {
      assert.equal(table, "corporationRuntime");
      assert.equal(key, "/");
      return {success: true, data: {"coop-faction-war": {"state-v1": {version: 1, enlistments}}}};
    },
  };
}

const ACTIVE = {"140000005": {characterID: 140000005, factionID: 500001, status: "ACTIVE",
  rank: 2, enlistedAt: 1793229228518, cooldownUntil: 0}};
const LEFT = {"140000005": {characterID: 140000005, factionID: 500001, status: "LEFT",
  rank: 0, enlistedAt: 1793229228518, leftAt: 1793735429495, cooldownUntil: 0}};

test("an ACTIVE enlistment is the faction the session may advertise", () => {
  assert.equal(militia.militiaFactionFor(140000005, fakeStore(ACTIVE)), 500001);
  assert.equal(militia.enlistmentStateFor(140000005, fakeStore(ACTIVE)), 1);
});

test("a LEFT enlistment advertises NO faction, whatever the character record says", () => {
  const store = fakeStore(LEFT);
  assert.equal(militia.militiaFactionFor(140000005, store), 0,
    "a pilot who left must not read as enlisted - that is what hid the enlist flow");
  assert.equal(militia.enlistmentStateFor(140000005, store), 2);
  const row = militia.readEnlistment(140000005, store);
  assert.equal(row.leftAt, 1793735429495, "the leave stays on record for the UI history");
  assert.equal(row.cooldownUntil, 0, "a cleared cooldown means re-enlisting is allowed");
});

test("no record at all is 'never enlisted', and an unknown character is not a crash", () => {
  assert.equal(militia.militiaFactionFor(140000107, fakeStore({})), 0);
  assert.equal(militia.enlistmentStateFor(140000107, fakeStore({})), 0);
  assert.equal(militia.militiaFactionFor(0, fakeStore({})), 0);
  assert.equal(militia.readEnlistment(140000005, fakeStore({})), null);
});

test("a broken store only means 'unknown', never a wrong faction", () => {
  const broken = {read() { throw new Error("STORAGE_DOWN"); }};
  assert.equal(militia.militiaFactionFor(140000005, broken), 0);
  assert.equal(militia.readEnlistment(140000005, broken), null);
});

test("the war window asks the enlistment record, not the record's leftover field", () => {
  const warSource = fs.readFileSync(path.join(SERVER, "services/faction/facWarMgrService.js"), "utf8");
  assert.match(warSource, /function syncWarFactionSession\(session\)/,
    "the FW window corrects a stale session flag before answering");
  assert.match(warSource, /const enlistmentFaction = militiaOf\(/,
    "resolveWarFactionID asks the enlistment record first");
  assert.match(warSource, /Handle_GetCorpFactionalWarStatus\(args, session\) \{\n    if \(session\) syncWarFactionSession\(session\);/, 
    "and the status handler is where the client learns it");
});

// MEASURED 2026-11-06 (owner: "the Caldari State threw me out of the war again", while the
// enlistment row and GetCorpFactionalWarStatus both said ACTIVE for faction 500001). A pilot who
// logs in ALREADY IN SPACE takes characterState's initial-space-character-selection path, which
// FILTERS the login SessionChange down to INITIAL_SPACE_CHARACTER_SESSION_CHANGE_KEYS. That list
// did not contain `warfactionid`, so the client's session never learned his militia:
// factionwarfare/client/enlistmentChecks.pyj CurrentlyInSameFaction() is
// `factionID == session.warfactionid`, so the FW window showed him as not enlisted. The live
// login SessionChange was logged with exactly 17 keys and warfactionid was not among them.
test("a pilot who logs in in space is still told his militia faction", () => {
  const stateSource = fs.readFileSync(path.join(SERVER, "services/character/characterState.js"), "utf8");
  const start = stateSource.indexOf("const INITIAL_SPACE_CHARACTER_SESSION_CHANGE_KEYS = [");
  assert.ok(start > 0, "the initial-space key list must exist");
  const end = stateSource.indexOf("];", start);
  const list = stateSource.slice(start, end);
  assert.match(list, /"warfactionid"/,
    "without this key the client reads session.warfactionid = None and offers Enlist again");
  assert.match(stateSource, /appendSessionChange\(\s*sessionChanges,\s*"warfactionid",/,
    "the change itself is still appended from the character record");
});
