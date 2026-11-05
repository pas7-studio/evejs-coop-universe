"use strict";
// Site sentries that pull the trigger.
//
// The chain that got us here, each step measured on the running stack:
//  1. The batteries a client sees inside a site are category 23 scenery: hit points only,
//     and materialised as static content, so nothing can ever make them shoot.
//  2. The engine does have native sentry profiles, and spawning one produces a real
//     category 11 "Destructible Sentry Gun" entity with a controller - but with the
//     retail empty loadout, so it carries zero weapon modules and never fires either.
//  3. The sentry TYPES do carry real weapon attributes (attribute 114/116/117/118 and 64
//     damage multiplier, 51 rate of fire, 479 targeting range). For example the measured
//     Blood Raider Sentry Gun (13116) is em 4 / exp 1 / kin 1 / th 4, x8, every 8 000 ms.
//
// So this module does the only thing left that is still honest: it fires the SENTRY
// ENTITY's own type attributes through the engine's own damage path
// (space/runtime applyWeaponDamageToTarget), which keeps client notifications,
// destruction, wrecks and kill attribution exactly as they are for a native weapon.
// No damage number is written here; they all come from the type's dogma attributes, and a
// type without damage attributes is never used.
const num = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const DAMAGE_ATTRS = [["em", 114], ["explosive", 116], ["kinetic", 117], ["thermal", 118]];
const MULTIPLIER_ATTR = 64;
const CYCLE_ATTR = 51;
const RANGE_ATTR = 479;
const MIN_CYCLE_MS = 1000;
const MAX_CYCLE_MS = 60000;
const MIN_RANGE_METERS = 5000;
const MAX_RANGE_METERS = 250000;

function distanceMeters(left, right) {
  if (!left || !right) return Infinity;
  const dx = num(left.x) - num(right.x);
  const dy = num(left.y) - num(right.y);
  const dz = num(left.z) - num(right.z);
  return Math.hypot(dx, dy, dz);
}

// The weapon profile of a sentry type, read from its own dogma attributes. Returns null
// when the type really has no damage - such a type is never made to fire.
function weaponProfile(attributes) {
  const attrs = attributes && typeof attributes === "object" ? attributes : {};
  const multiplier = num(attrs[MULTIPLIER_ATTR], 0);
  if (!(multiplier > 0)) return null;
  const vector = {};
  let total = 0;
  for (const [name, attributeID] of DAMAGE_ATTRS) {
    const raw = num(attrs[attributeID], 0);
    if (!(raw > 0)) continue;
    const value = raw * multiplier;
    if (!(value > 0)) continue;
    vector[name] = value;
    total += value;
  }
  if (!(total > 0)) return null;
  const cycleMs = Math.max(MIN_CYCLE_MS, Math.min(MAX_CYCLE_MS, Math.trunc(num(attrs[CYCLE_ATTR], 0))));
  const rangeMeters = Math.max(MIN_RANGE_METERS,
    Math.min(MAX_RANGE_METERS, Math.trunc(num(attrs[RANGE_ATTR], 0))));
  return { cycleMs, rangeMeters, total, vector };
}

function isPlayerShip(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (String(entity.kind || "") !== "ship") return false;
  const characterID = pos(entity.session && entity.session.characterID);
  if (!(characterID > 0)) return false;
  if (!(pos(entity.itemID) > 0)) return false;
  return entity.position && typeof entity.position === "object";
}

function createSentryFire({
  listSentries = null,
  getEntity = null,
  readAttributes = null,
  applyDamage = null,
  observe = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof listSentries !== "function") throw Error("SENTRY_FIRE_NEEDS_SENTRIES");
  if (typeof getEntity !== "function") throw Error("SENTRY_FIRE_NEEDS_ENTITIES");
  if (typeof readAttributes !== "function") throw Error("SENTRY_FIRE_NEEDS_ATTRIBUTES");
  if (typeof applyDamage !== "function") throw Error("SENTRY_FIRE_NEEDS_DAMAGE_PATH");

  const profiles = new Map();
  const nextShotAtMs = new Map();

  function profileFor(typeID) {
    const key = pos(typeID);
    if (!(key > 0)) return null;
    if (profiles.has(key)) return profiles.get(key);
    let attributes = null;
    try {
      attributes = readAttributes(key);
    } catch (_error) {
      attributes = null;
    }
    const profile = weaponProfile(attributes);
    profiles.set(key, profile);
    return profile;
  }

  function tick({ systemID, scene } = {}) {
    const out = { status: "NO_SENTRIES", systemID: pos(systemID), sentries: 0, shots: [], skipped: [] };
    if (!(out.systemID > 0) || !scene) return { ...out, status: "INVALID_SCENE" };
    const now = Math.max(0, Math.trunc(num(clock(), 0)));
    const sentryIDs = (listSentries() || []).filter((entry) => Number(entry && entry.systemID) === out.systemID);
    out.sentries = sentryIDs.length;
    if (!sentryIDs.length) return out;
    const players = [];
    const containers = [scene.dynamicEntities, scene.staticEntitiesByID];
    for (const container of containers) {
      if (!(container instanceof Map)) continue;
      for (const entity of container.values()) {
        if (isPlayerShip(entity)) players.push(entity);
      }
    }
    if (!players.length) return { ...out, status: "NO_PLAYER_IN_SCENE" };
    out.status = "SENTRIES_READY";
    for (const sentry of sentryIDs) {
      const sentryID = pos(sentry && sentry.entityID);
      if (!(sentryID > 0)) continue;
      const entity = getEntity(scene, sentryID);
      if (!entity) {
        nextShotAtMs.delete(sentryID);
        out.skipped.push({ sentryID, reason: "SENTRY_GONE" });
        continue;
      }
      const profile = profileFor(entity.typeID);
      if (!profile) {
        out.skipped.push({ sentryID, reason: "NO_WEAPON_ATTRIBUTES" });
        continue;
      }
      const dueAt = num(nextShotAtMs.get(sentryID), 0);
      if (dueAt > now) continue;
      let target = null;
      let bestRange = Infinity;
      for (const ship of players) {
        const range = distanceMeters(entity.position, ship.position);
        if (range > profile.rangeMeters || range >= bestRange) continue;
        target = ship;
        bestRange = range;
      }
      if (!target) {
        out.skipped.push({ sentryID, reason: "NO_TARGET_IN_RANGE" });
        continue;
      }
      let result = null;
      try {
        result = applyDamage(scene, entity, target, { ...profile.vector }, now);
      } catch (error) {
        result = { errorMsg: error && error.message };
      }
      const damageResult = result && result.damageResult;
      const hit = Boolean(damageResult && damageResult.success === true);
      nextShotAtMs.set(sentryID, now + profile.cycleMs);
      const shot = {
        sentryID,
        typeID: pos(entity.typeID),
        targetID: pos(target.itemID),
        characterID: pos(target.session && target.session.characterID),
        rangeMeters: Math.round(bestRange),
        damage: profile.total,
        cycleMs: profile.cycleMs,
        hit,
        destroyed: Boolean(damageResult && damageResult.data && damageResult.data.destroyed),
      };
      out.shots.push(shot);
      if (typeof observe === "function") {
        try {
          observe("coop-site-sentry-fired", { systemID: out.systemID }, null, {
            ...shot,
            evidence: "SENTRY_TYPE_ATTRIBUTES_APPLIED_THROUGH_NATIVE_DAMAGE_PATH",
          });
        } catch (_error) { /* observation must never break the shot */ }
      }
    }
    if (out.shots.length) out.status = "SENTRIES_FIRED";
    return out;
  }

  return {
    reset() { profiles.clear(); nextShotAtMs.clear(); },
    snapshot() { return [...nextShotAtMs.entries()].map(([entityID, atMs]) => ({ entityID, atMs })); },
    tick,
  };
}

module.exports = {
  DAMAGE_ATTRS,
  createSentryFire,
  distanceMeters,
  isPlayerShip,
  weaponProfile,
};
