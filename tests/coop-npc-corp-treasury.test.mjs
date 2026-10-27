import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const treasury = require('../integration/coopNpcCorpTreasury.cjs');

// The ore belongs to the corporation, so the corporation must be paid: measured live, the
// pilots held 98 402 ISK while the corp wallet stayed at 0, and the refinery's real
// station fee (4 998-23 760 ISK) could never be paid.
function fixture(t, {balances = {}, corpBalance = 0, writeFails = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-treasury-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const ledger = {version: 1, pilots: {}};
  for (const [pilotID, balance] of Object.entries(balances)) {
    ledger.pilots[pilotID] = {balance, lastTradeAt: 0, tradeCount: 1};
  }
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(ledger));
  const wallet = {divisions: {1000: {balance: corpBalance}}};
  const gameStore = {
    read(table, pointer) {
      assert.equal(table, 'corporationRuntime');
      assert.equal(pointer, '/corporations/1000129/wallet');
      return {success: true, data: structuredClone(wallet)};
    },
    write(table, pointer, value) {
      if (writeFails) return {success: false, errorMsg: 'SIMULATED_WRITE_FAILURE'};
      wallet.divisions = structuredClone(value.divisions);
      return {success: true};
    },
    flushTableSync() { return {success: true}; },
  };
  const events = [];
  const env = {EVEJS_COOP_CORP_TREASURY: '1'};
  return {
    dir, env,
    run: () => treasury.run({env, root: dir, gameStore, now: 1234,
      observe: (_p, event, _s, fields) => events.push({event, fields}), probe: {}}),
    balances: () => JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')).pilots,
    wallet: () => wallet.divisions[1000].balance,
    events,
  };
}

test('the default is off and nothing moves', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-002': 3220}});
  assert.equal(treasury.run({env: {}, root: f.dir}).status, 'DISABLED');
  assert.equal(f.balances()['coop-pilot-002'].balance, 3220);
});

test('earned pilot ISK moves into the corporation wallet, cent for cent', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-002': 3220.25, 'coop-pilot-001': 100}, corpBalance: 0});
  const result = f.run();
  assert.equal(result.status, 'SWEPT');
  assert.equal(result.moved, 3320.25);
  assert.equal(result.afterISK, 3320.25);
  assert.equal(f.wallet(), 3320.25, 'the corporation is paid, not the pilots');
  assert.equal(f.balances()['coop-pilot-002'].balance, 0);
  assert.equal(f.balances()['coop-pilot-001'].balance, 0);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].event, 'living-npc-corp-wallet-funded');
  const receipt = JSON.parse(fs.readFileSync(path.join(f.dir, 'corp-treasury', '1000129.json'), 'utf8'));
  assert.equal(receipt.amountISK, 3320.25);
  assert.equal(receipt.pilots.length, 2);
});

test('a failed corporate credit puts every cent back into the pilots', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-002': 500}, writeFails: true});
  const result = f.run();
  assert.equal(result.status, 'CORP_CREDIT_FAILED');
  assert.equal(result.moved, 0);
  assert.equal(f.balances()['coop-pilot-002'].balance, 500, 'no ISK may be lost or created');
  assert.equal(f.wallet(), 0);
});

test('a second sweep finds nothing left and does not mint', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-002': 750}});
  assert.equal(f.run().status, 'SWEPT');
  assert.equal(f.run().status, 'NO_PILOT_EARNINGS');
  assert.equal(f.wallet(), 750);
});

test('no ledger, an unreadable root or zero balances are statuses, never throws', (t) => {
  const f = fixture(t, {balances: {}});
  assert.equal(f.run().status, 'NO_PILOT_EARNINGS');
  assert.equal(treasury.run({env: {EVEJS_COOP_CORP_TREASURY: '1'}, root: 'relative/path'}).status,
    'MARKET_DIRECTORY_REQUIRED');
  assert.equal(treasury.run({env: {EVEJS_COOP_CORP_TREASURY: '1'}, root: '/definitely/not/here'}).status,
    'NO_LEDGER');
});
