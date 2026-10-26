"use strict";
// Opt-in, read-only trace for the native mining fleet. The stock loop silently
// `continue`s when a miner has no usable module, no snapshot, no reachable rock
// or a failed target lock, so a fleet can claim "mining" forever and produce
// nothing. One throttled event per fleet and reason makes that visible.
const lastAt = new Map();
const THROTTLE_MS = 120000;
function note(reason, payload = {}) {
  if (process.env.EVEJS_COOP_MINING_TRACE !== "1") return;
  const now = Date.now();
  const key = `${reason}:${payload.systemID || 0}:${payload.fleetID || 0}`;
  if (now - (lastAt.get(key) || 0) < THROTTLE_MS) return;
  lastAt.set(key, now);
  try {
    require("./coopRuntimeProbe").observe("living-mining-blocker", null,
      { spaceState: { systemID: Number(payload.systemID) || 0 } },
      { reason, ...payload, atMs: now });
  } catch (_error) { /* tracing must never break the native tick */ }
}
// A failed activation was reported inline with seventeen hand-built fields,
// which is how the trace drifted from the code it describes. The shape is owned
// here so the stock loop only passes what it already has.
function noteActivationFailure(fleetRecord, scene, minerEntity, entry, result) {
  const moduleItem = (entry && entry.moduleItem) || {};
  note("MODULE_ACTIVATE_FAILED", {
    fleetID: Number(fleetRecord && fleetRecord.fleetID) || 0,
    systemID: Number(scene && scene.systemID) || 0,
    minerID: Number(minerEntity && minerEntity.itemID) || 0,
    moduleID: Number(moduleItem.itemID) || 0,
    typeID: Number(moduleItem.typeID) || 0,
    locationID: Number(moduleItem.locationID) || 0,
    shipID: Number(minerEntity && minerEntity.itemID) || 0,
    cap: Number(minerEntity && minerEntity.capacitorCapacity) || 0,
    ratio: Number(minerEntity && minerEntity.capacitorChargeRatio),
    native: Boolean(minerEntity && minerEntity.nativeNpc === true),
    hasSession: Boolean(minerEntity && minerEntity.session),
    errorMsg: String((result && result.errorMsg) || "NONE"),
  });
}

// The same for the "one miner reached a rock" observation: it exists to explain
// why a fleet that claims to be mining produces nothing, so it carries the module
// and effect counts that make that visible.
function noteTargetSelected(fleetRecord, scene, minerEntity, targetEntity, miningModules, hooks) {
  note("MINER_TARGET", {
    fleetID: Number(fleetRecord && fleetRecord.fleetID) || 0,
    systemID: Number(scene && scene.systemID) || 0,
    minerID: Number(minerEntity && minerEntity.itemID) || 0,
    targetID: Number(targetEntity && targetEntity.itemID) || 0,
    modules: Array.isArray(miningModules) ? miningModules.length : 0,
    fitted:
      hooks && typeof hooks.getNpcFittedModuleItems === "function"
        ? hooks.getNpcFittedModuleItems(minerEntity).length
        : 0,
    activeEffects:
      minerEntity && minerEntity.activeModuleEffects instanceof Map
        ? minerEntity.activeModuleEffects.size
        : -1,
    distance:
      hooks && typeof hooks.getSurfaceDistance === "function"
        ? Math.round(hooks.getSurfaceDistance(minerEntity, targetEntity))
        : 0,
  });
}

// Per-fleet snapshot of what the ships actually are right now: mode, active
// module effects, capacitor state and whether a runtime controller exists. This
// is the line that showed mining "working" while nothing was produced, so its
// field shape belongs here and not in a 900-character hook.
function noteFleetPostTick(fleetRecord, scene) {
  const ships = Array.isArray(fleetRecord && fleetRecord.minerEntityIDs)
    ? fleetRecord.minerEntityIDs
    : [];
  let getController = null;
  try {
    getController = require("./npc/npcRegistry").getControllerByEntityID;
  } catch (_error) {
    getController = null;
  }
  note("FLEET_POST_TICK", {
    fleetID: Number(fleetRecord && fleetRecord.fleetID) || 0,
    systemID: Number(scene && scene.systemID) || 0,
    state: String((fleetRecord && fleetRecord.state) || ""),
    miners: ships.map((id) => {
      const entity = scene && typeof scene.getEntityByID === "function" ? scene.getEntityByID(id) : null;
      const effects =
        entity && entity.activeModuleEffects instanceof Map ? entity.activeModuleEffects.size : -1;
      let controller = -1;
      if (entity && getController) {
        try {
          controller = getController(id) ? 1 : 0;
        } catch (_error) {
          controller = -1;
        }
      }
      return [
        id,
        String((entity && entity.mode) || "none"),
        "act" + effects,
        "cap" + (entity ? Number(entity.capacitorChargeRatio) : "none"),
        "capmax" + (entity ? Number(entity.capacitorCapacity) : 0),
        "tau" + (entity ? Number(entity.capacitorRechargeRate) || 0 : 0),
        "reAt" + (entity ? Number(entity.capacitorRechargedAtMs) || 0 : 0),
        "tr" + (entity && entity.transient === true ? 1 : 0),
        "ctl" + controller,
        "st" + (entity && entity.conditionState ? Number(entity.conditionState.charge) : -1),
      ].join("|");
    }).join(" ; "),
  });
}

// Why a miner that reached the belt still has nothing to shoot: no rock, or every
// rock is already claimed.
function noteNoMineableTarget(fleetRecord, scene, minerEntity, availableTargetEntries, claimCounts) {
  note("NO_MINEABLE_TARGET", {
    fleetID: Number(fleetRecord && fleetRecord.fleetID) || 0,
    systemID: Number(scene && scene.systemID) || 0,
    minerID: Number(minerEntity && minerEntity.itemID) || 0,
    rocks: Array.isArray(availableTargetEntries) ? availableTargetEntries.length : -1,
    claims: claimCounts instanceof Map ? claimCounts.size : -1,
    activeAsteroidID: Number(fleetRecord && fleetRecord.activeAsteroidID) || 0,
  });
}

module.exports = { note, noteActivationFailure, noteTargetSelected, noteFleetPostTick, noteNoMineableTarget };
