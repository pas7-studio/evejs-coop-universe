// The payout rung, proven in one process with the REAL modules wired the way the runtime
// wires them - no live world, no luck.
//
// Everything downstream of a kill had only ever been observed piecemeal: escrow, merit and
// capture were each seen, but `war-bounty PAID` never was, and every attempt to see it live
// depended on a campaign surviving long enough to produce a kill. This test drives the same
// modules the server uses (treasury -> chest -> bounty -> credit) with in-memory authorities
// and asserts the exact movement of 5 000 ISK out of a HELD escrow into the pilot's earned
// balance. If it fails, it fails with the module's own status and reason.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");
const chest = require("../integration/coopWarChestFunding.cjs");
const bounty = require("../integration/coopWarBounty.cjs");

const WAR = "war:500001-500011";
const CAMPAIGN = "war:500001-500011:campaign:30045338";
const RESERVATION = `bounty:${CAMPAIGN}:500001`;
const KILLER = "coop-pilot-007";
const VICTIM = "coop-pilot-003";
const CORP = 1000035;          // the killer's militia corporation
const BOUNTY_CENTS = 500000;   // 5 000 ISK, the price the agents stack runs with

const ENV = { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" };

function world() {
  const dir = mkdtempSync(join(tmpdir(), "war-payout-"));
  const stateRow = {
    version: 1,
    wars: { [WAR]: { warID: WAR, attackerFactionID: 500001, defenderFactionID: 500011, state: "ACTIVE" } },
    campaigns: { [CAMPAIGN]: { campaignID: CAMPAIGN, warID: WAR, sourceSystemID: 30003829,
      targetSystemID: 30045338, state: "ASSAULT", objectiveEvidence: [], revision: 2 } },
    territories: {}, enlistments: {}, processed: {}, history: [],
  };
  const treasuryRow = {
    version: 1, nextJournalID: 8000000000000000, processed: {},
    reservations: { [RESERVATION]: { reservationID: RESERVATION, corporationID: CORP,
      factionID: 500001, warID: WAR, campaignID: CAMPAIGN, cents: BOUNTY_CENTS,
      status: "HELD", reservedAt: 1 } },
  };
  const rows = {
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": stateRow,
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": treasuryRow,
    "corporationRuntime\u001fcorporations\u001f1000035": { corporationID: CORP,
      wallet: { divisions: { "1000": { balance: 0, journal: [], transactions: [] } } } },
  };
  const data = new Map(Object.entries(rows));
  const tx = {
    get: (t, k) => (data.has(`${t}\u001f${k}`) ? structuredClone(data.get(`${t}\u001f${k}`)) : null),
    put: (t, k, v) => data.set(`${t}\u001f${k}`, structuredClone(v)),
  };
  const gameStore = { data, coopAtomicNativeRows: { transact: (_tables, mutation) => mutation(tx) } };

  const earned = new Map();
  const adjustEarned = ({ pilotID, cents: amount, eventID }) => {
    if (earned.has(eventID)) return earned.get(eventID) === `${pilotID}|${amount}`
      ? { status: "DUPLICATE", receipt: { pilotID, cents: amount } }
      : { status: "ADJUSTMENT_CONFLICT", eventID };
    earned.set(eventID, `${pilotID}|${amount}`);
    return { status: "APPLIED", receipt: { pilotID, cents: amount, before: 0, after: amount / 100 } };
  };

  const treasuryInstance = treasury.createWarTreasury({
    gameStore,
    verifyCorporation: () => true,
    authorizeRefund: ({ war, campaign }) => (war && war.state === "ENDED") ||
      ["CANCELLED", "EXPIRED", "OCCUPIED"].includes(String(campaign && campaign.state || "")),
    authorizePayout: ({ factionID, pilotID, campaign }) => Boolean(campaign) &&
      factionOfPilot(pilotID) === Number(factionID),
    clock: () => 1793220000000,
    env: ENV,
  });

  const chestInstance = chest.createWarChestFunding({
    gameStore,
    journalFile: join(dir, "chest.json"),
    readWarState: () => stateRow,
    adjustEarned,
    verifyCorporation: () => true,
    clock: () => 1793220000000,
    env: ENV,
  });

  const links = [
    { pilotID: KILLER, entityID: 980000001001, systemID: 30045338, role: "patrol" },
    { pilotID: VICTIM, entityID: 980000001002, systemID: 30045338, role: "patrol" },
  ];
  // Exactly the wiring the runtime hands the payer: the casualty ledger row is written
  // before attribution, and the fleet registry binds the hull to its campaign.
  const casualties = { byWreck: { "980300000047": { entityID: 980000001002,
    pilotID: VICTIM, systemID: 30045338, campaignID: CAMPAIGN, warID: WAR } } };
  const bountyInstance = bounty.createWarBounty({
    gameStore,
    treasury: treasuryInstance,
    chest: chestInstance,
    readWarState: () => stateRow,
    readLinks: () => links,
    readCasualties: () => casualties,
    readCampaignForEntity: (entityID) => (Number(entityID) === 980000001002
      ? { campaignID: CAMPAIGN } : null),
    getNativeEntity: (entityID) => ({ entityID, corporationID: CORP, systemID: 30045338 }),
    getFactionForCorporation: (corporationID) => (Number(corporationID) === CORP ? 500001 : 0),
    emit: () => {},
    clock: () => 1793220000000,
    env: ENV,
  });

  return { bountyInstance, treasuryInstance, data, earned, dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The bounty decides the killer's faction from its real corporation, exactly like the server.
function factionOfPilot(pilotID) {
  return /^coop-pilot-00[37]$/.test(String(pilotID)) ? 500001 : 0;
}

test("a real kill releases the HELD escrow to the pilot's earned balance", () => {
  const { bountyInstance, data, earned, cleanup } = world();
  try {
    const paid = bountyInstance.pay({ pilotID: KILLER, kind: "warship-kill",
      wreckID: 980300000047, victimEntityID: 980000001002, proofID: "wreck:980300000047" });
    assert.equal(paid.status, "PAID", JSON.stringify(paid));
    assert.equal(paid.amountCents, BOUNTY_CENTS);
    assert.equal(paid.factionID, 500001);
    assert.equal(paid.campaignID, CAMPAIGN);
    const row = data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1")
      .reservations[RESERVATION];
    assert.equal(row.status, "PAID", "the escrow row records the settlement");
    assert.equal(row.paidToPilotID, KILLER);
    assert.equal(earned.size, 1, "the pilot's balance was credited exactly once");
    assert.equal(paid.earnedAfter, BOUNTY_CENTS / 100);
  } finally { cleanup(); }
});

test("replaying the same payout moves the money exactly once", () => {
  const { bountyInstance, earned, cleanup } = world();
  try {
    const args = { pilotID: KILLER, kind: "warship-kill", wreckID: 980300000047,
      victimEntityID: 980000001002, proofID: "wreck:980000300047" };
    assert.equal(bountyInstance.pay(args).status, "PAID");
    const again = bountyInstance.pay(args);
    assert.equal(again.status, "ALREADY_PAID", JSON.stringify(again));
    assert.equal(earned.size, 1, "one credit, never two");
  } finally { cleanup(); }
});

test("a campaign with no escrow for the killer's faction pays nothing", () => {
  const { bountyInstance, data, cleanup } = world();
  try {
    // Only the DEFENDER side is funded now.
    const row = data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1")
      .reservations[RESERVATION];
    row.factionID = 500011;
    const paid = bountyInstance.pay({ pilotID: KILLER, kind: "warship-kill",
      wreckID: 980300000047, victimEntityID: 980000001002, proofID: "wreck:980300000047" });
    assert.equal(paid.status, "BLOCKED");
    assert.equal(paid.reason, "NO_HELD_ESCROW_FOR_FACTION");
  } finally { cleanup(); }
});

test("a kill with no campaign behind it pays nothing", () => {
  const { bountyInstance, cleanup } = world();
  try {
    const paid = bountyInstance.pay({ pilotID: KILLER, kind: "warship-kill",
      wreckID: 111111, victimEntityID: 222222, proofID: "wreck:111111" });
    assert.equal(paid.status, "BLOCKED");
    assert.equal(paid.reason, "NO_REAL_CAMPAIGN_FOR_EVENT");
  } finally { cleanup(); }
});
