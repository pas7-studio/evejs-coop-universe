// FW-085 guard: a refused border must not leave a funded side holding HELD ISK.
//
// Measured: with the both-sides rule, 500011's reservation was taken and then the border was
// refused because 500001 could not fund its own bounty. The 25 000 ISK stayed HELD against a
// campaign that was never created, and the retry uses a new campaign id, so the orphan-reuse
// path never saw it. The treasury may therefore refund a reservation whose campaign does not
// exist - but ONLY with an explicit `unfunded:` proof, so a live campaign can never use it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");

const WAR = "war:500001-500011";
const CAMPAIGN = "war:500001-500011:campaign:30003829:r3";
const RESERVATION = `bounty:${CAMPAIGN}:500011`;

function setup() {
  const data = new Map(Object.entries({
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": {
      version: 1,
      wars: { [WAR]: { warID: WAR, attackerFactionID: 500001, defenderFactionID: 500011, state: "ACTIVE" } },
      campaigns: {}, // the campaign was never created
      territories: {}, enlistments: {}, processed: {}, history: [],
    },
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": {
      version: 1, nextJournalID: 8000000000000000, processed: {},
      reservations: { [RESERVATION]: { reservationID: RESERVATION, corporationID: 1000138,
        factionID: 500011, warID: WAR, campaignID: CAMPAIGN, cents: 2500000,
        status: "HELD", reservedAt: 1 } },
    },
    "corporationRuntime\u001fcorporations\u001f1000138": { corporationID: 1000138,
      wallet: { divisions: { "1000": { balance: 0, journal: [], transactions: [] } } } },
  }));
  const tx = {
    get: (t, k) => (data.has(`${t}\u001f${k}`) ? structuredClone(data.get(`${t}\u001f${k}`)) : null),
    put: (t, k, v) => data.set(`${t}\u001f${k}`, structuredClone(v)),
  };
  return { data, instance: treasury.createWarTreasury({
    gameStore: { data, coopAtomicNativeRows: { transact: (_t, m) => m(tx) } },
    verifyCorporation: () => true, authorizeRefund: () => true, authorizePayout: () => false,
    clock: () => 1793220000000,
    env: { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" },
  }) };
}

test("an aborted opening releases the funded side's escrow", () => {
  const { instance, data } = setup();
  const result = instance.execute({ type: "REFUND", eventID: "fw:release:x",
    reservationID: RESERVATION, corporationID: 1000138, proofID: "unfunded:" + CAMPAIGN });
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  assert.equal(data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1")
    .reservations[RESERVATION].status, "REFUNDED");
  assert.equal(data.get("corporationRuntime\u001fcorporations\u001f1000138")
    .wallet.divisions["1000"].balance, 25000, "the exact ISK goes home");
});

test("without that proof a missing campaign still blocks the refund", () => {
  const { instance } = setup();
  const result = instance.execute({ type: "REFUND", eventID: "fw:release:y",
    reservationID: RESERVATION, corporationID: 1000138, proofID: "capture:" + CAMPAIGN });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "WAR_TREASURY_STILL_IN_USE");
});

test("the release is idempotent", () => {
  const { instance, data } = setup();
  const command = { type: "REFUND", eventID: "fw:release:x", reservationID: RESERVATION,
    corporationID: 1000138, proofID: "unfunded:" + CAMPAIGN };
  assert.equal(instance.execute(command).status, "APPLIED");
  assert.equal(instance.execute(command).status, "DUPLICATE");
  assert.equal(data.get("corporationRuntime\u001fcorporations\u001f1000138")
    .wallet.divisions["1000"].balance, 25000, "paid once");
});
