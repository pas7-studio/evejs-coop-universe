#!/usr/bin/env node
// Leftovers in the live world data, reported honestly before anything is touched.
//
// Two kinds of junk accumulated during development and were found on 2026-11-02:
//   * durable hostile NPCs with no startup rule and no virtual pilot identity (dev spawns that never die),
//   * site instances that exist twice for the same physical siteKey (a client dungeon AND a universe-seeded copy),
//     which gives one anomaly two NPC populations and looks like a respawn after the first one is cleared.
//
// Report only by default. Nothing is deleted without an explicit flag, and every removal is printed.
// Run inside the server container:
//   docker cp scripts/coop-prune-leftovers.cjs evejs-server-1:/tmp/ && docker exec evejs-server-1 node /tmp/coop-prune-leftovers.cjs --system 30000142
"use strict";

const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const hasFlag = (name) => process.argv.includes(name);

const systemID = Number(argValue("--system", process.env.EVEJS_PRUNE_SYSTEM || 0)) || 0;
const applySites = hasFlag("--apply-sites");
const applyHostiles = hasFlag("--apply-hostiles");
const store = require("/app/server/src/space/npc/nativeNpcStore.js");
const dungeonState = require("/app/server/src/services/dungeon/dungeonRuntimeState.js");

function siteDuplicates(instances) {
  const byKey = new Map();
  for (const instance of instances) {
    const key = String(instance.siteKey || "");
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(instance);
  }
  const duplicates = [];
  for (const [siteKey, rows] of byKey.entries()) {
    if (rows.length < 2) continue;
    const clientRows = rows.filter((row) => String(row.siteOrigin || "") === "client_dungeon");
    const universeRows = rows.filter((row) => String(row.siteOrigin || "") !== "client_dungeon");
    // Only a real duplicate: the same physical site owned by two origins.
    if (clientRows.length > 0 && universeRows.length > 0) {
      duplicates.push({ siteKey, keep: clientRows.map((row) => row.instanceID), drop: universeRows.map((row) => row.instanceID) });
    }
  }
  return duplicates;
}

const snapshot = dungeonState.getStateSnapshot();
const allInstances = Object.values(snapshot.instancesByID || {});
const scoped = systemID > 0
  ? allInstances.filter((instance) => Number(instance.solarSystemID) === systemID)
  : allInstances;
const duplicates = siteDuplicates(scoped);

const controllers = systemID > 0
  ? store.listNativeControllersForSystem(systemID)
  : store.listNativeControllers();
const security = systemID > 0
  ? require("/app/server/src/space/coopHighSecNpcSafety.js").systemSecurityFor(systemID)
  : null;
const highSec = Number.isFinite(Number(security)) && Number(security) >= 0.45;
const orphanHostiles = controllers.filter((controller) => {
  const selection = String(controller.selectionID || "");
  const startupRule = String(controller.startupRuleID || "");
  return /hostile|pirate/i.test(selection) && startupRule === "";
});
// Only a gate/station camp may be purged, and only in high security: those are the leftovers of dev spawns in a
// system where CONCORD would never allow them. Site defenders (coordinates) are the anomaly's own population and
// are never touched here.
const purgeableHostiles = highSec
  ? orphanHostiles.filter((controller) => ["stargate", "station"].includes(String(controller.anchorKind || "")))
  : [];

// A hull that some virtual pilot identity owns is a world resident, not a leftover: never purge those.
function linkedEntityIDs() {
  const fs = require("fs");
  const path = "/var/lib/evejs/coop-npc-links.json";
  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    const links = raw && typeof raw === "object" ? (raw.links || raw) : {};
    return new Set(Object.values(links).map((link) => Number(link && link.entityID) || 0).filter(Boolean));
  } catch (_error) {
    return new Set();
  }
}
const linked = linkedEntityIDs();
const safePurge = purgeableHostiles.filter((controller) => !linked.has(Number(controller.entityID)));

const byAnchor = new Map();
for (const controller of orphanHostiles) {
  const key = `${controller.anchorKind || "none"}:${controller.anchorName || ""}`;
  byAnchor.set(key, (byAnchor.get(key) || 0) + 1);
}

console.log(JSON.stringify({
  systemID: systemID || "ALL",
  security,
  duplicateSiteKeys: duplicates.length,
  duplicates: duplicates.slice(0, 20),
  orphanHostiles: orphanHostiles.length,
  purgeableHighSecCamps: purgeableHostiles.length,
  linkedToVirtualPilots: purgeableHostiles.length - safePurge.length,
  orphanHostilesByAnchor: [...byAnchor.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10),
  applied: { sites: applySites, hostiles: applyHostiles },
}, null, 1));

if (applySites && duplicates.length > 0) {
  let removed = 0;
  for (const duplicate of duplicates) {
    for (const instanceID of duplicate.drop) {
      const result = dungeonState.removeInstance ? dungeonState.removeInstance(instanceID) : null;
      if (result && result.success !== false) {
        removed += 1;
        console.log(`REMOVED_INSTANCE ${instanceID} (kept ${duplicate.keep.join(",")})`);
      } else {
        console.log(`KEPT_INSTANCE ${instanceID} reason=${(result && result.reason) || "NO_REMOVE_API"}`);
      }
    }
  }
  console.log(`SITES_REMOVED ${removed}`);
}

// A hull that some virtual pilot identity owns is a world resident, not a leftover: never purge those.
if (applyHostiles && safePurge.length > 0) {
  let removed = 0;
  for (const controller of safePurge) {
    const entityID = Number(controller.entityID);
    if (!entityID) continue;
    try {
      store.removeNativeEntityCascade(entityID);
      removed += 1;
    } catch (error) {
      console.log(`KEPT_ENTITY ${entityID} reason=${String(error && error.message || error).slice(0, 80)}`);
    }
  }
  console.log(`HOSTILES_REMOVED ${removed}`);
} else if (applyHostiles) {
  console.log("HOSTILES_REMOVED 0 (nothing purgeable here: only high-sec gate/station camps are eligible)");
}
