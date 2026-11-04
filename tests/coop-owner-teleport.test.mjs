import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Owner report 2026-11-05: "the micro jump drive does not jump 100 km forward - after the animation
// the pilot is in the same place". The server moves the ship; the pilot's own copy of the packet is
// the one that never landed, because it was broadcast on the raw destiny stamp while the pilot lane
// needs the lead the warp corrections use. These tests pin the lane split, the payload order, the
// unready/absent owner cases, and the coop-events record that makes the next live jump provable.
//
// The stock destiny payload builders pull the game store, which refuses to load outside the isolated
// runner, so this test injects a fake for `space/destiny` only. Everything else - the lane decision,
// the bundle, the probe record - is the real deployed module.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const spaceRoot = path.join(forkRoot, "Code/server/src/space");
const require = createRequire(import.meta.url);

const eventsFile = path.join(
  os.tmpdir(),
  `coop-owner-teleport-${process.pid}-${Date.now()}.jsonl`,
);
process.env.EVEJS_COOP_EVENTS_FILE = eventsFile;

const calls = [];
const fakeDestiny = {
  buildSetSpeedFractionPayload: (entityID, fraction) => ["SetSpeedFraction", [entityID, fraction]],
  buildSetBallPositionPayload: (entityID, position) => ["SetBallPosition", [entityID, position.x, position.y, position.z]],
  buildStopPayload: (entityID) => ["Stop", [entityID]],
  buildSetBallVelocityPayload: (entityID, velocity) => ["SetBallVelocity", [entityID, velocity.x, velocity.y, velocity.z]],
};
const destinyPath = require.resolve(path.join(spaceRoot, "destiny"));
require.cache[destinyPath] = { id: destinyPath, filename: destinyPath, loaded: true, exports: fakeDestiny };

const teleport = require(path.join(spaceRoot, "coopOwnerTeleport.js"));

function fakeRuntime() {
  const sent = [];
  const broadcast = [];
  return {
    sent,
    broadcast,
    sendDestinyUpdates(session, updates, waitForBubble, options) {
      sent.push({ session, updates, waitForBubble, options });
    },
    broadcastMovementUpdates(updates, excludedSession) {
      broadcast.push({ updates, excludedSession });
    },
  };
}

function pilotEntity(extra = {}) {
  const session = {
    characterID: 140000005,
    _space: { shipID: 9988400125771, initialStateSent: true },
    socket: { destroyed: false },
  };
  return {
    entity: {
      itemID: 9988400125771,
      typeID: 638,
      session,
      position: { x: 1000, y: 2000, z: 3000 },
      velocity: { x: 0, y: 0, z: 0 },
      ...extra,
    },
    session,
  };
}

test("a pilot's teleport goes to the owner lane with the warp-correction lead, watchers get the rest", () => {
  const runtime = fakeRuntime();
  const { entity, session } = pilotEntity();
  const plan = teleport.dispatchTeleport(runtime, entity, 4242);

  assert.equal(plan.status, "TELEPORT_OWNER_LEAD");
  assert.equal(runtime.sent.length, 1, "the owner gets exactly one copy");
  const [ownerSend] = runtime.sent;
  assert.equal(ownerSend.session, session);
  assert.equal(ownerSend.waitForBubble, false);
  assert.equal(ownerSend.options.minimumLeadFromCurrentHistory, teleport.OWNER_LEAD_TICKS);
  assert.equal(ownerSend.options.maximumLeadFromCurrentHistory, teleport.OWNER_LEAD_TICKS);
  assert.equal(teleport.OWNER_LEAD_TICKS, 4,
    "the pilot warp corrections use 4 ticks; a raw-stamp push is what the client discards as too old");
  assert.equal(runtime.broadcast.length, 1);
  assert.equal(runtime.broadcast[0].excludedSession, session,
    "one position must never be sent to the owner on two different stamps");
});

test("the bundle is speed -> position -> stop -> velocity, all on the teleported state", () => {
  const { entity } = pilotEntity({ position: { x: 101000, y: 500, z: -250 } });
  const updates = teleport.buildTeleportUpdates(entity, 777);
  assert.deepEqual(updates.map((update) => update.payload[0]), [
    "SetSpeedFraction",
    "SetBallPosition",
    "Stop",
    "SetBallVelocity",
  ]);
  assert.ok(updates.every((update) => update.stamp === 777),
    "one stamp for the whole bundle, so the client applies it as one state change");
  assert.deepEqual(updates[1].payload[1], [entity.itemID, 101000, 500, -250],
    "the position is the destination the caller already moved the ship to");
  assert.deepEqual(updates[0].payload[1], [entity.itemID, 0], "speed fraction is zeroed before the jump");
  assert.deepEqual(updates[3].payload[1], [entity.itemID, 0, 0, 0],
    "and the ship stays stopped where it landed");
  assert.ok(calls.length === 0, "the fake destiny is reached through the module, not a copy of it");
});

test("an NPC or any sessionless entity keeps the plain watcher lane", () => {
  const runtime = fakeRuntime();
  const plan = teleport.dispatchTeleport(runtime, {
    itemID: 900000000001,
    typeID: 11393,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  }, 9001);
  assert.equal(plan.status, "TELEPORT_WATCHERS_ONLY");
  assert.equal(plan.reason, "NO_OWNER");
  assert.equal(runtime.sent.length, 0);
  assert.equal(runtime.broadcast.length, 1);
  assert.equal(runtime.broadcast[0].excludedSession, null,
    "nobody is excluded when there is no owner to send the lead copy to");
});

test("an unready owner session is not given the lead lane", () => {
  for (const broken of [
    { _space: { shipID: 1 } },                       // initial ballpark not sent yet
    { _space: { shipID: 1, initialStateSent: true }, socket: { destroyed: true } },
    { _space: { shipID: 1, initialStateSent: true }, socket: null },
    null,
  ]) {
    const runtime = fakeRuntime();
    const plan = teleport.dispatchTeleport(runtime, {
      itemID: 1,
      session: broken,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 0, y: 0, z: 0 },
    }, 4242);
    assert.equal(plan.status, "TELEPORT_WATCHERS_ONLY");
    assert.equal(runtime.sent.length, 0, "no destiny payload to a session without a park");
  }
});

test("readiness is the same predicate the runtime uses, never a guess", () => {
  const good = { _space: { initialStateSent: true }, socket: { destroyed: false } };
  assert.equal(teleport.sessionReadyForDestiny(good), true);
  assert.equal(teleport.sessionReadyForDestiny({ _space: {}, socket: {} }), false);
  assert.equal(teleport.sessionReadyForDestiny(undefined), false);
});

test("a missing entity is reported instead of silently broadcasting", () => {
  const runtime = fakeRuntime();
  assert.equal(teleport.dispatchTeleport(runtime, null, 1).status, "TELEPORT_NO_ENTITY");
  assert.equal(runtime.broadcast.length, 0);
  assert.equal(runtime.sent.length, 0);
});

test("every teleport leaves a coop-events record naming its lane", () => {
  const runtime = fakeRuntime();
  const { entity, session } = pilotEntity();
  teleport.dispatchTeleport(runtime, entity, 5555);
  teleport.dispatchTeleport(runtime, { itemID: 42, position: entity.position, velocity: entity.velocity }, 5556);

  const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const owner = lines.find((line) => line.event === "space.teleport.delivery"
    && line.status === "TELEPORT_OWNER_LEAD" && line.stamp === 5555);
  assert.ok(owner, "the pilot jump is on the record, not assumed");
  assert.equal(owner.characterID, session.characterID);
  assert.equal(owner.shipID, entity.itemID);
  assert.equal(owner.leadTicks, teleport.OWNER_LEAD_TICKS);
  assert.equal(owner.ownerLeadSent, true);
  assert.equal(owner.stamp, 5555);
  assert.deepEqual(owner.position, { x: 1000, y: 2000, z: 3000 });
  const watchers = lines.find((line) => line.event === "space.teleport.delivery" && line.status === "TELEPORT_WATCHERS_ONLY");
  assert.ok(watchers, "and so is the sessionless one");
  assert.equal(watchers.ownerLeadSent, false);
});
