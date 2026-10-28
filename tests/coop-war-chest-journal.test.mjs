// FW-058/FW-059 guard: the chest journal must compact instead of throwing, and a
// repeated credit must be exactly once.
//
// Review finding: `validateJournal` threw once the chest journal held more than 2048
// entries, so the whole chest (levy AND bounty credit) became unusable - every later
// war would answer WAR_CHEST_JOURNAL_INVALID rather than "full". And the bounty payout
// has two legs (release the escrow, credit the pilot); a failure between them left the
// ISK out of the escrow and never in the pilot's balance, with no retry. The retry is
// safe only because the credit is keyed by event id, which is what the last test pins.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const chestModule = require("../integration/coopWarChestFunding.cjs");

const WAR = "war:500001-500011";
const CAMPAIGN = "war:500001-500011:campaign:30003837";
const ENV = { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" };

function setup(committedCount) {
  const dir = mkdtempSync(join(tmpdir(), "chest-"));
  const journalFile = join(dir, "chest.json");
  const entries = {};
  for (let i = 0; i < committedCount; i += 1) {
    const journalID = `chest:old:${i}`;
    entries[journalID] = { journalID, phase: "COMMITTED", at: 1000 + i,
      factionID: 500011, corporationID: 1000138, warID: WAR, campaignID: `war:old:${i}`,
      totalCents: 2500000, transactionIDs: [7500000000000000 + i],
      sources: [{ pilotID: "coop-pilot-001", systemID: 30003837,
        beforeCents: 5000000, takeCents: 2500000 }] };
  }
  writeFileSync(journalFile, JSON.stringify({ version: 1, entries,
    nextJournalID: 7500000000000000 + committedCount }));
  const earned = new Map();
  const instance = chestModule.createWarChestFunding({
    gameStore: {
      coopAtomicNativeRows: { transact: (_tables, mutation) => mutation({
        get: () => ({ corporationID: 1000138,
          wallet: { divisions: { "1000": { balance: 100000, journal: [], transactions: [] } } } }),
        put: () => {},
      }) },
    },
    journalFile,
    readWarState: () => ({ wars: { [WAR]: { warID: WAR, attackerFactionID: 500001,
      defenderFactionID: 500011, state: "ACTIVE" } } }),
    adjustEarned: ({ pilotID, cents: amount, eventID }) => {
      if (earned.has(eventID)) {
        return earned.get(eventID) === `${pilotID}|${amount}`
          ? { status: "DUPLICATE", receipt: { pilotID, cents: amount } }
          : { status: "ADJUSTMENT_CONFLICT", eventID };
      }
      earned.set(eventID, `${pilotID}|${amount}`);
      return { status: "APPLIED", receipt: { pilotID, cents: amount, before: 0, after: amount / 100 } };
    },
    verifyCorporation: () => true,
    clock: () => 1793220000000,
    env: ENV,
  });
  return { instance, journalFile, dir, earned, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const levy = (eventID) => ({ factionID: 500011, corporationID: 1000138, warID: WAR,
  campaignID: CAMPAIGN, eventID, needCents: 2500000,
  pilots: [{ pilotID: "coop-pilot-001", factionID: 500011, systemID: 30003837 }],
  ledger: { pilots: { "coop-pilot-001": { balance: 50000 } } } });

test("a full chest journal compacts instead of throwing", () => {
  const { instance, journalFile, cleanup } = setup(1024);
  try {
    const result = instance.fund(levy("fw:levy:new"));
    assert.equal(result.status, "APPLIED", JSON.stringify(result));
    const saved = JSON.parse(readFileSync(journalFile, "utf8"));
    assert.ok(Object.keys(saved.entries).length <= 1024, "the journal made room");
    assert.ok(Object.keys(saved.archive || {}).length > 0, "the old levies became an archive");
  } finally { cleanup(); }
});

test("a compacted levy is a duplicate, never a second debit", () => {
  const { instance, journalFile, cleanup } = setup(1024);
  try {
    assert.equal(instance.fund(levy("fw:levy:new")).status, "APPLIED");
    const saved = JSON.parse(readFileSync(journalFile, "utf8"));
    const archivedID = Object.keys(saved.archive)[0];
    const eventID = archivedID.replace(/^chest:/, "");
    const replay = instance.fund({ ...levy(eventID), campaignID: saved.archive[archivedID].campaignID });
    assert.equal(replay.status, "DUPLICATE");
    assert.equal(replay.archived, true);
    assert.equal(replay.entry, null, "a replay must never look like a fresh levy");
  } finally { cleanup(); }
});

test("a different levy under an archived event id is a conflict", () => {
  const { instance, journalFile, cleanup } = setup(1024);
  try {
    assert.equal(instance.fund(levy("fw:levy:new")).status, "APPLIED");
    const saved = JSON.parse(readFileSync(journalFile, "utf8"));
    const archivedID = Object.keys(saved.archive)[0];
    const eventID = archivedID.replace(/^chest:/, "");
    // same event id, different purpose: a levy for another campaign
    const conflicting = instance.fund({ ...levy(eventID), campaignID: "war:other:campaign:1" });
    assert.equal(conflicting.status, "BLOCKED");
    assert.equal(conflicting.reason, "WAR_CHEST_EVENT_CONFLICT");
  } finally { cleanup(); }
});

test("crediting the same payout twice moves the money exactly once", () => {
  const { instance, earned, cleanup } = setup(0);
  try {
    const credit = { pilotID: "coop-pilot-027", cents: 2500000,
      eventID: `war-bounty:${CAMPAIGN}:wreck:980300000014` };
    assert.equal(instance.creditPilot(credit).status, "APPLIED");
    const again = instance.creditPilot(credit);
    assert.equal(again.status, "DUPLICATE", "the reconcile pass may replay this safely");
    assert.equal(earned.size, 1, "one credit, one ledger entry");
  } finally { cleanup(); }
});

test("a credit for a player pilot is accepted and a stranger is not", () => {
  const { instance, cleanup } = setup(0);
  try {
    assert.equal(instance.creditPilot({ pilotID: "coop-player-90000001", cents: 2500000,
      eventID: "war-bounty:p:1" }).status, "APPLIED");
    assert.equal(instance.creditPilot({ pilotID: "someone", cents: 2500000,
      eventID: "war-bounty:p:2" }).status, "BLOCKED");
  } finally { cleanup(); }
});
