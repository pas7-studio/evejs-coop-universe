// FW-054 guard: settled escrow rows are history and must not block future wars.
//
// Review finding: nothing ever pruned the reservation ledger, and RESERVE refuses
// once it holds MAX_RESERVATIONS (500) rows. Every campaign side leaves a row behind
// (REFUNDED or PAID), so a long-lived world would eventually refuse to fund a war
// forever - with the reason WAR_TREASURY_PURPOSE_UNAVAILABLE, which looks exactly
// like "this border has no money".
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");

const WAR = "war:500001-500011";
const CAMPAIGN = "war:500001-500011:campaign:30003837";

function store(rows) {
  const data = new Map(Object.entries(rows));
  const tx = {
    get: (t, k) => (data.has(`${t}\u001f${k}`) ? structuredClone(data.get(`${t}\u001f${k}`)) : null),
    put: (t, k, v) => data.set(`${t}\u001f${k}`, structuredClone(v)),
  };
  return { data, coopAtomicNativeRows: { transact: (_t, m) => m(tx) } };
}

// 500 settled rows: the exact cap that used to lock the ledger forever.
// A factory, never a shared object: a test that prunes must not shrink the next one.
const settledRows = () => {
 const settled = {};
 for (let i = 0; i < 500; i += 1) {
  settled[`bounty:old:${i}`] = { reservationID: `bounty:old:${i}`, corporationID: 1000138,
    factionID: 500011, warID: WAR, campaignID: `war:old:${i}`, cents: 100,
    status: i % 2 ? "PAID" : "REFUNDED", reservedAt: 1000 + i,
    paidAt: i % 2 ? 2000 + i : undefined, refundedAt: i % 2 ? undefined : 2000 + i,
    paidToPilotID: i % 2 ? "coop-pilot-001" : undefined,
    payoutProofID: i % 2 ? `wreck:${i}` : undefined };
 }
 return settled;
};

const warState = {
  version: 1,
  wars: { [WAR]: { warID: WAR, attackerFactionID: 500001, defenderFactionID: 500011, state: "ACTIVE" } },
  campaigns: {},
  territories: {}, enlistments: {}, processed: {}, history: [],
};

function setup() {
  const s = store({
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": warState,
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": {
      version: 1, nextJournalID: 8000000000000000, processed: {}, reservations: settledRows() },
    "corporationRuntime\u001fcorporations\u001f1000138": {
      corporationID: 1000138,
      wallet: { divisions: { "1000": { balance: 100000, journal: [], transactions: [] } } },
    },
  });
  return {
    s,
    treasury: treasury.createWarTreasury({
      gameStore: s,
      verifyCorporation: () => true,
      authorizeRefund: () => true,
      authorizePayout: () => true,
      clock: () => 1793220000000,
      env: { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" },
    }),
  };
}

test("a full ledger of settled rows still funds a new campaign", () => {
  const { s, treasury: t } = setup();
  const result = t.execute({ type: "RESERVE", eventID: "fw:reserve:new:500011",
    reservationID: `bounty:${CAMPAIGN}:500011`, corporationID: 1000138, factionID: 500011,
    warID: WAR, campaignID: CAMPAIGN, amountCents: 2500000, minRemainingCents: 0 });
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  assert.ok(result.receipt.prunedReservations > 0, "room is reported, not silently made");
  const saved = s.data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1");
  assert.equal(saved.reservations[`bounty:${CAMPAIGN}:500011`].status, "HELD");
});

test("pruning never drops a HELD escrow", () => {
  const { s, treasury: t } = setup();
  const rows = s.data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1").reservations;
  // one slot free, so the live escrow sits inside the cap and only history can move
  delete rows["bounty:old:0"];
  rows["bounty:live:1"] = { reservationID: "bounty:live:1", corporationID: 1000138,
    factionID: 500011, warID: WAR, campaignID: "war:live", cents: 2500000,
    status: "HELD", reservedAt: 1 };
  const result = t.execute({ type: "RESERVE", eventID: "fw:reserve:new2:500011",
    reservationID: `bounty:${CAMPAIGN}:500011`, corporationID: 1000138, factionID: 500011,
    warID: WAR, campaignID: CAMPAIGN, amountCents: 2500000, minRemainingCents: 0 });
  assert.equal(result.status, "APPLIED");
  const after = s.data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1").reservations;
  assert.equal(after["bounty:live:1"].status, "HELD", "real escrow is never history");
});
