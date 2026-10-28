// FW-056 guard: a long war must not run out of ledger.
//
// Review finding: `processed` has MAX_EVENTS (2000) entries and every money command
// returned WAR_TREASURY_EVENT_CAP once it was full - so an old world could never fund
// or pay another war, with a reason that reads like a broken treasury rather than a
// full history. Compaction must keep replay safety exact: the same command must still
// be refused as a duplicate, a DIFFERENT command under the same event id must still be
// a conflict, and no receipt may be replayed as a fresh settlement.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const treasury = require("../integration/coopWarTreasury.cjs");

const WAR = "war:500001-500011";
const CAMPAIGN = "war:500001-500011:campaign:30003837";

const oldCommand = (i) => ({ type: "RESERVE", eventID: `fw:reserve:old:${i}`,
  reservationID: `bounty:old:${i}`, corporationID: 1000138, factionID: 500011,
  warID: WAR, campaignID: `war:old:${i}`, amountCents: 100, minRemainingCents: 0 });

function setup(processedCount) {
  const processed = {};
  const commands = [];
  for (let i = 0; i < processedCount; i += 1) {
    const command = oldCommand(i);
    commands.push(command);
    processed[command.eventID] = { signature: JSON.stringify(command),
      receipt: { type: "RESERVE", reservationID: command.reservationID, at: 1000 + i } };
  }
  const data = new Map(Object.entries({
    "corporationRuntime\u001fcoop-faction-war\u001fstate-v1": {
      version: 1,
      wars: { [WAR]: { warID: WAR, attackerFactionID: 500001, defenderFactionID: 500011, state: "ACTIVE" } },
      campaigns: {}, territories: {}, enlistments: {}, processed: {}, history: [],
    },
    "corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1": {
      version: 1, nextJournalID: 8000000000000000, processed, reservations: {} },
    "corporationRuntime\u001fcorporations\u001f1000138": {
      corporationID: 1000138,
      wallet: { divisions: { "1000": { balance: 100000, journal: [], transactions: [] } } },
    },
  }));
  const tx = {
    get: (t, k) => (data.has(`${t}\u001f${k}`) ? structuredClone(data.get(`${t}\u001f${k}`)) : null),
    put: (t, k, v) => data.set(`${t}\u001f${k}`, structuredClone(v)),
  };
  const instance = treasury.createWarTreasury({
    gameStore: { data, coopAtomicNativeRows: { transact: (_t, m) => m(tx) } },
    verifyCorporation: () => true, authorizeRefund: () => true, authorizePayout: () => true,
    clock: () => 1793220000000,
    env: { EVEJS_COOP_FACTION_WAR: "1", EVEJS_COOP_WAR_TREASURY: "1", EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" },
  });
  return { instance, data, commands };
}

const fresh = (eventID) => ({ type: "RESERVE", eventID,
  reservationID: `bounty:${CAMPAIGN}:500011`, corporationID: 1000138, factionID: 500011,
  warID: WAR, campaignID: CAMPAIGN, amountCents: 2500000, minRemainingCents: 0 });

const savedState = (data) =>
  data.get("corporationRuntime\u001fcoop-faction-war\u001ftreasury-v1");

test("a full ledger compacts instead of refusing every future war", () => {
  const { instance, data } = setup(2000);
  const result = instance.execute(fresh("fw:reserve:new:500011"));
  assert.equal(result.status, "APPLIED", JSON.stringify(result));
  const saved = savedState(data);
  assert.ok(Object.keys(saved.processed).length < 2000, "the ledger made room");
  assert.ok(Object.keys(saved.archive || {}).length > 0, "the receipts became an archive");
});

test("a compacted command is still a duplicate, and never a fresh settlement", () => {
  const { instance, data, commands } = setup(2000);
  assert.equal(instance.execute(fresh("fw:reserve:new:500011")).status, "APPLIED");
  const archived = savedState(data).archive;
  const replayed = commands.find((command) => archived[command.eventID]);
  assert.ok(replayed, "the fixture must actually reach the archive");
  const replay = instance.execute(replayed);
  assert.equal(replay.status, "DUPLICATE");
  assert.equal(replay.archived, true);
  assert.equal(replay.receipt, null, "a replay must never look like a settlement");
});

test("a different command under an archived event id is still a conflict", () => {
  const { instance, data, commands } = setup(2000);
  assert.equal(instance.execute(fresh("fw:reserve:new:500011")).status, "APPLIED");
  const archived = savedState(data).archive;
  const original = commands.find((command) => archived[command.eventID]);
  const conflicting = instance.execute({ ...original, amountCents: 999 });
  assert.equal(conflicting.status, "BLOCKED");
  assert.equal(conflicting.reason, "WAR_TREASURY_EVENT_CONFLICT");
});
