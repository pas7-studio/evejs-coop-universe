import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The journal is durable, so the suite must never write into the real market root.
process.env.EVEJS_COOP_GATE_CROSSING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "crossing-"));
const crossing = require("../integration/coopNpcGateCrossing.cjs");

// Measured 2026-10-29: New Caldari 30000145 and Jita 30000142 share one reciprocal gate,
// and the native transfer has already been verified in this world once
// (living-native-gate-transfer, SAME_NATIVE_SHIP_ARRIVED). The last link is moving a load
// across it - and the one thing that must never happen is claiming a crossing that the
// native adapter did not prove.
const ENTITY = 980000000141;
const GATE = { sourceGateID: 50016293, destinationGateID: 50016294,
  sourceSystemID: 30000145, destinationSystemID: 30000142 };
const verified = { success: true, verifiedSourceAbsent: true,
  verifiedDestinationPresent: true, entityID: ENTITY, systemID: 30000142 };

test("only the native adapter's full proof counts as a crossing", () => {
  assert.equal(crossing.judgeCrossing({ result: verified, expectedEntityID: ENTITY,
    expectedSystemID: 30000142 }).ok, true);
  const cases = [
    [{ ...verified, verifiedDestinationPresent: false }, "DESTINATION_ABSENT"],
    [{ ...verified, verifiedSourceAbsent: false }, "SOURCE_STILL_PRESENT"],
    [{ ...verified, entityID: 980000000999 }, "ENTITY_CHANGED"],
    [{ ...verified, systemID: 30000148 }, "WRONG_DESTINATION_SYSTEM"],
    [{ success: false, errorMsg: "NATIVE_GATE_SCRAMBLED" }, "NATIVE_GATE_SCRAMBLED"],
    [null, "NO_RESULT"],
  ];
  for (const [result, reason] of cases) {
    const verdict = crossing.judgeCrossing({ result, expectedEntityID: ENTITY,
      expectedSystemID: 30000142 });
    assert.equal(verdict.ok, false, reason);
    assert.equal(verdict.reason, reason);
  }
});

test("a hull is at the gate only when the surface gap is inside the client's rule", () => {
  const gate = { position: { x: 0, y: 0, z: 0 }, radius: 3000 };
  assert.equal(crossing.inRange({ ship: { position: { x: 5000, y: 0, z: 0 }, radius: 100 }, gate }), true);
  assert.equal(crossing.inRange({ ship: { position: { x: 20000, y: 0, z: 0 }, radius: 100 }, gate }), false);
  assert.equal(crossing.inRange({ ship: { position: {} }, gate }), false, "no real position is not a range");
});

function fakeScene(ship) {
  return { getEntityByID: (id) => (Number(id) === Number(ENTITY) ? ship : null) };
}

test("without a native transfer the run waits at the gate and says so", () => {
  const planned = crossing.plan({ entityID: ENTITY, pilotID: "coop-pilot-004", gate: GATE, now: 1000 });
  assert.equal(planned.status, "PLANNED");
  const result = crossing.tick({
    sceneForSystem: () => fakeScene({ itemID: ENTITY, position: { x: 0, y: 0, z: 0 }, radius: 100 }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    now: 20000,
  });
  const entry = result.advanced[0];
  assert.equal(entry.phase, "AT_GATE");
  assert.equal(entry.lastReason, "TRANSFER_UNAVAILABLE");
  assert.equal(crossing.read()[0].phase, "AT_GATE", "the refusal is durable, not just reported");
});

test("a refused crossing is retried a bounded number of times, then blocked with the reason", () => {
  let now = 20000;
  for (let attempt = 0; attempt < crossing.MAX_ATTEMPTS; attempt += 1) {
    now += 11000;
    crossing.tick({
      sceneForSystem: () => fakeScene({ itemID: ENTITY, position: { x: 0, y: 0, z: 0 }, radius: 100 }),
      getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
      transfer: () => ({ success: false, errorMsg: "NATIVE_GATE_DENIED" }),
      now,
    });
  }
  const entry = crossing.read()[0];
  assert.equal(entry.phase, "BLOCKED");
  assert.equal(entry.lastReason, "NATIVE_GATE_DENIED");
  assert.equal(entry.attempts, crossing.MAX_ATTEMPTS);
});

test("a verified transfer journals ARRIVED with both systems", () => {
  const now = 99999;
  crossing.plan({ entityID: ENTITY, pilotID: "coop-pilot-004", gate: GATE, now });
  const result = crossing.tick({
    sceneForSystem: () => fakeScene({ itemID: ENTITY, position: { x: 0, y: 0, z: 0 }, radius: 100 }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    transfer: () => verified,
    now,
  });
  const entry = result.advanced[0];
  assert.equal(entry.phase, "ARRIVED");
  assert.equal(entry.lastReason, "SAME_NATIVE_SHIP_ARRIVED");
  assert.equal(entry.fromSystemID, 30000145);
  assert.equal(entry.toSystemID, 30000142);
  assert.equal(entry.arrivedAt, now);
});

test("a hull that is not in the source scene blocks instead of guessing", () => {
  crossing.plan({ entityID: 980000000777, pilotID: "coop-pilot-005", gate: GATE, now: 1 });
  const result = crossing.tick({ sceneForSystem: () => fakeScene(null), getGate: () => ({}), now: 2 });
  const entry = result.advanced.find((row) => Number(row.entityID) === 980000000777);
  assert.equal(entry.phase, "BLOCKED");
  assert.equal(entry.lastReason, "SHIP_NOT_IN_SOURCE_SCENE");
});

test("the adapter receives the proven gate pair, not a stargate record", () => {
  // Measured 2026-10-29: handing the adapter the stargate row made every attempt fail
  // NATIVE_GATE_PREFLIGHT_REJECTED, because it re-reads both gates by ID and got null.
  const seen = [];
  crossing.plan({ entityID: 980000000888, pilotID: "coop-pilot-009", gate: GATE, now: 500000 });
  crossing.tick({
    sceneForSystem: () => ({
      getEntityByID: (id) => (Number(id) === 980000000888
        ? { itemID: id, position: { x: 0, y: 0, z: 0 }, radius: 100 } : null),
    }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    transfer: (args) => { seen.push(args.gate); return { success: false, errorMsg: "STOP" }; },
    now: 500001,
  });
  assert.deepEqual(seen[0], { sourceGateID: GATE.sourceGateID,
    destinationGateID: GATE.destinationGateID,
    sourceSystemID: GATE.sourceSystemID, destinationSystemID: GATE.destinationSystemID });
});

test("a hull a few kilometres out is closed with a follow order, not a warp", () => {
  // Measured 2026-10-29: the hauler sat 4 642 m from the gate, the native warp refused a
  // target that close, and the run re-warped for ever. A follow order is the documented
  // final approach; the run must reach AT_GATE and then CROSS.
  const follows = [];
  const warps = [];
  crossing.plan({ entityID: 980000000999, pilotID: "coop-pilot-002", gate: GATE, now: 700000 });
  const scene = () => ({ getEntityByID: (id) => (Number(id) === 980000000999
    ? { itemID: id, position: { x: 4642 + 3000 + 100, y: 0, z: 0 }, radius: 100 } : null) });
  const gate = () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 });
  const first = crossing.tick({ sceneForSystem: scene, getGate: gate,
    warpToGate: (id, g) => { warps.push(g); return true; },
    followGate: (id, g) => { follows.push(g); return true; },
    now: 700001 });
  assert.deepEqual(warps, [], "no warp for a close target");
  assert.deepEqual(follows, [GATE.sourceGateID], "the follow order closes the last kilometres");
  const mine = first.advanced.find((row) => Number(row.entityID) === 980000000999);
  assert.equal(mine.phase, "APPROACH");
  assert.equal(mine.lastReason, "FOLLOW_GATE");
});

test("a durable ship whose scene was rebuilt is revived instead of abandoned", () => {
  // Measured 2026-10-29: after a restart the returning hauler was still in the store in
  // Jita while the live scene had no such entity, so the run blocked and the fleet was left
  // a hauler short. The store record is proof enough to bring the same hull back.
  const revived = [];
  crossing.plan({ entityID: 980000000555, pilotID: "coop-pilot-002", gate: GATE, now: 800000 });
  const result = crossing.tick({
    sceneForSystem: () => ({ getEntityByID: () => null }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    materialize: (scene, id) => { revived.push(id); return { success: true }; },
    now: 800001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === 980000000555);
  assert.ok(revived.includes(980000000555), "the same hull is brought back from its record");
  assert.equal(mine.phase, "APPROACH", "the run continues once the hull is live again");
  assert.equal(mine.lastReason, "REMATERIALIZED_FROM_STORE");
});

test("a ship that cannot be revived still blocks with the honest reason", () => {
  crossing.plan({ entityID: 980000000556, pilotID: "coop-pilot-002", gate: GATE, now: 810000 });
  const result = crossing.tick({
    sceneForSystem: () => ({ getEntityByID: () => null }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    materialize: () => ({ success: false, errorMsg: "NPC_NOT_FOUND" }),
    now: 810001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === 980000000556);
  assert.equal(mine.phase, "BLOCKED");
  assert.equal(mine.lastReason, "SHIP_NOT_IN_SOURCE_SCENE");
});
