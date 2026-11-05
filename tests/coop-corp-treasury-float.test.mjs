import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const treasury = require('../integration/coopNpcCorpTreasury.cjs');

// Measured live 2026-11-05 on the play stack: the sweep zeroed every pilot after each sale, so
// the manufacturer could never buy the blueprint or the missing mineral it needed - the native
// trader pays for a purchase from the PILOT's earned balance, never from the corporation wallet.
// The float keeps a bounded amount of working cash with the crew; the default (0) is exactly the
// old behaviour.
function fixture(t, {balances = {}, corpBalance = 0, keep} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-treasury-float-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const ledger = {version: 1, pilots: {}};
  for (const [pilotID, balance] of Object.entries(balances)) ledger.pilots[pilotID] = {balance, tradeCount: 1};
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(ledger));
  const wallet = {divisions: {1000: {balance: corpBalance}}};
  const gameStore = {
    read(table, pointer) {
      assert.equal(table, 'corporationRuntime');
      assert.equal(pointer, '/corporations/1000129/wallet');
      return {success: true, data: structuredClone(wallet)};
    },
    write(_table, _pointer, value) { wallet.divisions = structuredClone(value.divisions); return {success: true}; },
    flushTableSync() { return {success: true}; },
  };
  const env = {EVEJS_COOP_CORP_TREASURY: '1'};
  if (keep !== undefined) env.EVEJS_COOP_TREASURY_KEEP_ISK = String(keep);
  return {
    dir,
    run: () => treasury.run({env, root: dir, gameStore, now: 1234}),
    balances: () => JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')).pilots,
    wallet: () => wallet.divisions[1000].balance,
  };
}

test('without the flag the whole balance still moves (the old behaviour)', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-002': 3220.25}, corpBalance: 0});
  const result = f.run();
  assert.equal(result.status, 'SWEPT');
  assert.equal(result.moved, 3220.25);
  assert.equal(f.balances()['coop-pilot-002'].balance, 0);
});

test('the float stays with the pilot and only the excess is swept', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-101': 3_000_000}, corpBalance: 500, keep: 2_000_000});
  const result = f.run();
  assert.equal(result.status, 'SWEPT');
  assert.equal(result.moved, 1_000_000, 'only the part above the float moved');
  assert.equal(f.balances()['coop-pilot-101'].balance, 2_000_000, 'the crew keeps its working cash');
  assert.equal(f.wallet(), 1_000_500);
});

test('a balance below the float is not swept at all, and says so', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-101': 1_500_000}, corpBalance: 42, keep: 2_000_000});
  const result = f.run();
  assert.equal(result.status, 'PILOT_FLOAT_HELD');
  assert.equal(result.moved, 0);
  assert.equal(result.heldISK, 1_500_000);
  assert.equal(f.balances()['coop-pilot-101'].balance, 1_500_000);
  assert.equal(f.wallet(), 42, 'the corporation is not credited for money it did not take');
});

test('money is conserved: pilot + corporation before equals after', (t) => {
  const f = fixture(t, {balances: {'coop-pilot-101': 5_000_000, 'coop-pilot-005': 900_000},
    corpBalance: 1_000, keep: 1_000_000});
  const result = f.run();
  assert.equal(result.status, 'SWEPT');
  const afterPilots = Object.values(f.balances()).reduce((sum, row) => sum + Number(row.balance || 0), 0);
  // The first pilot keeps exactly the float; the second never had more than the float, so its
  // 900 000 stays where it is.
  assert.equal(afterPilots, 1_900_000);
  assert.equal(f.wallet(), 1_000 + 4_000_000);
  assert.equal(result.moved, 4_000_000);
});
