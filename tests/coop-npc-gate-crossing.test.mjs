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
  return { systemID: GATE.sourceSystemID,
    getEntityByID: (id) => (Number(id) === Number(ENTITY) && ship
      ? { kind: "ship", nativeNpc: true, mode: "STOP", systemID: GATE.sourceSystemID, ...ship }
      : null) };
}
function fakeController(entityID = ENTITY) {
  return { entityID, systemID: GATE.sourceSystemID, currentTargetID: 0, manualOrder: null };
}

test("without a native transfer the run waits at the gate and says so", () => {
  const planned = crossing.plan({ entityID: ENTITY, pilotID: "coop-pilot-004", gate: GATE, now: 1000 });
  assert.equal(planned.status, "PLANNED");
  const result = crossing.tick({
    sceneForSystem: () => fakeScene({ itemID: ENTITY, position: { x: 0, y: 0, z: 0 }, radius: 100 }),
    getController: () => fakeController(),
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
      getController: () => fakeController(),
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
    getController: () => fakeController(),
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
  assert.equal(entry.lastReason, "SHIP_NOT_IN_SOURCE_SCENE:NO_REVIVE_PATH",
    "nothing can bring the hull back, so the run stops instead of spinning");
});

test("the adapter receives the proven gate pair, not a stargate record", () => {
  // Measured 2026-10-29: handing the adapter the stargate row made every attempt fail
  // NATIVE_GATE_PREFLIGHT_REJECTED, because it re-reads both gates by ID and got null.
  const seen = [];
  crossing.plan({ entityID: 980000000888, pilotID: "coop-pilot-009", gate: GATE, now: 500000 });
  crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: (id) => (Number(id) === 980000000888
        ? { itemID: id, kind: "ship", nativeNpc: true, mode: "STOP",
          systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 } : null),
    }),
    getController: () => fakeController(980000000888),
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
    getController: () => fakeController(),
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
    getController: () => fakeController(),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    materialize: () => ({ success: false, errorMsg: "NPC_NOT_FOUND" }),
    now: 810001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === 980000000556);
  // A live controller is not proof of a ship: it earns a bounded number of revivals, then
  // the run stops with the truth instead of retrying for ever.
  assert.equal(mine.phase, "APPROACH");
  assert.equal(mine.lastReason, "SHIP_NOT_IN_SOURCE_SCENE:CONTROLLER_LIVE");
  let last = mine;
  for (let i = 1; i <= crossing.MAX_REVIVE_MISSES; i += 1) {
    const next = crossing.tick({
      sceneForSystem: () => ({ getEntityByID: () => null }),
      getController: () => fakeController(),
      getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
      materialize: () => ({ success: false }),
      now: 810001 + i * 1000,
    }).advanced.find((row) => Number(row.entityID) === 980000000556);
    if (!next) break;
    last = next;
    if (next.phase === "BLOCKED") break;
  }
  assert.equal(last.phase, "BLOCKED");
  assert.equal(last.lastReason, "SHIP_LOST_REVIVE_FAILED");
});

test("a refusal names the real blocker instead of one opaque code, and a hopeless hull stops", () => {
  // Measured 2026-10-29: five attempts returned NATIVE_GATE_PREFLIGHT_REJECTED and taught
  // nothing, because the adapter reports one code for a dozen different predicates.
  assert.deepEqual(
    crossing.preflightBlocker({ sourceScene: { systemID: 30000142 },
      ship: { itemID: 1, kind: "ship", nativeNpc: true, position: { x: 0, y: 0, z: 0 } },
      controller: { entityID: 1, systemID: 30000142, currentTargetID: 0 } }), null);
  const rejected = [];
  crossing.plan({ entityID: 980000000777, pilotID: "coop-pilot-002", gate: GATE, now: 900000 });
  const result = crossing.tick({
    sceneForSystem: () => ({ systemID: 30000142,
      getEntityByID: () => ({ itemID: 980000000777, kind: "ship", nativeNpc: true,
        position: { x: 0, y: 0, z: 0 }, radius: 100, mode: "STOP" }) }),
    getController: () => fakeController(),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    // A piloted hull can never cross: it is a permanent refusal, not a waiting game.
    getController: () => ({ entityID: 980000000777, systemID: 30000142, currentTargetID: 0,
      manualOrder: { type: "attack" } }),
    transfer: (args) => { rejected.push(args.entityID); return { success: false, errorMsg: "X" }; },
    now: 900001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === 980000000777);
  assert.equal(mine.phase, "BLOCKED");
  assert.equal(mine.lastReason, "PREFLIGHT_IMPOSSIBLE:ATTACK_ORDER");
  assert.deepEqual(rejected, [], "no attempt is burned on a refusal we can already name");
});

test("a hull that keeps re-locking is stood down once, then stopped honestly", () => {
  // Measured 2026-10-29: a mining hauler sat on the gate with the live controller holding a
  // target through an hour of ticks. "Waiting for calm" for ever is indistinguishable from
  // progress, so the run stands the hull down with a native order and then stops.
  const entityID = 980000000666;
  crossing.plan({ entityID, pilotID: "coop-pilot-002", gate: GATE, now: 1000000 });
  const standDowns = [];
  let last = null;
  for (let tick = 1; tick <= crossing.MAX_TARGET_WAITS; tick += 1) {
    const next = crossing.tick({
      sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
        getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
          systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 }) }),
      getController: () => ({ entityID, systemID: GATE.sourceSystemID, currentTargetID: 40009256 }),
      getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
      followGate: () => true,
      standDown: (id) => { standDowns.push(id); return true; },
      transfer: () => { throw new Error("must not attempt a crossing it cannot make"); },
      now: 1000000 + tick * 20000,
    }).advanced.find((row) => Number(row.entityID) === entityID);
    if (!next) break;
    last = next;
  }
  assert.ok(standDowns.length >= 1, "the hull is stood down with a real order");
  assert.deepEqual([...new Set(standDowns)], [entityID], "always that hull, never a guess");
  // A stand-down is an order, not a tick: two ticks inside the rate limit issue one.
  const before = standDowns.length;
  crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 }) }),
    getController: () => ({ entityID, systemID: GATE.sourceSystemID, currentTargetID: 40009256 }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    standDown: (id) => { standDowns.push(id); return true; },
    now: 1000000 + crossing.MAX_TARGET_WAITS * 20000 + 1000,
  });
  assert.equal(standDowns.length, before, "a tick inside the rate limit issues nothing");
  const final = crossing.read().find((row) => Number(row.entityID) === entityID);
  assert.equal(final.phase, "BLOCKED");
  assert.equal(final.lastReason, "TARGET_LOCKED_PERSISTENT");
  assert.ok(last, "the run was advanced before it stopped");
});

test("the scene stargate decides the jump range, not the static-data row", () => {
  // Measured 2026-10-29: five attempts were refused NPC_NOT_AT_PHYSICAL_GATE because this
  // module measured the gap with the static-data gate (a bigger radius) while the adapter
  // re-reads the scene's own stargate. The attempt must not be authorised by the wrong row.
  const entityID = 980000000444;
  crossing.plan({ entityID, pilotID: "coop-pilot-002", gate: GATE, now: 1200000 });
  let attempted = false;
  const result = crossing.tick({
    sceneForSystem: () => ({
      systemID: GATE.sourceSystemID,
      // 6 000 m from the gate centre, gate radius 3 000, ship radius 100: surface gap 2 900.
      staticEntities: [{ itemID: GATE.sourceGateID, kind: "stargate",
        position: { x: 0, y: 0, z: 0 }, radius: 3000 }],
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, radius: 100,
        position: { x: 6000, y: 0, z: 0 } }),
    }),
    // The static-data row claims a huge radius; it must not be able to fake proximity.
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 10000 }),
    getController: () => fakeController(entityID),
    followGate: () => true,
    transfer: () => { attempted = true; return { success: false, errorMsg: "X" }; },
    now: 1200001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === entityID);
  assert.equal(attempted, false, "no attempt is made from the wrong measurement");
  assert.equal(mine.phase, "APPROACH");
});

test("a hull that cannot do the job is retired with a reason, not retried for ever", () => {
  // Measured 2026-10-29: a mining hauler in Jita was ordered to the gate, and its own mining
  // behaviour flew it back to a belt every time - the gap oscillated between 7 km and 13 km
  // for half an hour. Retiring the run is the honest end; it never resumes.
  const entityID = 980000000333;
  crossing.plan({ entityID, pilotID: "coop-pilot-002", gate: GATE, now: 1300000 });
  const retired = crossing.abandon(entityID, "HULL_ROLE_CONFLICT:MINING_HAULER_RETURNS_TO_BELT");
  assert.equal(retired.status, "ABANDONED");
  assert.equal(retired.entry.phase, "ABANDONED");
  const ticked = crossing.tick({ sceneForSystem: () => ({ getEntityByID: () => null }), now: 1300001 });
  assert.equal(ticked.advanced.some((row) => Number(row.entityID) === entityID), false,
    "an abandoned run is never advanced again");
  assert.equal(crossing.abandon(980000001234).status, "NOT_FOUND");
});

test("a mining fleet hull is refused before a crossing is ever journaled", () => {
  // Measured 2026-10-29: a fleet hauler in Jita was ordered to the gate and its mining
  // behaviour flew it back to a belt every time; the fleet meanwhile lost the hull from its
  // slot. Planning is the place to refuse that, before any attempt is spent.
  const refused = crossing.plan({ entityID: 980000000222, pilotID: "coop-pilot-002", gate: GATE,
    operatorKind: "coop-mining-30000145-1-hauler", now: 1400000 });
  assert.equal(refused.status, "REFUSED");
  assert.equal(refused.reason, "HULL_ROLE_CONFLICT:MINING_FLEET");
  assert.equal(crossing.read().some((row) => Number(row.entityID) === 980000000222), false,
    "nothing is written for a hull that cannot do the job");
});

test("a refused warp says why it was refused", () => {
  // Measured 2026-10-30: the run reported a bare WARP_REFUSED three times in two minutes and
  // there was no way to tell a busy hull from a warp the world simply does not allow.
  const entityID = 980000000121;
  crossing.plan({ entityID, pilotID: "coop-pilot-002", gate: GATE, now: 1500000 });
  const result = crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, radius: 100, position: { x: 400000, y: 0, z: 0 } }) }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    getController: () => fakeController(entityID),
    // A far target is a warp, and the world refuses it for its own reason.
    warpToGate: () => ({ success: false, errorMsg: "WARP_DRIVE_UNREADY" }),
    now: 1500001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === entityID);
  assert.equal(mine.lastReason, "WARP_REFUSED:WARP_DRIVE_UNREADY");
});

test("a follow order that locks the gate is undone by a stop order, and then it crosses", () => {
  // Measured 2026-10-30: stock issueManualOrder sets currentTargetID to the follow target, so
  // every approach order this module issued re-locked the gate and the adapter refused the
  // crossing as TARGET_LOCKED. A stop order clears it, and only then is an attempt honest.
  const entityID = 980000000880;
  crossing.plan({ entityID, pilotID: "coop-pilot-002", gate: GATE, now: 1600000 });
  let locked = true;
  let attempts = 0;
  const result = crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 }) }),
    getController: () => ({ entityID, systemID: GATE.sourceSystemID,
      currentTargetID: locked ? GATE.sourceGateID : 0 }),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    standDown: () => { locked = false; return true; },
    // The adapter proves the SAME hull at the destination; a foreign id is a fake crossing.
    transfer: (args) => { if (Number(args.entityID) === entityID) attempts += 1;
      return { ...verified, entityID: Number(args.entityID) }; },
    now: 1600001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === entityID);
  assert.equal(attempts, 1, "the attempt happens in the same tick the lock is cleared");
  assert.equal(mine.phase, "ARRIVED");
});

test("a pruned identity link is re-established from the durable record, and only there", () => {
  // Measured 2026-10-30: the journal and the durable store both proved the hull was in the
  // source system, the identity link had been pruned, and every attempt was refused
  // SOURCE_IDENTITY_MISMATCH. Bookkeeping about a ship that already exists is not a claim
  // that it moved - but it may only be done where the record says the hull lives.
  const entityID = 980000000991;
  crossing.plan({ entityID, pilotID: "coop-pilot-055", gate: GATE, now: 1700000 });
  const linked = [];
  const identity = {
    get: () => null,
    link: (pilot, systemID, id) => { linked.push({ pilot: pilot.id, systemID, id }); return {}; },
  };
  const result = crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 }) }),
    getController: () => fakeController(entityID),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    identity, hullSystemOf: () => GATE.sourceSystemID,
    transfer: () => ({ ...verified, entityID }),
    now: 1700001,
  });
  assert.deepEqual(linked, [{ pilot: "coop-pilot-055", systemID: GATE.sourceSystemID, id: entityID }]);
  assert.equal(result.advanced.find((row) => Number(row.entityID) === entityID).phase, "ARRIVED");
});

test("a hull that is not where the journal says it is stops with the truth", () => {
  const entityID = 980000000992;
  crossing.plan({ entityID, pilotID: "coop-pilot-056", gate: GATE, now: 1800000 });
  let attempted = false;
  const result = crossing.tick({
    sceneForSystem: () => ({ systemID: GATE.sourceSystemID,
      getEntityByID: () => ({ itemID: entityID, kind: "ship", nativeNpc: true, mode: "STOP",
        systemID: GATE.sourceSystemID, position: { x: 0, y: 0, z: 0 }, radius: 100 }) }),
    getController: () => fakeController(entityID),
    getGate: () => ({ itemID: GATE.sourceGateID, position: { x: 0, y: 0, z: 0 }, radius: 3000 }),
    identity: { get: () => null, link: () => { throw new Error("must not link"); } },
    hullSystemOf: () => 30000142,
    transfer: () => { attempted = true; return verified; },
    now: 1800001,
  });
  const mine = result.advanced.find((row) => Number(row.entityID) === entityID);
  assert.equal(attempted, false, "no crossing is attempted from a record that disagrees");
  assert.equal(mine.phase, "BLOCKED");
  assert.equal(mine.lastReason, "HULL_NOT_IN_JOURNAL_SYSTEM:30000142");
});
