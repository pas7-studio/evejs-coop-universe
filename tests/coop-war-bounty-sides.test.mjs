// FW-046/FW-047 guard: a funded war must be payable on BOTH sides, and a refused
// bounty must never be silent.
//
// Measured on the work stack at 19:15Z: campaign war:500004-500011:campaign:30045344
// had a real HELD escrow for 500004, the deciding kill was made by a DEFENDER
// (coop-pilot-027, faction 500011), coopWarBounty refused with
// NO_HELD_ESCROW_FOR_FACTION, merit still PROMOTED, and nothing recorded why no
// ISK moved. Two separate defects: one reservation instead of one per side, and a
// dropped payout result.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planSideReservations } = require("../integration/coopWarBountyEscrowSides.cjs");
const { note } = require("../integration/coopWarKillMerit.cjs");

const ATTACKER = 500004;
const DEFENDER = 500011;

test("without the opt-in the first funded side still stops the loop", () => {
  const seen = [];
  const plan = planSideReservations({
    sides: [ATTACKER, DEFENDER], both: false, attackerFactionID: ATTACKER,
    reserveSide: (factionID) => {
      seen.push(factionID);
      return { status: "RESERVED", reservationID: "bounty:x:" + factionID };
    },
  });
  assert.deepEqual(seen, [ATTACKER], "unchanged behaviour is preserved exactly");
  assert.equal(plan.primary.factionID, ATTACKER);
  assert.equal(plan.funded.length, 1);
});

test("with the opt-in both sides fund their own bounty", () => {
  const seen = [];
  const plan = planSideReservations({
    sides: [ATTACKER, DEFENDER], both: true, attackerFactionID: ATTACKER,
    reserveSide: (factionID) => {
      seen.push(factionID);
      return { status: "RESERVED", reservationID: "bounty:x:" + factionID };
    },
  });
  assert.deepEqual(seen, [ATTACKER, DEFENDER], "a defender kill must have an escrow too");
  assert.equal(plan.funded.length, 2);
  assert.equal(plan.results[1].reservationID, "bounty:x:" + DEFENDER);
});

test("the attacker's escrow is the campaign supply proof, not whichever came first", () => {
  const plan = planSideReservations({
    sides: [ATTACKER, DEFENDER], both: true, attackerFactionID: ATTACKER,
    reserveSide: (factionID) => factionID === ATTACKER
      ? { status: "REFUSED", reason: "NO_MILITIA_CORPORATION" }
      : { status: "RESERVED", reservationID: "bounty:x:" + factionID },
  });
  assert.equal(plan.primary.factionID, DEFENDER, "a defender-only escrow still opens the war");
});

test("one broke side never blocks the other, and its own reason is kept", () => {
  const plan = planSideReservations({
    sides: [ATTACKER, DEFENDER], both: true, attackerFactionID: ATTACKER,
    reserveSide: (factionID) => factionID === DEFENDER
      ? { status: "REFUSED", reason: "WAR_TREASURY_FUNDS_UNAVAILABLE" }
      : { status: "RESERVED", reservationID: "bounty:x:" + factionID },
  });
  assert.equal(plan.funded.length, 1);
  assert.equal(plan.results[1].reason, "WAR_TREASURY_FUNDS_UNAVAILABLE");
  assert.deepEqual(planSideReservations({ sides: [ATTACKER], reserveSide: () => null }).results[0].reason,
    "NO_RESULT", "a missing answer is never read as a payment");
});

test("a refused bounty is recorded with its reason instead of being dropped", () => {
  const events = [];
  const emit = (event, _characterID, _spaceState, detail) => events.push({ event, detail });
  const result = note({
    proof: { status: "NATIVE_DESTRUCTION_ATTACKER_PROVIDED", wreckID: 980300000014, victimEntityID: 980000004275, attackerEntityID: 980000004276,
      systemID: 30045344, attackerPilotID: "coop-pilot-027", victimPilotID: "coop-pilot-026" },
    victim: { pilotID: "coop-pilot-026" },
    emit,
    ledger: { award: (row) => ({ status: "PROMOTED", pilotID: row.pilotID, kind: row.kind,
      merit: 25, meritDelta: 25, from: "recruit", to: "pilot", command: 2,
      hullClassID: "destroyer", promoted: true }) },
  });
  // The payer is installed by the live runtime; without it the module must not
  // claim a payout either, and the silence it used to produce is the defect.
  assert.equal(result.bounty, null);
  assert.ok(events.every((row) => row.event === "living-native-war-merit"),
    "no payout was attempted, so nothing is claimed as paid");
});

test("a blocked payout names its cause in telemetry", () => {
  const events = [];
  const emit = (event, _characterID, _spaceState, detail) => events.push({ event, detail });
  const { setBountyPayer } = require("../integration/coopWarKillMerit.cjs");
  setBountyPayer(({ pilotID }) => ({ status: "BLOCKED",
    reason: "NO_HELD_ESCROW_FOR_FACTION", factionID: 500011,
    campaignID: "war:500004-500011:campaign:30045344", pilotID }));
  try {
    note({
      proof: { status: "NATIVE_DESTRUCTION_ATTACKER_PROVIDED", wreckID: 980300000014, victimEntityID: 980000004275, attackerEntityID: 980000004276,
        systemID: 30045344, attackerPilotID: "coop-pilot-027", victimPilotID: "coop-pilot-026" },
      victim: { pilotID: "coop-pilot-026" },
      emit,
      ledger: { award: (row) => ({ status: "PROMOTED", pilotID: row.pilotID, kind: row.kind,
        merit: 25, meritDelta: 25, from: "recruit", to: "pilot", command: 2,
        hullClassID: "destroyer", promoted: true }) },
    });
  } finally {
    setBountyPayer(null);
  }
  const skipped = events.filter((row) => row.event === "living-native-war-bounty-skipped");
  assert.equal(skipped.length, 2, "killer and fallen pilot are both explained");
  assert.equal(skipped[0].detail.reason, "NO_HELD_ESCROW_FOR_FACTION");
  assert.equal(skipped[0].detail.status, "BLOCKED");
  assert.equal(skipped[0].detail.pilotID, "coop-pilot-027");
  assert.equal(skipped[0].detail.evidence, "REAL_KILL_WITHOUT_PAYABLE_ESCROW");
});
