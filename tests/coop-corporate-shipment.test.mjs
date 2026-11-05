import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createShipment, SHIPMENT_CODE} =
  require(path.join(forkRoot, "Code/server/src/space/coopCorporateShipment.js"));

const base = {
  shipmentID: "corp:60000358:60003760:980000027001:9988400118453",
  corpID: 1000129,
  hullID: 980000027001,
  fromStationID: 60000358,
  toStationID: 60003760,
  fromSystemID: 30000144,
  toSystemID: 30000142,
  gate: {
    sourceGateID: 50002185,
    destinationGateID: 50001249,
    sourceSystemID: 30000144,
    destinationSystemID: 30000142,
  },
  manifest: [{typeID: 34, quantity: 70000, m3PerUnit: 0.01, price: 3.71}],
  capacityM3: 3900,
  destinationBid: {typeID: 34, price: 3.71, volume: 4000000},
};

test("valid shipment is planned", () => {
  const result = createShipment({...base});
  assert.equal(result.ok, true);
  assert.equal(result.code, "PLANNED");
  assert.equal(result.record.state, "PLANNED");
  assert.equal(result.record.totalM3, 700);
  assert.equal(result.record.expectedIsk, 259700);
  assert.equal(result.record.shipmentID, base.shipmentID);
  assert.deepEqual(result.record.attempts, {load: 0, cross: 0, sell: 0});
});

test("the record is frozen", () => {
  const result = createShipment({...base});
  assert.equal(Object.isFrozen(result.record), true);
  assert.throws(() => {
    "use strict";
    result.record.hullID = 1;
  });
});

test("one durable identity", () => {
  const a = createShipment({...base});
  const b = createShipment({...base});
  assert.equal(a.record.shipmentID, b.record.shipmentID);
  assert.equal(a.record.totalM3, b.record.totalM3);
  assert.equal(a.record.expectedIsk, b.record.expectedIsk);
});

test("the caller's manifest is not mutated", () => {
  const manifest = [{typeID: 34, quantity: 70000, m3PerUnit: 0.01, price: 3.71}];
  const result = createShipment({...base, manifest});
  assert.equal(result.ok, true);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].quantity, 70000);
  assert.equal(manifest[0].price, 3.71);
  assert.notEqual(result.record.manifest, manifest);
});

test("no hull / no station identity is refused", () => {
  assert.equal(createShipment({...base, hullID: 0}).code, "INVALID_IDENTITY");
  assert.equal(createShipment({...base, corpID: -1}).code, "INVALID_IDENTITY");
  assert.equal(
    createShipment({...base, toStationID: base.fromStationID}).code,
    "INVALID_IDENTITY",
  );
  assert.equal(createShipment({...base, shipmentID: ""}).code, "INVALID_IDENTITY");
});

test("a wrong gate is refused", () => {
  assert.equal(
    createShipment({...base, gate: {...base.gate, destinationSystemID: 30000143}}).code,
    "INVALID_GATE",
  );
  assert.equal(
    createShipment({...base, gate: {...base.gate, sourceGateID: undefined}}).code,
    "INVALID_GATE",
  );
  assert.equal(
    createShipment({...base, fromSystemID: 30000145}).code,
    "INVALID_GATE",
  );
});

test("an empty or broken manifest is refused", () => {
  assert.equal(createShipment({...base, manifest: []}).code, "INVALID_MANIFEST");
  assert.equal(createShipment({...base, manifest: null}).code, "INVALID_MANIFEST");
  assert.equal(
    createShipment({...base, manifest: [{typeID: 34, quantity: 0, m3PerUnit: 0.01, price: 3.71}]}).code,
    "INVALID_MANIFEST",
  );
});

test("over capacity is refused, exact capacity is not", () => {
  assert.equal(createShipment({...base, capacityM3: 699}).code, "OVER_CAPACITY");
  const result = createShipment({...base, capacityM3: 700});
  assert.equal(result.ok, true);
  assert.equal(result.record.totalM3, 700);
});

test("a destination with no real bid is refused", () => {
  assert.equal(createShipment({...base, destinationBid: null}).code, "NO_DESTINATION_BID");
  assert.equal(
    createShipment({...base, destinationBid: {typeID: 34, price: 0, volume: 10}}).code,
    "NO_DESTINATION_BID",
  );
  assert.equal(
    createShipment({...base, destinationBid: {typeID: 34, price: 3.71, volume: 0}}).code,
    "NO_DESTINATION_BID",
  );
});

test("the bid must be for cargo that is aboard", () => {
  assert.equal(
    createShipment({...base, destinationBid: {typeID: 35, price: 3.71, volume: 4000000}}).code,
    "BID_TYPE_NOT_IN_MANIFEST",
  );
});

test("the manifest may not exceed the bid volume", () => {
  assert.equal(
    createShipment({...base, destinationBid: {typeID: 34, price: 3.71, volume: 69999}}).code,
    "MANIFEST_EXCEEDS_BID",
  );
  const result = createShipment({...base, destinationBid: {typeID: 34, price: 3.71, volume: 70000}});
  assert.equal(result.ok, true);
});

test("expectedIsk uses the row price, not the bid price", () => {
  const result = createShipment({
    ...base,
    manifest: [{typeID: 34, quantity: 70000, m3PerUnit: 0.01, price: 1}],
    destinationBid: {typeID: 34, price: 9.99, volume: 4000000},
  });
  assert.equal(result.ok, true);
  assert.equal(result.record.expectedIsk, 70000);
});

test("createdAt is only what the caller passes", () => {
  const defaultResult = createShipment({...base});
  assert.equal(defaultResult.record.createdAt, null);

  const explicitResult = createShipment({...base, createdAt: 1793627595261});
  assert.equal(explicitResult.record.createdAt, 1793627595261);

  const again = createShipment({...base});
  assert.equal(again.record.createdAt, null);
});

test("SHIPMENT_CODE exports every code with the same string value", () => {
  for (const name of Object.keys(SHIPMENT_CODE)) {
    assert.equal(SHIPMENT_CODE[name], name);
  }
  const refusal = createShipment({...base, hullID: 0});
  assert.equal(refusal.code, "INVALID_IDENTITY");
  assert.equal(SHIPMENT_CODE["INVALID_IDENTITY"], "INVALID_IDENTITY");
  for (const name of Object.keys(SHIPMENT_CODE)) {
    assert.equal(SHIPMENT_CODE[name], name);
  }
});

test("a placed shipment never reports a settlement", () => {
  const result = createShipment({...base});
  assert.equal(result.record.state, "PLANNED");
  assert.equal(result.record.settledAt, undefined);
  assert.equal(result.record.cargoID, undefined);
  assert.equal(result.record.receipt, undefined);
  assert.notEqual(result.record.state, "SETTLED");
});
