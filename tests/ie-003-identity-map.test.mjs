import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FORK_ROOT = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
if (!FORK_ROOT) {
  throw new Error('EVEJS_FORK_ROOT is unset');
}
const mod = require(FORK_ROOT.trim() + '/Code/server/src/space/coopEconomyIdentityMap.js');
const { LEDGER_SOURCES, describeSource, availableAtStation, isStationStock } = mod;

test('LEDGER_SOURCES has exactly 6 records with required fields and is frozen', () => {
  assert.equal(LEDGER_SOURCES.length, 6);
  const ids = new Set(LEDGER_SOURCES.map((r) => r.id));
  assert.deepEqual([...ids].sort(), [
    'cargo',
    'corp_wallet',
    'depot_receipt',
    'industry_job',
    'item',
    'market_fill',
  ]);
  for (const r of LEDGER_SOURCES) {
    assert.equal(typeof r.title, 'string');
    assert.equal(typeof r.owner, 'string');
    assert.equal(typeof r.key, 'string');
    assert.equal(typeof r.evidence, 'string');
    assert.ok(['physical', 'receipt'].includes(r.countsAs));
  }
  assert.ok(Object.isFrozen(LEDGER_SOURCES));
  for (const r of LEDGER_SOURCES) {
    assert.ok(Object.isFrozen(r));
  }
});

test('exactly two sources count as physical; depot_receipt counts as receipt', () => {
  const physical = LEDGER_SOURCES.filter((r) => r.countsAs === 'physical');
  assert.deepEqual(physical.map((r) => r.id).sort(), ['cargo', 'item']);
  const depot = LEDGER_SOURCES.find((r) => r.id === 'depot_receipt');
  assert.equal(depot.countsAs, 'receipt');
});

test('isStationStock reflects physical sources only', () => {
  assert.equal(isStationStock('item'), true);
  assert.equal(isStationStock('depot_receipt'), false);
  assert.equal(isStationStock('nope'), false);
});

test('describeSource returns key or null and throws on non-string', () => {
  assert.equal(describeSource('cargo').key, 'cargoID');
  assert.equal(describeSource('nope'), null);
  assert.throws(() => describeSource(1), TypeError);
});

test('a committed receipt is never stock', () => {
  const r = availableAtStation({ itemStoreQuantity: 0, depotCommittedQuantity: 500 });
  assert.equal(r.available, 0);
  assert.equal(r.ignoredReceipts, 500);
  assert.equal(r.blocked, true);
});

test('a committed receipt does not add to available', () => {
  const r = availableAtStation({ itemStoreQuantity: 12, depotCommittedQuantity: 500 });
  assert.equal(r.available, 12);
  assert.equal(r.ignoredReceipts, 500);
  assert.equal(r.blocked, false);
});

test('junk input never throws and never produces negative available', () => {
  const cases = [undefined, -5, NaN, '9'];
  for (const c of cases) {
    assert.doesNotThrow(() => availableAtStation(c));
    const r = availableAtStation(c);
    assert.ok(!(r.available < 0));
  }
});
