"use strict";
// Read-only audit of the durable mining fleet's real hulls.
//
// The store is the truth: an actor's role is its operatorKind marker, and its hull
// is the profile the spawner actually used. A "hauler" that spawned as a mining
// hull has no ore hold worth the name (measured: three slots with a 50 m3 Mining
// Venture), and the strict transfer then refuses every stack. This prints one line
// per actor and a verdict per slot, and it never writes anything.
//
//   node scripts/coop-fleet-audit.cjs --db <path to gamestore.sqlite>
//   docker exec evejs-server-1 node /tmp/coop-fleet-audit.cjs --db /var/lib/evejs/gameStore/gamestore.sqlite
const fs = require("node:fs");

const HAULER_PROFILE = /_hauler$/;
const MINING_PROFILE = /^ore_mining_/;

function readActors(db) {
  const rows = db.prepare('SELECT key,json FROM "npcEntities"').all();
  const actors = [];
  for (const row of rows) {
    if (!String(row.json).includes("coop-mining-")) continue;
    let value;
    try { value = JSON.parse(row.json); } catch (_error) { continue; }
    const marker = String(value.operatorKind || "");
    const match = /^coop-mining-(\d+)-(\d+)-(miner|hauler)$/.exec(marker);
    if (!match) continue;
    actors.push({
      entityID: Number(value.entityID) || 0,
      systemID: Number(match[1]),
      slot: Number(match[2]),
      role: match[3],
      typeID: Number(value.typeID) || 0,
      itemName: String(value.itemName || ""),
      profileID: String(value.profileID || ""),
    });
  }
  return actors;
}

function verdict(actors) {
  const slots = new Map();
  for (const actor of actors) {
    const key = actor.systemID + ":" + actor.slot;
    if (!slots.has(key)) slots.set(key, {systemID: actor.systemID, slot: actor.slot, miners: [], haulers: [], problems: []});
    const slot = slots.get(key);
    if (actor.role === "hauler") slot.haulers.push(actor);
    else slot.miners.push(actor);
  }
  for (const slot of slots.values()) {
    if (slot.haulers.length === 0) slot.problems.push("NO_HAULER");
    for (const hauler of slot.haulers) {
      if (MINING_PROFILE.test(hauler.profileID) && !HAULER_PROFILE.test(hauler.profileID)) {
        slot.problems.push("HAULER_IS_A_MINING_HULL:" + hauler.profileID);
      }
      if (!MINING_PROFILE.test(hauler.profileID)) {
        slot.problems.push("HAULER_PROFILE_UNKNOWN:" + (hauler.profileID || "none"));
      }
    }
    for (const miner of slot.miners) {
      if (HAULER_PROFILE.test(miner.profileID)) slot.problems.push("MINER_IS_A_HAULER:" + miner.profileID);
    }
    const haulers = slot.haulers.filter((hauler) => HAULER_PROFILE.test(hauler.profileID));
    slot.status = slot.problems.length === 0 && haulers.length > 0 ? "OK" : "RECOMPOSE";
  }
  return [...slots.values()].sort((a, b) => a.systemID - b.systemID || a.slot - b.slot);
}

function format(slots) {
  const lines = [];
  for (const slot of slots) {
    lines.push(
      "slot " + slot.systemID + ":" + slot.slot + " " + slot.status +
      " miners=[" + slot.miners.map((actor) => actor.itemName + "/" + actor.entityID).join(", ") + "]" +
      " haulers=[" + slot.haulers.map((actor) => actor.itemName + "/" + actor.entityID + "/" + actor.profileID).join(", ") + "]" +
      (slot.problems.length ? " problems=" + slot.problems.join(",") : ""),
    );
  }
  const bad = slots.filter((slot) => slot.status !== "OK").length;
  lines.push(bad === 0 ? "FLEET_COMPOSITION_OK slots=" + slots.length : "FLEET_RECOMPOSE_NEEDED slots=" + slots.length + " bad=" + bad);
  return lines.join("\n");
}

module.exports = {readActors, verdict, format, MINING_PROFILE, HAULER_PROFILE};

if (require.main === module) {
  const at = process.argv.indexOf("--db");
  const file = at >= 0 ? process.argv[at + 1] : null;
  if (!file || !fs.existsSync(file)) {
    console.log("USAGE: node scripts/coop-fleet-audit.cjs --db <gamestore.sqlite>");
    process.exit(2);
  }
  const {DatabaseSync} = require("node:sqlite");
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const slots = verdict(readActors(db));
    console.log(slots.length ? format(slots) : "NO_DURABLE_MINING_FLEET (no coop-mining actors in npcEntities)");
  } finally {
    db.close();
  }
}
