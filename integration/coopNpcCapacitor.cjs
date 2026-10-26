"use strict";
// A native NPC has no capacitor manager: stock EveJS gives it a full capacitor at
// spawn and never recharges it. Player-style modules do consume that capacitor, so
// a co-op mining hull activates its Strip Miner once, drains the pool and then gets
// NOT_ENOUGH_CAPACITOR on every later activation - the fleet reports `state=mining`
// forever while nothing is extracted. Refill an NPC that has actually run dry at its
// next behaviour think. This never touches a real player's capacitor and never adds
// capacity: it only breaks the permanent "zero forever" state.
const DRAINED_RATIO = 0.001;

function refill(scene, controller) {
  if (!scene || !controller) return false;
  const entityID = Number(controller.entityID || controller.itemID || 0);
  if (!(entityID > 0)) return false;
  const entity = typeof scene.getEntityByID === "function" ? scene.getEntityByID(entityID) : null;
  if (!entity || entity.kind !== "ship") return false;
  if (entity.session) return false;
  if (entity.nativeNpc !== true) return false;
  const capacity = Number(entity.capacitorCapacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  const ratio = Number(entity.capacitorChargeRatio);
  if (Number.isFinite(ratio) && ratio > DRAINED_RATIO) return false;
  entity.capacitorChargeRatio = 1;
  if (entity.conditionState && typeof entity.conditionState === "object") {
    entity.conditionState.charge = 1;
  }
  return true;
}

module.exports = { refill, DRAINED_RATIO };
