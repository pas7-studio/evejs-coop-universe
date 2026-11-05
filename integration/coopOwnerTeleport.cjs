"use strict";
// COOP-MJD: an in-space teleport has to reach the pilot's OWN client, not only watchers.
//
// Owner report 2026-11-05: "the micro jump drive still does not jump 100 km forward - after the
// animation the pilot is in the same place". The server half is provably fine:
//   * type 4383 fits effect `microJumpDrive` (4921, duration attribute 73),
//   * `space/modules/microJumpDriveRuntime.js` resolves durationMs 12000 and 100 000 m
//     (measured with the live reference data, 2026-11-05), and
//   * it really calls `scene.teleportDynamicEntityToPoint(entity, position + 100 km)`.
// So the jump happens on the server and only the pilot's copy of the packet is wrong.
//
// Why the pilot's copy is the special case: `teleportDynamicEntityToPoint` used ONE
// `broadcastMovementUpdates`, so every session - the owner included - received the SetBallPosition
// at the raw authored destiny stamp. The pilot lane is not raw:
//   * the movement authority resolves a per-session delivery stamp for the pilot and the client
//     destiny ticker drops anything older than the state it already holds
//     (`destiny/net/client/_ticker.pyj`: "Michelle discarded a state that was too old"),
//   * the engine itself never pushes a pilot position on the raw stamp elsewhere - pilot warp
//     corrections carry `minimumLeadFromCurrentHistory = PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS`
//     (`space/movement/dispatch/movementWatcherCorrections.js`), and observer corrections are
//     explicitly `watchers-only` (`excludedSession: entity.session`).
// Watchers anchor on raw stamps and see the jump; the owner is the only entity whose own packet can
// arrive already in the past.
//
// This module owns that one lane: the same authoritative bundle (speed 0, position, stop, velocity)
// goes to the owner with the pilot lead, and a `space.teleport.delivery` record lands in
// coop-events.jsonl so the next live jump is provable instead of assumed.
//
// It never invents motion, never touches another entity, and never decides what the teleport is -
// the caller has already moved the entity before this runs.
const path = require("path");

const destiny = require(path.join(__dirname, "destiny"));
const {
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
} = require(path.join(__dirname, "movement/warp/movementWarpContract"));
const probe = require(path.join(__dirname, "coopRuntimeProbe"));

// The lead the pilot warp corrections use. A pilot update authored on the raw stamp is behind the
// pilot's own lane; this is the value the rest of the engine already stamps pilot movement with.
const OWNER_LEAD_TICKS = PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS;
const OWNER_SEND_OPTIONS = Object.freeze({
  minimumLeadFromCurrentHistory: OWNER_LEAD_TICKS,
  maximumLeadFromCurrentHistory: OWNER_LEAD_TICKS,
});

// Same predicate as space/runtime.js `isReadyForDestiny`: a session that has not finished its
// initial ballpark or has lost its socket must not be sent destiny payloads.
function sessionReadyForDestiny(session) {
  return Boolean(
    session &&
    session._space &&
    session._space.initialStateSent &&
    session.socket &&
    !session.socket.destroyed,
  );
}

function ownerSessionFor(entity) {
  return entity && sessionReadyForDestiny(entity.session) ? entity.session : null;
}

// The exact bundle the marker already broadcast: stop, move, stay stopped. Order matters - the
// client applies it in sequence, so the position is seated before the stop freezes it.
function buildTeleportUpdates(entity, stamp) {
  return [
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
    },
    {
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    },
    {
      stamp,
      payload: destiny.buildStopPayload(entity.itemID),
    },
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
    },
  ];
}

// Pure decision, so a test can prove which lane a teleport takes without a running scene.
function planTeleportDelivery(entity) {
  if (!entity || !(Number(entity.itemID) > 0)) {
    return {
      status: "TELEPORT_NO_ENTITY",
      reason: "ENTITY_MISSING",
      ownerLane: false,
      ownerSession: null,
    };
  }
  const ownerSession = ownerSessionFor(entity);
  if (!ownerSession) {
    return {
      status: "TELEPORT_WATCHERS_ONLY",
      reason: entity.session ? "OWNER_SESSION_NOT_READY" : "NO_OWNER",
      ownerLane: false,
      ownerSession: null,
    };
  }
  return {
    status: "TELEPORT_OWNER_LEAD",
    reason: "OWNER_LANE_NEEDS_LEAD",
    ownerLane: true,
    ownerSession,
  };
}

function sendOwnerTeleport(runtime, ownerSession, updates) {
  if (!runtime || typeof runtime.sendDestinyUpdates !== "function") {
    return false;
  }
  runtime.sendDestinyUpdates(ownerSession, updates, false, OWNER_SEND_OPTIONS);
  return true;
}

// Called by space/runtime.js teleportDynamicEntityToPoint in place of its old one-size-fits-all
// broadcast. Returns the delivery plan so the caller can exclude the owner from the watcher list.
function dispatchTeleport(runtime, entity, stamp) {
  const plan = planTeleportDelivery(entity);
  if (plan.status === "TELEPORT_NO_ENTITY") {
    return plan;
  }

  const updates = buildTeleportUpdates(entity, stamp);
  const ownerSent = plan.ownerLane
    ? sendOwnerTeleport(runtime, plan.ownerSession, updates)
    : false;
  // The owner's copy carries the lead, so the watcher broadcast must not also send it at the raw
  // stamp: two copies of one position on two stamps is exactly the conflict that made the ego ball
  // jitter in the warp experiments. Exclude the owner even when the lead send failed - an unready
  // session is filtered by broadcastMovementUpdates anyway, and a ready one must never get both.
  runtime.broadcastMovementUpdates(updates, plan.ownerLane ? entity.session : null);

  probe.observe("space.teleport.delivery", entity.session || null, null, {
    status: plan.status,
    reason: plan.reason,
    entityID: Number(entity.itemID) >> 0,
    typeID: Number(entity.typeID) || 0,
    stamp: Number(stamp) >>> 0,
    leadTicks: plan.ownerLane ? OWNER_LEAD_TICKS : 0,
    ownerLeadSent: ownerSent,
    position: {
      x: Math.round(Number(entity.position && entity.position.x) || 0),
      y: Math.round(Number(entity.position && entity.position.y) || 0),
      z: Math.round(Number(entity.position && entity.position.z) || 0),
    },
    updateCount: updates.length,
  });

  return plan;
}

module.exports = {
  OWNER_LEAD_TICKS,
  OWNER_SEND_OPTIONS,
  buildTeleportUpdates,
  dispatchTeleport,
  ownerSessionFor,
  planTeleportDelivery,
  sendOwnerTeleport,
  sessionReadyForDestiny,
};
