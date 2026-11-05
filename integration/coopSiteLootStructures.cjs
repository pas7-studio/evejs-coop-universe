"use strict";
// A site warehouse that actually holds something.
//
// MEASURED 2026-11-05 (owner report, "Serpentis Warehouse is always empty"):
//   * "Serpentis Warehouse" / "Guristas Warehouse" / "Sleeper Warehouse" in a combat site are
//     NOT containers. They are `structureProfiles` with role "ambient" (built from
//     populationHints.environmentProps) and are materialised as `siteKillableStructure`
//     scenery: position, hit points, nothing else.
//   * No inventory row exists for them at all (`item rows named warehouse: 0`), so the
//     client's "open cargo" call is answered with an empty list - there is literally nothing
//     to loot, in every site and for every faction.
//   * The site templates DO carry the loot data: populationHints.lootProfiles with
//     `pirate_combat_loot` and `combat_overseer_loot` (tags faction_module, faction_ammo,
//     pirate_tag, drone_component, overseer_effect). The site service already turns that
//     into real items for data/relic containers (buildLootGrantEntriesForContainer).
//
// So the missing link is small and local: give a lootable structure real item rows, inside
// the structure's own itemID, generated from the site's own loot profile by the site
// service's own generator. No new object appears in space (the warehouse the client already
// draws is the same one), no loot is invented (the generator only emits types named by the
// profile's tags and resolved in the SDE), and nothing is filled twice: an existing content
// list wins over seeding.
const LOOTABLE_NAME = /warehouse|depot|cache|vault|storage|hangar/i;
// Mirrors services/dungeon/dungeonUniverseSiteService SITE_CONTENT_OWNER_ID: site content is
// owned by the world, not by the pilot who happens to be nearby.
const SITE_CONTENT_OWNER_ID = 1;
const CARGO_HOLD_FLAG = 5;
// A structure is seeded once; the map only prevents pointless work inside one process.
const MAX_SEEDED = 4096;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function isLootableStructure(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (entity.dungeonMaterializedKillableStructure !== true) return false;
  if (!LOOTABLE_NAME.test(String(entity.itemName || entity.slimName || ""))) return false;
  if (!(toInt(entity.itemID, 0) > 0)) return false;
  if (!(toInt(entity.dungeonSiteInstanceID, 0) > 0)) return false;
  return Boolean(entity.position && typeof entity.position === "object");
}

// The site's own loot profile wins; the overseer profile is the fallback for a site that
// only declares that one. A template with no profiles at all is left alone.
function pickLootProfile(populationHints) {
  const profiles = Array.isArray(populationHints && populationHints.lootProfiles)
    ? populationHints.lootProfiles.filter((profile) => profile && profile.key)
    : [];
  if (!profiles.length) return null;
  const preferred = profiles.find((profile) => profile.key === "pirate_combat_loot")
    || profiles.find((profile) => profile.key === "combat_overseer_loot")
    || profiles[0];
  return preferred;
}

function structureBatteries(scene) {
  const out = [];
  const seen = new Set();
  for (const container of [scene && scene.staticEntitiesByID, scene && scene.dynamicEntities]) {
    if (!(container instanceof Map)) continue;
    for (const entity of container.values()) {
      if (!isLootableStructure(entity)) continue;
      const itemID = toInt(entity.itemID, 0);
      if (seen.has(itemID)) continue;
      seen.add(itemID);
      out.push(entity);
    }
  }
  return out;
}

function createLootStructureFiller({
  listInstances = null,
  getTemplate = null,
  resolvePopulationHints = null,
  buildLootEntries = null,
  listContents = null,
  grantItems = null,
  observe = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof listInstances !== "function") throw Error("LOOT_STRUCTURES_NEED_INSTANCES");
  if (typeof getTemplate !== "function") throw Error("LOOT_STRUCTURES_NEED_TEMPLATES");
  if (typeof resolvePopulationHints !== "function") throw Error("LOOT_STRUCTURES_NEED_POPULATION_HINTS");
  if (typeof buildLootEntries !== "function") throw Error("LOOT_STRUCTURES_NEED_LOOT_GENERATOR");
  if (typeof listContents !== "function") throw Error("LOOT_STRUCTURES_NEED_CONTENTS");
  if (typeof grantItems !== "function") throw Error("LOOT_STRUCTURES_NEED_ITEM_STORE");

  const seeded = new Map();

  function tick({ systemID, scene, instances = [] } = {}) {
    const out = { status: "NO_LOOTABLE_STRUCTURES", systemID: toInt(systemID, 0), structures: 0, filled: [], skipped: [] };
    if (!(out.systemID > 0) || !scene) return { ...out, status: "INVALID_SCENE" };
    if (!(scene.sessions && scene.sessions.size > 0)) return { ...out, status: "NO_PLAYER_IN_SCENE" };
    const structures = structureBatteries(scene);
    out.structures = structures.length;
    if (!structures.length) return out;
    const active = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
      const instanceID = toInt(instance && instance.instanceID, 0);
      if (!(instanceID > 0)) continue;
      if (String((instance && instance.lifecycleState) || "").toLowerCase() !== "active") continue;
      active.set(instanceID, instance);
    }
    if (!active.size) return { ...out, status: "NO_ACTIVE_INSTANCE" };
    out.status = "STRUCTURES_PRESENT";
    const now = Math.max(0, toInt(clock(), Date.now()));
    for (const entity of structures) {
      const itemID = toInt(entity.itemID, 0);
      const instanceID = toInt(entity.dungeonSiteInstanceID, 0);
      const key = `${instanceID}:${itemID}`;
      if (seeded.has(key)) continue;
      const instance = active.get(instanceID);
      if (!instance) {
        out.skipped.push({ itemID, reason: "INSTANCE_NOT_ACTIVE" });
        continue;
      }
      let contents = [];
      try {
        contents = listContents(null, itemID, null) || [];
      } catch (_error) {
        out.skipped.push({ itemID, reason: "CONTENTS_UNREADABLE" });
        continue;
      }
      if (contents.length > 0) {
        // Already holds something - either a previous seed or real loot. Never double it.
        seeded.set(key, { reason: "ALREADY_LOOTED" });
        continue;
      }
      const template = getTemplate(instance.templateID) || null;
      const populationHints = resolvePopulationHints(instance, template) || null;
      const profile = pickLootProfile(populationHints);
      if (!profile) {
        seeded.set(key, { reason: "NO_LOOT_PROFILE" });
        out.skipped.push({ itemID, reason: "NO_LOOT_PROFILE" });
        continue;
      }
      let entries = [];
      try {
        entries = buildLootEntries({
          dungeonSiteContentKey: `loot_structure:${instanceID}:${itemID}`,
          dungeonSiteContentLootProfile: profile.key,
          dungeonSiteContentLootTags: Array.isArray(profile.tags) ? profile.tags : [],
          itemName: String(entity.itemName || "Warehouse"),
        }, populationHints, { instance, siteEntity: scene.getEntityByID ? scene.getEntityByID(instance.metadata && instance.metadata.siteID) : null, template }) || [];
      } catch (error) {
        entries = [];
      }
      if (!entries.length) {
        seeded.set(key, { reason: "NO_LOOT_ENTRIES" });
        out.skipped.push({ itemID, reason: "NO_LOOT_ENTRIES" });
        continue;
      }
      let result = null;
      try {
        result = grantItems(SITE_CONTENT_OWNER_ID, itemID, CARGO_HOLD_FLAG, entries);
      } catch (error) {
        result = { success: false, errorMsg: error && error.message };
      }
      if (!result || result.success === false) {
        // A refused grant is recorded once, exactly like a successful seeding: a structure
        // that cannot be filled must not be retried on every tick.
        seeded.set(key, { reason: String((result && result.errorMsg) || "LOOT_GRANT_FAILED") });
        out.skipped.push({ itemID, reason: String((result && result.errorMsg) || "LOOT_GRANT_FAILED") });
        continue;
      }
      const granted = Array.isArray(result.data && result.data.items) ? result.data.items.length : entries.length;
      seeded.set(key, { itemID, profile: profile.key, items: granted, atMs: now });
      if (seeded.size > MAX_SEEDED) seeded.delete(seeded.keys().next().value);
      out.filled.push({
        itemID,
        instanceID,
        name: String(entity.itemName || ""),
        profile: profile.key,
        items: granted,
        itemIDs: (result.data && Array.isArray(result.data.items) ? result.data.items : [])
          .map((row) => toInt(row && row.itemID, 0)).filter((id) => id > 0).slice(0, 8),
      });
    }
    if (out.filled.length) out.status = "STRUCTURES_FILLED";
    if (out.filled.length && typeof observe === "function") {
      try {
        for (const entry of out.filled) {
          observe("coop-site-loot-structure-filled", { systemID: out.systemID }, null, {
            ...entry,
            evidence: "SITE_LOOT_PROFILE_GRANTED_INTO_STRUCTURE_ITEM",
          });
        }
      } catch (_error) { /* observation must never break the fill */ }
    }
    return out;
  }

  return {
    reset() { seeded.clear(); },
    snapshot() { return [...seeded.entries()].map(([key, value]) => ({ key, ...(value || {}) })); },
    tick,
  };
}

module.exports = {
  CARGO_HOLD_FLAG,
  LOOTABLE_NAME,
  SITE_CONTENT_OWNER_ID,
  createLootStructureFiller,
  isLootableStructure,
  pickLootProfile,
  structureBatteries,
};
