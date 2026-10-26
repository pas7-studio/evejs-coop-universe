"use strict";
// One activation attempt for a native mining module, with the capacitor gate.
//
// The stock loop retries the activation on every tick. On a sessionless hull the
// retry keeps draining what little capacitor exists, so the ship never reaches the
// 23 GJ module cost and the fleet reports active modules with no ore (measured:
// hulls pinned at 0-2% while the recharge advance added its correct ~0.006/s).
// This module owns the whole decision: wait, activate, or report the failure.
const gate = require("./coopMiningCapacitorGate.cjs");

const MODULE_COST_GJ = 30;

function activate(deps = {}) {
  const {scene, pseudoSession, minerEntity, entry, targetEntity, fleetRecord} = deps;
  if (!scene || !entry || !entry.moduleItem) return {attempted: false, reason: "no-module"};
  if (gate.shouldWait(minerEntity, MODULE_COST_GJ)) {
    note(deps, "CAPACITOR_WAIT", gate.why(minerEntity, MODULE_COST_GJ));
    return {attempted: false, reason: "capacitor-wait"};
  }
  if (typeof scene.activateGenericModule !== "function") return {attempted: false, reason: "no-scene-api"};
  const result = scene.activateGenericModule(
    pseudoSession,
    entry.moduleItem,
    entry.effectRecord && entry.effectRecord.name,
    {targetID: targetEntity && targetEntity.itemID},
  );
  if (!result || result.success !== true) {
    noteFailure(deps, result);
    return {attempted: true, success: false};
  }
  return {attempted: true, success: true};
}

function trace(deps) {
  if (deps.trace) return deps.trace;
  try {
    return require("./coopMiningTrace.cjs");
  } catch (_error) {
    return null;
  }
}

function note(deps, reason, payload) {
  const module_ = trace(deps);
  if (!module_ || typeof module_.note !== "function") return;
  module_.note(reason, {
    fleetID: Number(deps.fleetRecord && deps.fleetRecord.fleetID) || 0,
    systemID: Number(deps.scene && deps.scene.systemID) || 0,
    minerID: Number(deps.minerEntity && deps.minerEntity.itemID) || 0,
    ...payload,
  });
}

function noteFailure(deps, result) {
  const module_ = trace(deps);
  if (!module_ || typeof module_.noteActivationFailure !== "function") return;
  module_.noteActivationFailure(
    deps.fleetRecord,
    deps.scene,
    deps.minerEntity,
    deps.entry,
    result,
  );
}

module.exports = {activate, MODULE_COST_GJ};
