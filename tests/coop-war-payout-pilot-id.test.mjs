// FW-055 guard: the reason no bounty could EVER pay.
//
// Review finding: a payout names a co-op pilot, and every co-op pilot id is a string
// ("coop-pilot-027"). coopWarTreasury demanded `pos(command.pilotID)` - a positive
// INTEGER - and its row validator demanded `pos(r.paidToPilotID)` as well. So
// coopWarBounty.pay() -> PAYOUT was refused with INVALID_TREASURY_PAYOUT before a
// single cent could move, and any row that somehow stored the real id would have
// been rejected as WAR_TREASURY_CORRUPT_PAYOUT on the very next read. Attribution,
// escrow and merit were all working; the last step could not be taken by design.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");

const WAR = "war:500004-500011";
const CAMPAIGN = "war:500004-500011:campaign:30045344";
const RESERVATION = `bounty:${CAMPAIGN}:500004`;

function setup() {
  const data = new Map(Object.entries({
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": {
      version: 1,
      wars: { [WAR]: { warID: WAR, attackerFactionID: 500004, defenderFactionID: 500011, state: "ACTIVE" } },
      campaigns: { [CAMPAIGN]: { campaignID: CAMPAIGN, warID: WAR, sourceSystemID: 30003837,
        targetSystemID: 30045344, state: "ASSAULT", objectiveEvidence: [], revision: 2 } },
      territories: {}, enlistments: {}, processed: {}, history: [],
    },
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": {
      version: 1, nextJournalID: 8000000000000000, processed: {},
      reservations: {
        [RESERVATION]: { reservationID: RESERVATION, corporationID: 1000120, factionID: 500004,
          warID: WAR, campaignID: CAMPAIGN, cents: 2500000, status: "HELD", reservedAt: 1 },
      },
    },
    "corporationRuntime\u001fcorporations\u001f1000120": {
      corporationID: 1000120,
      wallet: { divisions: { "1000": { balance: 0, journal: [], transactions: [] } } },
    },
  }));
  const tx = {
    get: (t, k) => (data.has(`${t}\u001f${k}`) ? structuredClone(data.get(`${t}\u001f${k}`)) : null),
    put: (t, k, v) => data.set(`${t}\u001f${k}`, structuredClone(v)),
  };
  const instance = treasury.createWarTreasury({
    gameStore: { data, coopAtomicNativeRows: { transact: (_t, m) => m(tx) } },
    verifyCorporation: () => true,
    authorizeRefund: () => false,
    authorizePayout: () => true,
    clock: () => 1793220000000,
    env: { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" },
  });
  return { instance, data };
}

test("a real co-op pilot id is a valid payout target", () => {
  const { instance, data } = setup();
  const result = instance.execute({ type: "PAYOUT", eventID: "fw:bounty:x:1",
    reservationID: RESERVATION, corporationID: 1000120, pilotID: "coop-pilot-027",
    proofID: "wreck:980300000014" });
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  const saved = data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1");
  assert.equal(saved.reservations[RESERVATION].status, "PAID");
  assert.equal(saved.reservations[RESERVATION].paidToPilotID, "coop-pilot-027",
    "the row keeps the identifier it was really paid to");
  // the validator must accept the row it just wrote, or every later read would throw
  const snapshot = instance.snapshot();
  assert.equal(snapshot.reservations[RESERVATION].status, "PAID",
    "a PAID row with a real pilot id must validate on the next read");
});

test("an id that is not a pilot is still refused", () => {
  const { instance } = setup();
  for (const pilotID of ["nobody", "coop-pilot-", "coop-pilot-27x", "", 0, -5, 1.5]) {
    const result = instance.execute({ type: "PAYOUT", eventID: `fw:bounty:x:${String(pilotID)}`,
      reservationID: RESERVATION, corporationID: 1000120, pilotID, proofID: "wreck:980300000014" });
    assert.equal(result.status, "BLOCKED", `"${pilotID}" must never be paid`);
    assert.equal(result.reason, "INVALID_TREASURY_PAYOUT");
  }
});

test("a numeric pilot id still works, as it always did", () => {
  const { instance, data } = setup();
  const result = instance.execute({ type: "PAYOUT", eventID: "fw:bounty:x:num",
    reservationID: RESERVATION, corporationID: 1000120, pilotID: 27, proofID: "wreck:980300000014" });
  assert.equal(result.status, "APPLIED");
  assert.equal(data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1")
    .reservations[RESERVATION].status, "PAID");
});

test("a payout can only happen once per reservation", () => {
  const { instance } = setup();
  const command = { type: "PAYOUT", eventID: "fw:bounty:x:1", reservationID: RESERVATION,
    corporationID: 1000120, pilotID: "coop-pilot-027", proofID: "wreck:980300000014" };
  assert.equal(instance.execute(command).status, "APPLIED");
  assert.equal(instance.execute(command).status, "DUPLICATE");
  const other = instance.execute({ ...command, eventID: "fw:bounty:x:2" });
  assert.equal(other.status, "BLOCKED", "a PAID escrow is never released twice");
  assert.equal(other.reason, "INVALID_TREASURY_PAYOUT");
});
