"use strict";
// A durable native ship that was mid-warp when a scene was swapped or the
// process restarted keeps `mode === "WARP"` with nothing left to land it: the
// stock mining loop skips it forever and reports MINER_NOT_IN_SCENE_OR_WARPING
// while the fleet claims to be mining. Finish that warp exactly the way native
// movement does, or clear a warp-less WARP mode, and say so once per ship.
const lastAt = new Map();
const THROTTLE_MS = 60000;

function vec(value) {
  return value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z)) ? { x: Number(value.x), y: Number(value.y), z: Number(value.z) } : null;
}

function stopAt(entity, point) {
  entity.position = point;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.targetPoint = point;
  entity.warpState = null;
  entity.sessionlessWarpIngress = null;
}

function note(scene, entity, reason, now) {
  const key = `${entity.itemID || 0}:${reason}`;
  if (now - (lastAt.get(key) || 0) < THROTTLE_MS) return;
  lastAt.set(key, now);
  try {
    require("./coopRuntimeProbe").observe("living-native-warp-recovered", null,
      { spaceState: { systemID: Number(scene?.systemID) || 0 } },
      { reason, shipID: Number(entity.itemID) || 0, atMs: now });
  } catch (_error) { /* telemetry must never break movement */ }
}

function broadcast(scene, entity) {
  try {
    if (typeof scene?.broadcastSlimItemChanges === "function") scene.broadcastSlimItemChanges([entity]);
  } catch (_error) { /* a notification must never block the self-heal */ }
}

// Returns a short reason when the ship was healed, otherwise null. Never touches
// a ship with a queued warp, and never touches a warp that is still in flight.
function release(entity, scene, now = Date.now()) {
  if (!entity || entity.mode !== "WARP" || entity.pendingWarp) return null;
  const state = entity.warpState;
  const completeAt = Number(state?.completeAtMs ?? state?.travelCompleteAtMs);
  if (state && Number.isFinite(completeAt) && now < completeAt) return null;
  const landing = vec(state?.targetPoint) || vec(entity.targetPoint) || vec(entity.position);
  if (!landing) return null;
  const reason = state ? "WARP_COMPLETED" : "WARP_STATE_LOST";
  stopAt(entity, landing);
  broadcast(scene, entity);
  note(scene, entity, reason, now);
  return reason;
}

module.exports = { release };
