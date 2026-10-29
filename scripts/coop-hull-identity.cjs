#!/usr/bin/env node
/**
 * Re-establish the durable identity link of a hull that provably exists.
 *
 * Why this exists: the identity registry prunes any link whose ship is not physically in the
 * linked system. Measured 2026-10-30, the hull that had really crossed to Jita (journal:
 * SAME_NATIVE_SHIP_ARRIVED, store moved to 30000142) lost its links, so the next crossing was
 * refused SOURCE_IDENTITY_MISMATCH for ever - the world no longer knew who the ship was.
 *
 * This is bookkeeping about a ship that already exists, and nothing else:
 *   - it never moves a ship and never claims a crossing or a sale;
 *   - the durable store record is the proof of where the hull is (the live scene is rebuilt
 *     from that store, so it is the authority that survives a restart);
 *   - it refuses when another pilot already owns that hull in a different system.
 *
 * Usage (inside the server container):
 *   node _hull-identity.cjs --entity 980000004164 --pilot coop-pilot-002 --dry-run
 *   node _hull-identity.cjs --entity 980000004164 --pilot coop-pilot-002 --confirm
 */
const path = require("path");
const S = process.env.EVEJS_COOP_SERVER_SRC || "/app/server/src";
const store = require(path.join(S, "space/npc/nativeNpcStore"));
const { createRegistry } = require(path.join(S, "space/coopIdentityRegistry"));

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes("--" + name);

const entityID = Number(arg("entity", 0));
let pilotID = String(arg("pilot", "")).trim();
if (!Number.isSafeInteger(entityID) || entityID <= 0) {
  console.error("USAGE: --entity <id> --pilot coop-pilot-NNN|auto [--dry-run|--confirm]");
  process.exit(2);
}
if (pilotID !== "auto" && !/^coop-pilot-[0-9]{3,}$/.test(pilotID)) {
  console.error("USAGE: --entity <id> --pilot coop-pilot-NNN|auto [--dry-run|--confirm]");
  process.exit(2);
}

const entity = store.getNativeEntity(entityID);
if (!entity || entity.transient === true) {
  console.error("REFUSED_NOT_DURABLE: no durable record for " + entityID);
  process.exit(3);
}
const systemID = Number(entity.systemID) || 0;
if (!systemID) {
  console.error("REFUSED_NO_SYSTEM: the durable record does not say where the hull is");
  process.exit(3);
}

const registry = createRegistry({
  file: process.env.EVEJS_COOP_IDENTITY_FILE || "/var/lib/evejs/coop-npc-links.json",
  exists: (system, id) => {
    // Durable truth: the store says this hull lives in this system and is not transient.
    try {
      const row = store.getNativeEntity(id);
      return Boolean(row && row.transient !== true && Number(row.systemID) === Number(system));
    } catch (_error) { return false; }
  },
});
const links = (registry.snapshot() || {}).links || {};
// A free identity is a real one: never invent a name that is already flying something.
if (pilotID === "auto") {
  for (let n = 1; n <= 9999; n += 1) {
    const candidate = "coop-pilot-" + String(n).padStart(3, "0");
    if (!links[candidate]) { pilotID = candidate; break; }
  }
  if (pilotID === "auto") {
    console.error("REFUSED_NO_FREE_PILOT");
    process.exit(5);
  }
}
const conflicts = Object.entries(links)
  .filter(([, row]) => Number(row && row.entityID) === entityID)
  .map(([id, row]) => ({ pilotID: id, systemID: Number(row.systemID) }));
const otherSystem = conflicts.filter((row) => row.systemID !== systemID);

const report = { entityID, systemID, pilotID, existing: conflicts, conflict: otherSystem.length > 0 };
if (otherSystem.length) {
  console.log("REFUSED_IDENTITY_CONFLICT " + JSON.stringify(report));
  process.exit(5);
}
if (flag("dry-run") || !flag("confirm")) {
  console.log("DRY_RUN " + JSON.stringify(report));
  if (!flag("dry-run")) console.log("NOTHING_CHANGED: pass --confirm to write");
  process.exit(0);
}

const already = links[pilotID];
if (already && Number(already.entityID) === entityID && Number(already.systemID) === systemID) {
  console.log("ALREADY_LINKED " + JSON.stringify(report));
  process.exit(0);
}
if (already && Number(already.entityID) !== entityID) {
  console.log("REFUSED_PILOT_BUSY " + JSON.stringify({ ...report, boundTo: Number(already.entityID) }));
  process.exit(5);
}
const linked = registry.link({ id: pilotID, name: pilotID, faction: "independent", role: "hauler",
  durable: false }, systemID, entityID);
console.log("LINKED " + JSON.stringify({ ...report, link: linked }));
