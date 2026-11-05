"use strict";
// Site batteries that really shoot.
//
// Measured 2026-11-04 on the live stack: the batteries a client sees inside a combat site
// ("Light/Heavy/Cruise Missile Battery") are category 23 scenery. They carry hit points and
// nothing else - no damage multiplier, no em/thermal/kinetic/explosive attribute - and the
// site service materialises them as static content, which has no controller and can never
// open fire. The page therefore showed a missile battery that did nothing at all.
//
// The engine already owns the real thing: every destructible sentry has a native NPC
// profile (measured in the running container: 229 sentry/battery profiles, e.g.
// parity_destructible_sentry_guns_17594_blood_heavy_missile_battery with its own retail
// behaviour profile and loadout). A profile spawned through the native NPC path gets a
// controller, weapons and ammo, and its own behaviour decides when to fire - so nothing in
// this module invents damage, a rate of fire or a range.
//
// This module is only the bridge: for each battery structure that belongs to a live site
// instance, spawn exactly one native sentry of the site's own faction and size, at the
// battery's own position. The static structure stays where it is (it is still the thing the
// client shows and the player can shoot); the sentry is the thing that shoots back.
//
// Nothing happens without a player in the scene: an empty system must not accumulate
// sentries, and a headless world must not pay for them.
const sentries = require("./coopSiteSentries");

const BATTERY_NAME = /battery|sentry|sentry gun|tower/i;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clonePosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  return { x, y, z };
}

// The site's own spawn query carries its faction ("blood_deadspace_pve"). It lives on the
// template's population hints, exactly where the wave data lives. A template that carries
// only a numeric `factionID` (measured: "Drone Collection" is 500021, with no query at all)
// still names its faction through the real faction record, so both are offered.
function siteSpawnQuery(template) {
  const hints = (template && template.populationHints) || {};
  const encounters = Array.isArray(hints.encounters) ? hints.encounters : [];
  const parts = [];
  for (const encounter of encounters) {
    const query = String((encounter && encounter.spawnQuery) || "").trim();
    if (query) parts.push(query);
  }
  const factionID = toInt(template && template.factionID, 0);
  if (factionID > 0) {
    try {
      const record = require("../services/faction/factionState").getFactionRecord(factionID);
      const name = String((record && (record.name || record.factionName)) || "").trim();
      if (name) parts.push(name);
    } catch (_error) { /* an unknown faction simply offers no name */ }
  }
  return parts.join(" ");
}

// One battery structure is a candidate only when the client would call it a battery and it
// belongs to a live shared instance.
function isBatteryEntity(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (entity.dungeonMaterializedKillableStructure !== true) return false;
  if (!BATTERY_NAME.test(String(entity.itemName || entity.slimName || ""))) return false;
  if (!(toInt(entity.dungeonSiteInstanceID, 0) > 0)) return false;
  if (!(toInt(entity.itemID, 0) > 0)) return false;
  return clonePosition(entity.position) !== null;
}

function sceneBatteries(scene) {
  const out = [];
  const seen = new Set();
  for (const container of [scene && scene.staticEntitiesByID, scene && scene.dynamicEntities]) {
    if (!(container instanceof Map)) continue;
    for (const entity of container.values()) {
      if (!isBatteryEntity(entity)) continue;
      const itemID = toInt(entity.itemID, 0);
      if (seen.has(itemID)) continue;
      seen.add(itemID);
      out.push(entity);
    }
  }
  return out;
}

function createSentrySpawner({
  listInstances = null,
  getTemplate = null,
  listProfiles = null,
  spawn = null,
  observe = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof listInstances !== "function") throw Error("SENTRY_SPAWNER_NEEDS_INSTANCES");
  if (typeof getTemplate !== "function") throw Error("SENTRY_SPAWNER_NEEDS_TEMPLATES");
  if (typeof listProfiles !== "function") throw Error("SENTRY_SPAWNER_NEEDS_PROFILES");
  if (typeof spawn !== "function") throw Error("SENTRY_SPAWNER_NEEDS_SPAWN");

  // battery itemID -> {entityID, atMs}: one sentry per battery, for the life of the battery.
  const handled = new Map();
  let profilesByName = null;

  function profileIndex() {
    if (profilesByName) return profilesByName;
    const list = listProfiles();
    const rows = Array.isArray(list) ? list : (list && list.profiles) || [];
    profilesByName = new Map();
    for (const row of rows) {
      const name = String((row && row.name) || "").trim().toLowerCase();
      const profileID = String((row && row.profileID) || "").trim();
      if (!name || !profileID) continue;
      if (!profilesByName.has(name)) profilesByName.set(name, profileID);
    }
    return profilesByName;
  }

  function sentryProfileID({ structureName, spawnQuery }) {
    const typeName = sentries.pickFiringTypeName({ structureName, spawnQuery });
    if (!typeName) return { status: "NO_SENTRY_TYPE", reason: "NOT_A_BATTERY_OR_NO_SENTRY_GUN_FACTION" };
    const profileID = profileIndex().get(typeName.toLowerCase()) || "";
    if (!profileID) return { status: "NO_SENTRY_PROFILE", reason: `NO_PROFILE_FOR_${typeName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` };
    return { status: "READY", profileID, typeName };
  }

  function tick({ systemID, scene, instances = [] } = {}) {
    const out = { status: "NO_BATTERIES", systemID: toInt(systemID, 0), batteries: 0, spawned: [], skipped: [] };
    if (!(out.systemID > 0) || !scene) return { ...out, status: "INVALID_SCENE" };
    const playerPresent = Boolean(scene.sessions && typeof scene.sessions.size === "number" && scene.sessions.size > 0);
    if (!playerPresent) return { ...out, status: "NO_PLAYER_IN_SCENE" };
    const batteries = sceneBatteries(scene);
    out.batteries = batteries.length;
    if (!batteries.length) return out;
    const active = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
      const instanceID = toInt(instance && instance.instanceID, 0);
      if (!(instanceID > 0)) continue;
      if (String((instance && instance.lifecycleState) || "").toLowerCase() !== "active") continue;
      active.set(instanceID, instance);
    }
    if (!active.size) return { ...out, status: "NO_ACTIVE_INSTANCE" };
    out.status = "BATTERIES_PRESENT";
    const live = new Set(batteries.map((battery) => toInt(battery.itemID, 0)));
    for (const key of [...handled.keys()]) {
      if (!live.has(toInt(String(key).split(":")[1], 0))) handled.delete(key);
    }
    for (const battery of batteries) {
      const itemID = toInt(battery.itemID, 0);
      const instanceID = toInt(battery.dungeonSiteInstanceID, 0);
      const key = `${instanceID}:${itemID}`;
      const instance = active.get(instanceID);
      if (!instance) {
        out.skipped.push({ batteryItemID: itemID, reason: "INSTANCE_NOT_ACTIVE" });
        continue;
      }
      if (handled.has(key)) continue;
      const template = getTemplate(instance.templateID) || null;
      const structureName = String(battery.itemName || battery.slimName || "");
      const resolved = sentryProfileID({
        structureName,
        // The structure label itself names the faction on most real sites
        // ("Sansha Defense Battery"), so it is a first-class hint, not a fallback.
        spawnQuery: [siteSpawnQuery(template), structureName].join(" "),
      });
      if (resolved.status !== "READY") {
        handled.set(key, null);
        out.skipped.push({ batteryItemID: itemID, reason: resolved.reason });
        continue;
      }
      const position = clonePosition(battery.position);
      let result = null;
      try {
        result = spawn(out.systemID, {
          profileQuery: resolved.profileID,
          amount: 1,
          transient: true,
          position,
          spawnStateOverride: { position },
          runtimeKind: "nativeCombat",
          anchorName: String(battery.itemName || "Site Sentry"),
          ownerIDOverride: toInt(battery.ownerID, 0) > 0 ? toInt(battery.ownerID, 0) : undefined,
          spawnSiteID: String(toInt(battery.dungeonSiteID, 0) || ""),
        });
      } catch (error) {
        result = { success: false, errorMsg: error && error.message };
      }
      const spawned = result && result.success && result.data && Array.isArray(result.data.spawned)
        ? result.data.spawned[0] || null
        : null;
      const entityID = spawned ? toInt(spawned.entityID || (spawned.entity && spawned.entity.itemID), 0) : 0;
      if (!(entityID > 0)) {
        handled.set(key, null);
        out.skipped.push({
          batteryItemID: itemID,
          reason: String((result && result.errorMsg) || "NATIVE_SENTRY_SPAWN_FAILED"),
        });
        continue;
      }
      handled.set(key, { entityID, atMs: clock(), systemID: out.systemID });
      out.spawned.push({
        batteryItemID: itemID,
        instanceID,
        profileID: resolved.profileID,
        typeName: resolved.typeName,
        entityID,
      });
    }
    if (out.spawned.length) out.status = "SENTRIES_SPAWNED";
    if (out.spawned.length && typeof observe === "function") {
      try {
        for (const entry of out.spawned) {
          observe("coop-site-sentry-spawned", { systemID: out.systemID }, null, {
            ...entry,
            evidence: "NATIVE_SENTRY_PROFILE_SPAWNED_NOT_DAMAGE_PROOF",
          });
        }
      } catch (_error) { /* observation must never break the spawn */ }
    }
    return out;
  }

  return {
    reset() { handled.clear(); profilesByName = null; },
    snapshot() { return [...handled.entries()].map(([key, value]) => ({ key, ...(value || {}) })); },
    tick,
  };
}

module.exports = { BATTERY_NAME, createSentrySpawner, isBatteryEntity, sceneBatteries, siteSpawnQuery };
