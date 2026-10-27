import test from 'node:test';
import assert from 'node:assert/strict';
import fsApi from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const tick = require('../integration/coopNpcRefineryTick.cjs');

// The refinery (COOP-031) was fully implemented and never called, so ore could never
// become minerals. This caller is the missing wiring - and it must report the real
// station fee instead of waiving it.
const HANGAR = 4;
const ORE = 980200001111;

function items(rows, {fail = false} = {}) {
  return {
    ITEM_FLAGS: {HANGAR},
    listOwnedItems(ownerID, filter) {
      if (fail) throw new Error('store down');
      assert.equal(filter.locationID, 60000358);
      return rows.filter((row) => Number(row.ownerID) === ownerID);
    },
  };
}

const warehouseOre = (overrides = {}) => ({
  itemID: ORE, typeID: 17470, quantity: 54999, ownerID: 1000129, locationID: 60000358,
  flagID: HANGAR, stacksize: 54999, singleton: 0, customInfo: 'coop-warehouse:v1:cargo:' + ORE,
  ...overrides,
});

function refinery(result) {
  return {calls: [], refine(args) { this.calls.push(args); return result; }};
}

const events = () => {
  const seen = [];
  return {see: (_probe, event, _subject, fields) => seen.push({event, fields}), seen};
};

test('the default is off and nothing is refined', () => {
  const r = tick.run({env: {}, stationID: 60000358});
  assert.equal(r.status, 'DISABLED');
  assert.equal(r.refined, 0);
});

test('only tagged warehouse ore in the hangar is a candidate', () => {
  const rows = [
    warehouseOre(),
    warehouseOre({itemID: 5, customInfo: 'something else'}),
    warehouseOre({itemID: 6, locationID: 60000682}),
    warehouseOre({itemID: 7, ownerID: 1000007}),
  ];
  const got = tick.candidates({items: items(rows), ownerID: 1000129, stationID: 60000358});
  assert.equal(got.length, 1);
  assert.equal(got[0].itemID, ORE);
});

test('a committed refine is reported as real minerals for real ore', () => {
  const log = events();
  const fake = refinery({status: 'COMMITTED', operationID: 'coop-refine:v1:' + ORE + ':54999',
    outputs: [{typeID: 34, quantity: 1000}, {typeID: 35, quantity: 200}]});
  const r = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358, systemID: 30000144,
    items: items([warehouseOre()]), refinery: fake, observe: log.see, probe: {}});
  assert.equal(r.status, 'REFINED');
  assert.equal(r.refined, 1);
  assert.deepEqual(fake.calls, [{oreItemID: ORE, ownerID: 1000129, stationID: 60000358}]);
  assert.equal(log.seen.length, 1);
  assert.equal(log.seen[0].event, 'living-npc-refined');
  assert.equal(log.seen[0].fields.minerals, 2);
  assert.equal(log.seen[0].fields.consumed, 54999);
});

test('a station fee is reported with its exact cost, never waived', () => {
  const log = events();
  const fake = refinery({status: 'NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED', iskCost: 1234.5});
  const r = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358,
    items: items([warehouseOre()]), refinery: fake, observe: log.see, probe: {}});
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.refined, 0);
  assert.equal(log.seen[0].event, 'living-npc-refinery-blocked');
  assert.equal(log.seen[0].fields.iskCost, 1234.5);
  assert.equal(log.seen[0].fields.status, 'NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED');
});

test('an unavailable refinery or unreadable stock is a status, never a throw', () => {
  const unavailable = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1', EVEJS_COOP_NPC_REFINERY_DIR: ''},
    stationID: 60000358, items: items([warehouseOre()]), observe: () => {}, probe: {}});
  assert.equal(unavailable.status, 'REFINERY_UNAVAILABLE');
  const unreadable = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358,
    items: items([], {fail: true}), refinery: refinery({status: 'COMMITTED'}),
    observe: () => {}, probe: {}});
  assert.equal(unreadable.status, 'CANDIDATES_UNREADABLE');
  const noOre = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358,
    items: items([]), refinery: refinery({status: 'COMMITTED'}), observe: () => {}, probe: {}});
  assert.equal(noOre.status, 'NO_WAREHOUSE_ORE');
});

test('a throwing refinery is contained per stack', () => {
  const exploding = {refine() { throw new Error('journal write failed'); }};
  const r = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358,
    items: items([warehouseOre()]), refinery: exploding, observe: () => {}, probe: {}});
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.statuses[0], 'REFINERY_THROW');
});

test('the fleet tick is throttled per system and station', () => {
  const env = {EVEJS_COOP_NPC_REFINERY: '1'};
  const opts = {env, stationID: 60000358, systemID: 30000144, items: items([]),
    refinery: refinery({status: 'COMMITTED'}), observe: () => {}, probe: {}};
  tick.resetForTests();
  assert.notEqual(tick.tick({...opts, now: 1000}).status, 'THROTTLED');
  assert.equal(tick.tick({...opts, now: 2000}).status, 'THROTTLED');
  assert.notEqual(tick.tick({...opts, now: 1000 + tick.THROTTLE_MS + 1}).status, 'THROTTLED');
});

test('no known station means no refine, never a guess', () => {
  assert.equal(tick.tick({env: {EVEJS_COOP_NPC_REFINERY: '1'}, systemID: 30000144}).status, 'NO_STATION');
});

// A positive station fee is a real bill: the caller must pay it from the corporation's
// own wallet and hand the refinery a durable receipt, then refine for real.
test('the corporation pays the real station fee before the ore is refined', () => {
  const root = fsApi.mkdtempSync(path.join(os.tmpdir(), 'coop-refinery-fee-'));
  try {
    const wallet = {divisions: {1000: {balance: 5000}}};
    const store = {
      read: () => ({success: true, data: structuredClone(wallet)}),
      write: (_table, _pointer, next) => { wallet.divisions = next.divisions; return {success: true}; },
      flushTableSync: () => ({success: true}),
    };
    const calls = [];
    const fake = {refine(args) {
      calls.push(args);
      if (!args.feePaid) return {status: 'NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED', iskCost: 1234.5};
      return {status: 'COMMITTED', operationID: 'coop-refine:v1:' + ORE + ':54999',
        outputs: [{typeID: 34, quantity: 1000}]};
    }};
    const log = events();
    const r = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1'}, stationID: 60000358,
      systemID: 30000144, items: items([warehouseOre()]), refinery: fake, root,
      gameStore: store, observe: log.see, probe: {}});
    assert.equal(r.status, 'REFINED');
    assert.equal(r.refined, 1);
    assert.equal(wallet.divisions[1000].balance, 3765.5);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].feePaid,
      {receiptID: ORE, amountISK: 1234.5, corporationID: 1000129, stationID: 60000358});
    const receipt = JSON.parse(fsApi.readFileSync(
      path.join(root, 'refinery-fees', ORE + '.json'), 'utf8'));
    assert.equal(receipt.status, 'PAID');
    assert.equal(receipt.amountISK, 1234.5);
    assert.equal(receipt.corporationID, 1000129);
    assert.equal(receipt.afterISK, 3765.5);
    assert.equal(log.seen[0].event, 'living-npc-refined');
  } finally { fsApi.rmSync(root, {recursive: true, force: true}); }
});

// Ore cannot be refined for free, and the fee is the corporation's bill: the fleet's own
// earnings must first move into the corp wallet, then the same wallet pays the station.
test('pilot earnings fund the corporation that pays the station fee', () => {
  tick.resetForTests(); // events are de-duplicated per process by station and item
  const root = fsApi.mkdtempSync(path.join(os.tmpdir(), 'coop-refinery-treasury-'));
  try {
    fsApi.writeFileSync(path.join(root, 'ledger.json'),
      JSON.stringify({pilots: {'coop-pilot-001': {balance: 33714.25}}}));
    const wallet = {divisions: {1000: {balance: 0}}};
    const store = {
      read: () => ({success: true, data: structuredClone(wallet)}),
      write: (_table, _pointer, next) => { wallet.divisions = next.divisions; return {success: true}; },
      flushTableSync: () => ({success: true}),
    };
    const calls = [];
    const fake = {refine(args) {
      calls.push(args);
      if (!args.feePaid) return {status: 'NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED', iskCost: 4998.33};
      return {status: 'COMMITTED', operationID: 'op', outputs: [{typeID: 34, quantity: 10}]};
    }};
    const log = events();
    const r = tick.run({env: {EVEJS_COOP_NPC_REFINERY: '1', EVEJS_COOP_CORP_TREASURY: '1'},
      stationID: 60000358, systemID: 30000144, items: items([warehouseOre()]), refinery: fake,
      root: path.join(root, 'refinery'), marketRoot: root, gameStore: store,
      observe: log.see, probe: {}});
    assert.equal(r.status, 'REFINED');
    assert.equal(calls.length, 2);
    // 0 ISK corp wallet + 33 714.25 earned - 4 998.33 fee
    assert.equal(wallet.divisions[1000].balance, 28715.92);
    const ledger = JSON.parse(fsApi.readFileSync(path.join(root, 'ledger.json'), 'utf8'));
    assert.equal(ledger.pilots['coop-pilot-001'].balance, 0);
    const named = log.seen.map((e) => e.event);
    assert.ok(named.includes('living-corp-treasury-swept'), named.join(','));
    assert.ok(named.includes('living-npc-refined'), named.join(','));
    assert.equal(log.seen.find((e) => e.event === 'living-corp-treasury-swept').fields.movedISK, 33714.25);
  } finally { fsApi.rmSync(root, {recursive: true, force: true}); }
});
