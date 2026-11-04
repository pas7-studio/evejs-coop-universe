import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Live symptom (2026-11-03): five drones launched, the drone window showed 1/5.
// The client rebuilds michelle.stateByDroneID from SetState(bag.droneState) and then
// patches it with OnDroneStateChange - which DELETES any drone whose ownerID is not
// session.charid AND whose controllerID is not session.shipid. The window counts
// in-space drones as that dictionary minus the drone bay. So both payloads must list
// every controlled drone with the pilot/ship identities, or the count silently drops.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const droneView = require(path.join(
  forkRoot,
  "Code/server/src/space/coopDroneStateView.js",
));

const CHAR_ID = 140000005;
const SHIP_ID = 9988400124002;

function buildDrones(controllerID, count) {
  const drones = [];
  for (let index = 0; index < count; index += 1) {
    drones.push({
      kind: "drone",
      itemID: 500000001 + index,
      typeID: 2486,
      ownerID: CHAR_ID,
      controllerID,
      controllerOwnerID: CHAR_ID,
      activityState: 0,
      targetID: null,
    });
  }
  return drones;
}

test("SetState lists every controlled drone with pilot and ship identity", () => {
  const rows = droneView.buildDroneStateRows(buildDrones(SHIP_ID, 5));
  assert.equal(rows.length, 5, "five launched drones must be five rows");
  for (const row of rows) {
    assert.deepEqual(row, [
      row[0],
      CHAR_ID,
      SHIP_ID,
      0,
      2486,
      CHAR_ID,
      null,
    ]);
    assert.ok(row[0] > 0, "droneID must be a real item id");
  }
});

test("a resync tuple keeps every drone alive on the client", () => {
  const tuples = droneView.buildControlledDroneStateTuples(buildDrones(SHIP_ID, 5), SHIP_ID);
  assert.equal(tuples.length, 5);
  const seen = new Set();
  for (const [droneID, ownerID, controllerID] of tuples) {
    assert.equal(seen.has(droneID), false, "drone ids must be unique");
    seen.add(droneID);
    assert.ok(
      CHAR_ID === ownerID || SHIP_ID === controllerID,
      `drone ${droneID} would be deleted by michelle.OnDroneStateChange ` +
        `(ownerID=${ownerID}, controllerID=${controllerID})`,
    );
  }
});

test("drones of another ship or an uncontrolled drone are never resynced", () => {
  const drones = buildDrones(SHIP_ID, 2);
  drones.push({kind: "drone", itemID: 500000099, ownerID: CHAR_ID, controllerID: 0});
  assert.equal(
    droneView.buildControlledDroneStateTuples(drones, SHIP_ID).length,
    2,
  );
  assert.equal(
    droneView.buildControlledDroneStateTuples(drones, 123).length,
    0,
  );
  assert.equal(
    droneView.buildControlledDroneStateTuples(drones, 0).length,
    0,
    "a ship-less session must not receive drone state",
  );
});
