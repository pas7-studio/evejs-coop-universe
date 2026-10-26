import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createCourierDispatch} = require('../integration/coopCourierRuntime.cjs');

// The defect this covers: a courier completes the contract with its own
// session-less identity, so the native inventory sync goes nowhere and the
// issuer's client keeps showing a stale hangar until a relog. The courier must
// push the delivered rows to the issuer's live session itself.
function harness({sessions}) {
  const emitted = [];
  const items = {
    items: {
      a: {itemID: 9988400000871, typeID: 32880, ownerID: 140000005, locationID: 60015262, flagID: 4, quantity: -1},
      b: {itemID: 9988400000744, typeID: 34, ownerID: 140000005, locationID: 60015262, flagID: 4, quantity: 420},
      c: {itemID: 9988400000361, typeID: 601, ownerID: 140000005, locationID: 60015262, flagID: 4, quantity: -1},
      // Somebody else's cargo at the same station must never be reported.
      d: {itemID: 9988400000999, typeID: 34, ownerID: 140000100, locationID: 60015262, flagID: 4, quantity: 5},
    },
  };
  const dispatch = createCourierDispatch({
    contracts: {listContractRecords: () => [], getContractRecord: () => null},
    gameStore: {read: (table) => (table === "items" ? {success: true, data: items} : {success: false, data: null})},
    itemStore: {},
    worldData: {},
    transitions: {},
    space: {},
    pilots: ["140000100"],
    log: () => {},
    sessionRegistry: {
      findSessionByCharacterID: (id) => (Number(id) === 140000005 ? sessions : null),
    },
    characterState: {
      emitItemsChangedBatchForSession: (session, changes) => emitted.push({session, changes}),
    },
  });
  return {dispatch, emitted};
}

test("the issuer's live session receives the delivered rows, never a relog", () => {
  const session = {characterID: 140000005, sendNotification() {}};
  const {dispatch, emitted} = harness({sessions: session});
  const result = dispatch.pushIssuerInventory({issuerID: 140000005, endStationID: 60015262});
  assert.match(result, /sent 3 items/);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].session, session);
  const ids = emitted[0].changes.map((change) => change.item.itemID).sort();
  assert.deepEqual(ids, [9988400000361, 9988400000744, 9988400000871]);
});

test("without a live session nothing is emitted and the reason is honest", () => {
  const {dispatch, emitted} = harness({sessions: null});
  const result = dispatch.pushIssuerInventory({issuerID: 140000005, endStationID: 60015262});
  assert.match(result, /no live issuer session/);
  assert.equal(emitted.length, 0);
});

test("another owner's cargo at the destination is never reported", () => {
  const session = {characterID: 140000005};
  const {dispatch, emitted} = harness({sessions: session});
  dispatch.pushIssuerInventory({issuerID: 140000005, endStationID: 60015262});
  const ids = emitted[0].changes.map((change) => change.item.itemID);
  assert.equal(ids.includes(9988400000999), false);
});
