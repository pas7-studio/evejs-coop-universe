// FW-110: a hull the pilot provably no longer flies may leave fleet custody.
//
// MEASURED on the play stack 2026-10-30: a restart re-materialized the front fleet with new
// entity ids while the registry kept the old ones (coop-pilot-002: registry 980000064153, real
// hull 980000067201). `verifyRelease` answered NATIVE_RELEASE_UNVERIFIED for every one of them
// - the old hull is neither in a scene nor destroyed with a wreck - so the pilots stayed
// PILOT_IN_USE for ever and the campaign fielded nothing. The replacement proof is not a
// destruction claim: it says the same pilot provably flies exactly one OTHER real ship.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createWarFleetRegistry } = require("../integration/coopWarFleetRegistry.cjs");

const env = { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" };
const CAMPAIGN = "war:1-2:campaign:3:r1";
const OLD = 980000064153;
const NEW = 980000067201;
const assign = { type: "ASSIGN", eventID: "assign:1", entityID: OLD,
  pilotID: "coop-pilot-002", systemID: 30003837, corporationID: 1000120, factionID: 500001,
  warID: "war:1-2", campaignID: CAMPAIGN, fleetID: "fw-c-500001",
  proofID: "native-muster:" + OLD };
const replaceProof = "native-replaced:" + CAMPAIGN + ":" + OLD + ":" + NEW;
const leave = (extra = {}) => ({ type: "RELEASE", eventID: "rel:stale:1", entityID: OLD,
  pilotID: "coop-pilot-002", fleetID: "fw-c-500001", currentEntityID: NEW,
  proofID: replaceProof, ...extra });

function fixture(proofs = {}) {
  const rows = new Map();
  const db = { coopAtomicNativeRows: { transact: (tables, fn) => {
    assert.deepEqual(tables, ["corporationRuntime"]);
    const staged = new Map(rows);
    const tx = { get: (t, k) => staged.get(t + ":" + k),
      put: (t, k, row) => staged.set(t + ":" + k, row) };
    const result = fn(tx);
    rows.clear();
    for (const [k, v] of staged) rows.set(k, v);
    return result;
  } } };
  const make = () => createWarFleetRegistry({ gameStore: db,
    verifyNativeShip: () => true, verifyCampaign: () => true, verifyRelease: () => false,
    clock: () => 1000, env, ...proofs });
  return { rows, make };
}

test("a hull the pilot provably left is released and the replacement is recorded", () => {
  const f = fixture({ verifyReplacement: () => true });
  const s = f.make();
  assert.equal(s.execute(assign).status, "APPLIED");
  const answer = s.execute(leave());
  assert.equal(answer.status, "APPLIED", JSON.stringify(answer));
  assert.equal(answer.receipt.custodyReplaced, true);
  assert.equal(answer.receipt.currentEntityID, NEW);
  assert.deepEqual(s.snapshot().ships, {});
  assert.equal(s.execute(leave()).status, "DUPLICATE");
});

test("a replacement proof must name the exact campaign, hull and successor", () => {
  const f = fixture({ verifyReplacement: () => true });
  const s = f.make();
  s.execute(assign);
  const wrong = s.execute(leave({ proofID: "native-release:" + CAMPAIGN + ":" + OLD }));
  assert.equal(wrong.reason, "NATIVE_RELEASE_UNVERIFIED",
    "the old, weaker proof can never release a hull that is neither idle nor destroyed");
  assert.equal(s.execute(leave({ currentEntityID: 0 })).reason, "NATIVE_RELEASE_UNVERIFIED");
  assert.equal(Object.keys(s.snapshot().ships).length, 1, "custody is untouched");
});

test("an unverified replacement still refuses, exactly like an unverified release", () => {
  const f = fixture({ verifyReplacement: () => false });
  const s = f.make();
  s.execute(assign);
  assert.equal(s.execute(leave()).reason, "NATIVE_RELEASE_UNVERIFIED");
  assert.equal(Object.keys(s.snapshot().ships).length, 1);
});

test("without a replacement authority the registry behaves exactly as before", () => {
  const f = fixture();
  const s = f.make();
  s.execute(assign);
  assert.equal(s.execute(leave()).reason, "NATIVE_RELEASE_UNVERIFIED");
});
