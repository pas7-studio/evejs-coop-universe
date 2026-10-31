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
