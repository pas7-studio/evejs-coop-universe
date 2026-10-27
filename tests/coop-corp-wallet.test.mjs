import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const wallet = require('../integration/coopCorpWallet.cjs');

// Measured live 2026-10-27: the pilots held 26 018 500 ISK of earned ore money, the
// refinery kept answering NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED, and the treasury
// named CORP_WALLET_UNAVAILABLE - because the raw `/corporations/<id>/wallet` pointer was
// empty while the native corporation runtime, which actually owns the wallet, simply had
// never been bootstrapped. The wallet must therefore be read and written through that
// native owner, and a write that silently does nothing must never look like a payment.
function nativeStub({balance = 0, recordExists = true, writeNoop = false} = {}) {
  let runtime = recordExists ? {wallet: {divisions: {'1000': {balance}}}} : null;
  return {
    calls: {reads: 0, writes: 0},
    getCorporationRuntime(id) {
      this.calls.reads += 1;
      assert.equal(id, 1000129);
      return runtime ? structuredClone(runtime) : null;
    },
    updateCorporationRuntime(id, updater) {
      this.calls.writes += 1;
      assert.equal(id, 1000129);
      if (writeNoop) return {success: true};
      const next = updater(runtime ? structuredClone(runtime) : undefined);
      runtime = next;
      return {success: true};
    },
    balance: () => Number((runtime && runtime.wallet.divisions['1000'] || {}).balance),
  };
}

test('the wallet is read from the native corporation runtime, not from a raw pointer', () => {
  const corporationState = nativeStub({balance: 12});
  const gameStore = {read() { throw new Error('the pointer must not be consulted'); }};
  const read = wallet.readWallet({corporationState, gameStore, corporationID: 1000129});
  assert.equal(read.status, 'OK');
  assert.equal(read.source, 'native');
  assert.equal(wallet.balanceOf(read.divisions, 1000), 12);
});

test('a corporation with no runtime says so instead of pretending it has a wallet', () => {
  const read = wallet.readWallet({corporationState: nativeStub({recordExists: false}),
    gameStore: null, corporationID: 1000129});
  assert.equal(read.status, 'CORP_WALLET_UNAVAILABLE');
  assert.equal(read.reason, 'NO_CORPORATION_RUNTIME');
});

test('a credit lands in the native wallet and is verified by reading it back', () => {
  const corporationState = nativeStub({balance: 100});
  const out = wallet.applyDelta({corporationState, gameStore: null, corporationID: 1000129,
    division: 1000, delta: 26_018_500});
  assert.equal(out.status, 'OK');
  assert.equal(out.source, 'native');
  assert.equal(corporationState.balance(), 26_018_600);
});

test('the corporation pays a fee as a real debit of its own wallet', () => {
  const corporationState = nativeStub({balance: 5000});
  const out = wallet.applyDelta({corporationState, gameStore: null, corporationID: 1000129,
    division: 1000, delta: -1234.5});
  assert.equal(out.status, 'OK');
  assert.equal(out.balance, 3765.5);
  assert.equal(corporationState.balance(), 3765.5);
});

test('a write that silently does nothing is reported, never treated as paid', () => {
  const corporationState = nativeStub({balance: 100, writeNoop: true});
  const out = wallet.applyDelta({corporationState, gameStore: null, corporationID: 1000129,
    division: 1000, delta: 50});
  assert.equal(out.status, 'CORP_CREDIT_UNVERIFIED');
  assert.equal(out.moved, 0);
});

test('without either authority the caller gets a named refusal', () => {
  const read = wallet.readWallet({corporationState: null, gameStore: null, corporationID: 1000129});
  assert.ok(['GAMESTORE_UNAVAILABLE', 'CORP_WALLET_UNAVAILABLE'].includes(read.status));
  const out = wallet.applyDelta({corporationState: null, gameStore: null, corporationID: 1000129,
    division: 1000, delta: 5});
  assert.equal(out.status, 'GAMESTORE_UNAVAILABLE');
  assert.equal(out.moved, 0);
});

test('a zero or unreadable delta is refused', () => {
  const corporationState = nativeStub({balance: 10});
  const out = wallet.applyDelta({corporationState, gameStore: null, corporationID: 1000129,
    division: 1000, delta: 0});
  assert.equal(out.status, 'DELTA_INVALID');
  assert.equal(corporationState.calls.writes, 0);
});
