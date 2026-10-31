import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {createPilotPayroll, CORP_PREFIX} = require('../integration/coopPilotPayroll.cjs');

const CORP = 1000129;

// A native-looking corporation row with a real wallet division and its journals.
function nativeGameStore(seedBalance = 1000) {
  const rows = new Map([[CORP_PREFIX + CORP, {
    corporationID: CORP,
    wallet: {divisions: {'1000': {balance: seedBalance, journal: [], transactions: []}}},
  }]]);
  return {
    rows,
    coopAtomicNativeRows: {
      transact: (tables, fn) => fn({
        get: (_table, key) => rows.get(key),
        put: (_table, key, value) => rows.set(key, value),
      }),
    },
  };
}

function ledger() {
  const balances = new Map();
  const eventIDs = new Set();
  return {
    balances,
    earned: ({pilotID, cents, eventID}) => {
      if (eventIDs.has(eventID)) return {status: 'DUPLICATE'};
      eventIDs.add(eventID);
      balances.set(pilotID, (balances.get(pilotID) || 0) + cents);
      return {status: 'APPLIED', receipt: {pilotID, cents}};
    },
  };
}

function payrollFor({store, book, journalFile}) {
  return createPilotPayroll({gameStore: store, adjustEarned: book.earned,
    journalFile, env: {EVEJS_COOP_NPC_PAYROLL: '1'}, clock: () => 1793456000000});
}

const tempJournal = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coop-payroll-')),
  'payroll.json');

test('a salary moves real corporation ISK into the pilot\'s earned balance, once', () => {
  const store = nativeGameStore(1000);
  const book = ledger();
  const journalFile = tempJournal();
  const payroll = payrollFor({store, book, journalFile});

  const answer = payroll.pay({corporationID: CORP, pilotID: 'coop-pilot-006',
    cents: 25000, reason: 'blueprint', eventID: 'bp-785'});
  assert.equal(answer.status, 'PAID');
  assert.equal(book.balances.get('coop-pilot-006'), 25000, 'the pilot really has the ISK');
  const division = store.rows.get(CORP_PREFIX + CORP).wallet.divisions['1000'];
  assert.equal(division.balance, 750, 'the wallet really paid it out (1000.00 - 250.00)');
  assert.equal(division.transactions.length, 1);
  assert.equal(division.transactions[0].amount, -250);

  // One eventID, one salary: the sweep can retry all it likes.
  const again = payroll.pay({corporationID: CORP, pilotID: 'coop-pilot-006',
    cents: 25000, reason: 'blueprint', eventID: 'bp-785'});
  assert.equal(again.status, 'DUPLICATE');
  assert.equal(book.balances.get('coop-pilot-006'), 25000);
});

test('a pilot is never paid more than the corporation wallet holds', () => {
  const store = nativeGameStore(10);
  const book = ledger();
  const payroll = payrollFor({store, book, journalFile: tempJournal()});
  const answer = payroll.pay({corporationID: CORP, pilotID: 'coop-pilot-001',
    cents: 5000, eventID: 'too-much'});
  assert.equal(answer.status, 'BLOCKED');
  assert.equal(answer.reason, 'WALLET_INSUFFICIENT');
  assert.equal(book.balances.get('coop-pilot-001'), undefined);
  assert.equal(store.rows.get(CORP_PREFIX + CORP).wallet.divisions['1000'].balance, 10);
});

test('an unreadable corporation wallet pays nobody', () => {
  const store = nativeGameStore(1000);
  store.rows.delete(CORP_PREFIX + CORP);
  const book = ledger();
  const payroll = payrollFor({store, book, journalFile: tempJournal()});
  const answer = payroll.pay({corporationID: CORP, pilotID: 'coop-pilot-001',
    cents: 100, eventID: 'no-wallet'});
  assert.equal(answer.status, 'BLOCKED');
  assert.equal(answer.reason, 'WALLET_UNVERIFIED');
  assert.equal(book.balances.size, 0);
});

test('payroll is off unless it is explicitly enabled', () => {
  const store = nativeGameStore(1000);
  const book = ledger();
  const payroll = createPilotPayroll({gameStore: store, adjustEarned: book.earned,
    journalFile: tempJournal(), env: {}, clock: () => 1});
  assert.equal(payroll.pay({corporationID: CORP, pilotID: 'p', cents: 100, eventID: 'x'}).status,
    'DISABLED');
  assert.equal(book.balances.size, 0);
});

test('a failed credit leaves an open record instead of a silent loss', () => {
  const store = nativeGameStore(1000);
  const journalFile = tempJournal();
  const payroll = createPilotPayroll({gameStore: store,
    adjustEarned: () => ({status: 'LEDGER_DOWN'}),
    journalFile, env: {EVEJS_COOP_NPC_PAYROLL: '1'}, clock: () => 1});
  const answer = payroll.pay({corporationID: CORP, pilotID: 'coop-pilot-001',
    cents: 100, eventID: 'half'});
  assert.equal(answer.status, 'NEEDS_OPERATOR_REPAIR');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  assert.equal(journal.entries.half.phase, 'PREPARED', 'the open record can still be finished');
});

test('recovery finishes a salary whose wallet was debited but whose pilot was not credited', () => {
  const store = nativeGameStore(1000);
  const book = ledger();
  const journalFile = tempJournal();
  const broken = createPilotPayroll({gameStore: store,
    adjustEarned: () => ({status: 'LEDGER_DOWN'}),
    journalFile, env: {EVEJS_COOP_NPC_PAYROLL: '1'}, clock: () => 1});
  broken.pay({corporationID: CORP, pilotID: 'coop-pilot-001', cents: 100, eventID: 'open'});
  const payroll = payrollFor({store, book, journalFile});
  const answer = payroll.recover();
  assert.equal(answer.status, 'RECOVERED');
  assert.equal(book.balances.get('coop-pilot-001'), 100);
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  assert.equal(journal.entries.open.phase, 'COMMITTED');
});

// The corporation wallet is owned by corporationRuntimeState, not by the `corporations` table:
// measured 2026-10-31 every salary was blocked because the atomic bridge refuses that table
// (ATOMIC_TABLE_ALLOWLIST_VIOLATION) while the corporation really held 1.45 billion ISK.
function runtimeWallet(seedBalance = 1000) {
  const state = {balance: seedBalance, debits: [], credits: []};
  return {
    state,
    readWallet: () => ({status: "OK", divisions: {"1000": {balance: state.balance}}}),
    applyDelta: ({delta}) => {
      const next = Math.round((state.balance + Number(delta)) * 100) / 100;
      if (next < 0) return {status: "CORP_WALLET_INSUFFICIENT", balance: state.balance};
      state.balance = next;
      (Number(delta) < 0 ? state.debits : state.credits).push(Number(delta));
      return {status: "OK", moved: Math.abs(Number(delta)), balance: next};
    },
  };
}

test('a salary paid through the real corporation wallet debits it once', () => {
  const wallet = runtimeWallet(150000);
  const book = ledger();
  const journalFile = tempJournal();
  const payroll = createPilotPayroll({gameStore: {}, adjustEarned: book.earned,
    corpWallet: wallet, journalFile, env: {EVEJS_COOP_NPC_PAYROLL: '1'}});
  const paid = payroll.pay({pilotID: "coop-pilot-007", cents: 10000000,
    reason: "purchase 35", eventID: "purchase:coop-pilot-007:35:1"});
  assert.equal(paid.status, "PAID");
  assert.equal(wallet.state.balance, 50000, "100 000 ISK really left the corporation");
  assert.deepEqual(wallet.state.debits, [-100000]);
  assert.equal(book.balances.get("coop-pilot-007"), 10000000);
  const again = payroll.pay({pilotID: "coop-pilot-007", cents: 10000000,
    reason: "purchase 35", eventID: "purchase:coop-pilot-007:35:1"});
  assert.equal(again.status, "DUPLICATE", "the same hour pays once");
  assert.equal(wallet.state.balance, 50000);
});

test('a salary whose debit outcome is unknown is never paid twice', () => {
  const wallet = runtimeWallet(1000);
  const book = ledger();
  const journalFile = tempJournal();
  const payroll = createPilotPayroll({gameStore: {}, adjustEarned: book.earned,
    corpWallet: wallet, journalFile, env: {EVEJS_COOP_NPC_PAYROLL: '1'}});
  // A crash between the debit and the credit leaves PENDING on disk.
  fs.writeFileSync(journalFile, JSON.stringify({version: 1, entries: {}, nextJournalID: 2}));
  const raw = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  raw.entries["purchase:coop-pilot-008:35:2"] = {journalID: "purchase:coop-pilot-008:35:2",
    phase: "PREPARED", corporationID: CORP, pilotID: "coop-pilot-008", cents: 10000000,
    reason: "purchase 35", transactionID: 9, at: 1, debit: "PENDING"};
  fs.writeFileSync(journalFile, JSON.stringify(raw));
  const answer = payroll.pay({pilotID: "coop-pilot-008", cents: 10000000,
    reason: "purchase 35", eventID: "purchase:coop-pilot-008:35:2"});
  assert.equal(answer.status, "NEEDS_OPERATOR_REPAIR");
  assert.equal(wallet.state.debits.length, 0, "no second debit is attempted");
  const recovered = payroll.recover();
  assert.equal(recovered.finished[0].status, "NEEDS_OPERATOR_REPAIR");
});
