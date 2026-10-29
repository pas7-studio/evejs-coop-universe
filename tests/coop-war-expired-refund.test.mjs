// FW-053 guard: escrow of an EXPIRED campaign must go back to the corporation that paid it.
//
// Review finding: the opener expires a PREPARING campaign that never produced an assault
// proof (that is how a squatted target is released), but nothing released its money -
// the treasury only refunded a war that ENDED or a campaign that was CANCELLED, and the
// live runtime supplied no authorizeRefund at all. Measured 22:5xZ:
// war:500011-500020:campaign:30045343 was EXPIRED while its 2 500 000-cent reservation
// stayed HELD, i.e. real ISK locked with no campaign that could ever spend it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");

const CAMPAIGN = "war:500001-500011:campaign:30003837";
const WAR = "war:500001-500011";

// A minimal in-memory GameStore that behaves like the atomic adapter: one row per
// (table, key), read inside a transaction, written back whole.
function fakeStore(rows) {
  const data = new Map(Object.entries(rows));
  const tx = {
    get: (table, key) => (data.has(`${table}\u001f${key}`) ? structuredClone(data.get(`${table}\u001f${key}`)) : null),
    put: (table, key, value) => data.set(`${table}\u001f${key}`, structuredClone(value)),
  };
  return {
    data,
    coopAtomicNativeRows: { transact: (_tables, mutation) => mutation(tx) },
  };
}

const CORP_DIVISION = (balance) => ({
  corporationID: 1000138,
  wallet: { divisions: { "1000": { balance, journal: [{ transactionID: 5, amount: 0 }], transactions: [] } } },
});

function warState(campaignState) {
  return {
    version: 1,
    wars: { [WAR]: { warID: WAR, attackerFactionID: 500001, defenderFactionID: 500011, state: "ACTIVE" } },
    campaigns: {
      [CAMPAIGN]: { campaignID: CAMPAIGN, warID: WAR, sourceSystemID: 30003836,
        targetSystemID: 30003837, state: campaignState, objectiveEvidence: [], revision: 1 },
    },
    territories: {}, enlistments: {}, processed: {}, history: [],
  };
}

function setup(campaignState) {
  const reservationID = `bounty:${CAMPAIGN}:500011`;
  const store = fakeStore({
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": warState(campaignState),
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": {
      version: 1, nextJournalID: 8000000000000000, processed: {},
      reservations: {
        [reservationID]: { reservationID, corporationID: 1000138, factionID: 500011,
          warID: WAR, campaignID: CAMPAIGN, cents: 2500000, status: "HELD", reservedAt: 1 },
      },
    },
    "corporationRuntime\u001fcorporations\u001f1000138": CORP_DIVISION(0),
  });
  const instance = treasury.createWarTreasury({
    gameStore: store,
    verifyCorporation: () => true,
    authorizeRefund: ({ campaign }) => ["CANCELLED", "EXPIRED", "OCCUPIED"].includes(String(campaign && campaign.state)),
    authorizePayout: () => false,
    clock: () => 1793220000000,
    env: { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" },
  });
  return { instance, store, reservationID };
}

test("an expired campaign may refund its held escrow", () => {
  const { instance, store, reservationID } = setup("EXPIRED");
  const result = instance.execute({ type: "REFUND", eventID: "fw:refund:x:500011",
    reservationID, corporationID: 1000138, proofID: "expire:" + CAMPAIGN });
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  const saved = store.data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1");
  assert.equal(saved.reservations[reservationID].status, "REFUNDED");
  const division = store.data.get("corporationRuntime\u001fcorporations\u001f1000138").wallet.divisions["1000"];
  assert.equal(division.balance, 25000, "the exact ISK the reservation held goes back");
});

test("a still-fighting campaign may never refund its escrow", () => {
  const { instance, reservationID } = setup("ASSAULT");
  const result = instance.execute({ type: "REFUND", eventID: "fw:refund:y:500011",
    reservationID, corporationID: 1000138, proofID: "expire:" + CAMPAIGN });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "WAR_TREASURY_STILL_IN_USE");
});

test("a cancelled campaign still refunds, as before", () => {
  const { instance, reservationID } = setup("CANCELLED");
  const result = instance.execute({ type: "REFUND", eventID: "fw:refund:z:500011",
    reservationID, corporationID: 1000138, proofID: "ceasefire:" + WAR });
  assert.equal(result.status, "APPLIED");
});

test("a refund is idempotent: replaying the same event never pays twice", () => {
  const { instance, store, reservationID } = setup("EXPIRED");
  const command = { type: "REFUND", eventID: "fw:refund:x:500011",
    reservationID, corporationID: 1000138, proofID: "expire:" + CAMPAIGN };
  assert.equal(instance.execute(command).status, "APPLIED");
  const again = instance.execute(command);
  assert.equal(again.status, "DUPLICATE");
  const division = store.data.get("corporationRuntime\u001fcorporations\u001f1000138").wallet.divisions["1000"];
  assert.equal(division.balance, 25000, "the wallet is credited exactly once");
});

test("a WON campaign refunds too: no further kill of that campaign can pay", () => {
  const { instance, store, reservationID } = setup("OCCUPIED");
  const result = instance.execute({ type: "REFUND", eventID: "fw:refund:won:500011",
    reservationID, corporationID: 1000138, proofID: "capture:" + CAMPAIGN });
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  const division = store.data.get("corporationRuntime\u001fcorporations\u001f1000138").wallet.divisions["1000"];
  assert.equal(division.balance, 25000, "the escrow behind a finished campaign goes home");
});
