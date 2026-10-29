// FW-109: a bounty is earned INSIDE a live campaign, an opening reserve is not.
//
// MEASURED on the play stack 2026-10-30: every real front kill asked the treasury for a
// wallet-backed bounty and got the opaque BLOCKED, so the bounty never paid once even
// though the faction's own corporation wallet held money. The reserve path could not be
// reached at all: a RESERVE naming a campaign that already exists was refused by design,
// which is correct for an opening (money before the campaign) and wrong for a bounty.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createWarTreasury, TABLE, KEY, CORP_PREFIX } =
  require("../integration/coopWarTreasury.cjs");

const flags = () => ({ EVEJS_COOP_FACTION_WAR: "1",
  EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" });
const CAMPAIGN = "war:11-22:campaign:30000144";
const WAR = "war:11-22";
const bountyReserve = (extra = {}) => ({
  type: "RESERVE", purpose: "BOUNTY",
  eventID: "fw:wallet-reserve:" + CAMPAIGN + ":11:abc123",
  reservationID: "bounty:" + CAMPAIGN + ":11:abc123",
  corporationID: 31, factionID: 11, warID: WAR, campaignID: CAMPAIGN,
  amountCents: 100000, minRemainingCents: 0, ...extra,
});

function fixture({ funds = 300000, campaignState = "ASSAULT", funds2 = 0 } = {}) {
  const records = new Map();
  const corp = { corporationID: 31, wallet: { divisions: {
    "1000": { balance: funds, journal: [], transactions: [], marketTransactions: [] } } } };
  const war = { version: 1,
    wars: { [WAR]: { warID: WAR, state: "ACTIVE",
      attackerFactionID: 11, defenderFactionID: 22 } },
    campaigns: { [CAMPAIGN]: { campaignID: CAMPAIGN, warID: WAR,
      state: campaignState, targetSystemID: 30000144, revision: 2 } } };
  records.set(TABLE + ":" + CORP_PREFIX + 31, structuredClone(corp));
  records.set(TABLE + ":coop-faction-war\u001fstate-v1", structuredClone(war));
  assert.ok(funds2 >= 0);
  const gameStore = { coopAtomicNativeRows: { transact: (tables, fn) => {
    assert.deepEqual(tables, [TABLE]);
    const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
    const tx = { get: (t, k) => draft.get(t + ":" + k) || null,
      put: (t, k, v) => { draft.set(t + ":" + k, structuredClone(v)); } };
    const outcome = fn(tx);
    records.clear();
    for (const [k, v] of draft) records.set(k, v);
    return outcome;
  } } };
  const treasury = createWarTreasury({ gameStore, env: flags(), clock: () => 100000,
    verifyCorporation: ({ corporationID, factionID }) => corporationID === 31 && factionID === 11,
    authorizeRefund: () => true, authorizePayout: () => true });
  const wallet = () => records.get(TABLE + ":" + CORP_PREFIX + 31).wallet.divisions["1000"];
  const state = () => records.get(TABLE + ":" + KEY);
  return { treasury, wallet, state };
}

test("a bounty may take a real escrow against the campaign that is already fighting", () => {
  const f = fixture();
  const answer = f.treasury.execute(bountyReserve());
  assert.equal(answer.status, "APPLIED", JSON.stringify(answer));
  assert.equal(f.wallet().balance, 299000,
    "the money really left the corporation wallet (whole ISK balance, cents debited)");
  assert.equal(f.state().reservations[bountyReserve().reservationID].status, "HELD");
  assert.equal(f.wallet().journal.length, 1);
});

test("an opening reserve still cannot name a campaign that already exists", () => {
  const f = fixture();
  const opening = bountyReserve({ purpose: undefined,
    eventID: "fw:wallet-reserve:" + CAMPAIGN + ":11",
    reservationID: "supply:" + CAMPAIGN + ":11" });
  const answer = f.treasury.execute(opening);
  assert.equal(answer.status, "BLOCKED");
  assert.equal(answer.reason, "WAR_TREASURY_PURPOSE_UNAVAILABLE",
    "supply money is reserved before a campaign exists, never after");
  assert.equal(f.wallet().balance, 300000);
});

test("two kills take two escrows instead of colliding on one id", () => {
  const f = fixture();
  const first = f.treasury.execute(bountyReserve());
  const second = f.treasury.execute(bountyReserve({
    eventID: "fw:wallet-reserve:" + CAMPAIGN + ":11:def456",
    reservationID: "bounty:" + CAMPAIGN + ":11:def456" }));
  assert.equal(first.status, "APPLIED");
  assert.equal(second.status, "APPLIED", JSON.stringify(second));
  assert.equal(f.wallet().balance, 298000);
  assert.equal(Object.keys(f.state().reservations).length, 2);
});

test("a finished campaign can no longer earn a new bounty escrow", () => {
  const f = fixture({ campaignState: "OCCUPIED" });
  const answer = f.treasury.execute(bountyReserve());
  assert.equal(answer.status, "BLOCKED");
  assert.equal(answer.reason, "WAR_TREASURY_PURPOSE_UNAVAILABLE",
    "a won or expired campaign cannot be paid for a kill that can no longer happen");
  assert.equal(f.wallet().balance, 300000, "no ISK moves for an impossible bounty");
});

test("a faction that is not in this war can never reserve against it", () => {
  const f = fixture();
  const answer = f.treasury.execute(bountyReserve({ factionID: 99 }));
  assert.equal(answer.status, "BLOCKED");
  assert.equal(answer.reason, "WAR_TREASURY_FACTION_MISMATCH");
  assert.equal(f.wallet().balance, 300000);
});
