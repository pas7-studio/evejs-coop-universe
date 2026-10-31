import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {adoptHeldBlueprints, BLUEPRINT_CATEGORY_ID} = require('../integration/coopNpcManufacture.cjs');

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coop-adopt-'));

function hangar(rows) {
  return {listOwnedItems: () => rows};
}

const blueprintRow = (typeID, extra = {}) => ({typeID, categoryID: BLUEPRINT_CATEGORY_ID,
  ownerID: 1000129, locationID: 60000682, flagID: 4, quantity: -1, singleton: 1,
  itemID: 9988400001895 + typeID, ...extra});

const receipts = (root) => {
  const dir = path.join(root, 'blueprints');
  try {
    return fs.readdirSync(dir).map((name) =>
      JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
  } catch (_error) { return []; }
};

test('a purchased blueprint really in the hangar becomes a durable receipt', () => {
  const root = tempRoot();
  // Measured 2026-10-31: the trader bought Miner I Blueprint (785) for 92 720 ISK and the
  // manufacturer answered NO_BLUEPRINT for hours, because no receipt was ever written for a
  // PURCHASED blueprint.
  const answer = adoptHeldBlueprints({ownerID: 1000129, root,
    items: hangar([blueprintRow(785), blueprintRow(1076)])});
  assert.equal(answer.status, 'ADOPTED');
  assert.deepEqual(answer.adopted.map((row) => row.blueprintTypeID).sort((a, b) => a - b),
    [785, 1076]);
  const written = receipts(root);
  assert.equal(written.length, 2);
  assert.ok(written.every((row) => row.status === 'SEEDED' && row.source === 'hangar'));
  assert.ok(written.every((row) => row.ownerID === 1000129 && row.stationID === 60000682));
});

test('adoption is idempotent and never overwrites a seeding receipt', () => {
  const root = tempRoot();
  adoptHeldBlueprints({ownerID: 1000129, root, items: hangar([blueprintRow(785)])});
  const before = fs.readFileSync(path.join(root, 'blueprints', 'seed_1000129_60000682_785.json'),
    'utf8');
  const again = adoptHeldBlueprints({ownerID: 1000129, root,
    items: hangar([blueprintRow(785)])});
  assert.equal(again.status, 'NOTHING_NEW');
  assert.equal(fs.readFileSync(path.join(root, 'blueprints',
    'seed_1000129_60000682_785.json'), 'utf8'), before);
  assert.equal(receipts(root).length, 1);
});

test('only blueprints are adopted: ordinary stock is never turned into a blueprint receipt', () => {
  const root = tempRoot();
  const answer = adoptHeldBlueprints({ownerID: 1000129, root, items: hangar([
    {typeID: 34, categoryID: 4, ownerID: 1000129, locationID: 60000682, flagID: 4,
      quantity: 5000, singleton: 0},
  ])});
  assert.equal(answer.status, 'NOTHING_NEW');
  assert.equal(receipts(root).length, 0);
});

test('a blueprint row with no real size is not an asset', () => {
  const root = tempRoot();
  const answer = adoptHeldBlueprints({ownerID: 1000129, root, items: hangar([
    blueprintRow(785, {quantity: -1, singleton: 0}),
  ])});
  assert.equal(answer.status, 'NOTHING_NEW');
  assert.equal(receipts(root).length, 0);
});

test('an unreadable hangar is reported, not guessed', () => {
  const root = tempRoot();
  const answer = adoptHeldBlueprints({ownerID: 1000129, root,
    items: {listOwnedItems: () => { throw Error('STORE_DOWN'); }}});
  assert.equal(answer.status, 'HANGAR_UNREADABLE');
  assert.equal(receipts(root).length, 0);
});
