"use strict";
// FW-143: ONE answer to "is this pilot really in a militia?".
//
// MEASURED 2026-11-05 (owner: "the war ended and a new one started, why am I not in my faction
// again, and I cannot re-enlist"): the character record keeps `warFactionID` and the session
// copies it, so a pilot who LEFT the militia keeps reading `session.warfactionid = <faction>`.
// The client treats that field as "I am enlisted" (factionwarfare/client/enlistmentChecks.py
// CurrentlyInSameFaction), so it never offers the enlist flow again, while the world's own
// enlistment row says LEFT. The truth is the enlistment record, and this module is the only
// place that reads it for session/UI purposes.
const fs = require("node:fs");
const path = require("node:path");
const sibling = (name) => require(path.join(__dirname, name + (fs.existsSync(path.join(__dirname, name + ".js")) ? ".js" : ".cjs")));

const TABLE = "corporationRuntime";
const KEY = "coop-faction-war\u001fstate-v1";
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function readEnlistment(characterID, gameStore) {
  const id = pos(characterID);
  if (!id) return null;
  const store = gameStore || require("../gameStore");
  try {
    const result = store.read(TABLE, "/");
    const table = result && result.success ? result.data : null;
    const node = table && table["coop-faction-war"];
    const state = node && typeof node === "object"
      ? (node["state-v1"] && typeof node["state-v1"] === "object" ? node["state-v1"] : node)
      : null;
    const row = state && state.enlistments ? state.enlistments[String(id)] : null;
    if (!row || typeof row !== "object") return null;
    return {
      characterID: id,
      factionID: pos(row.factionID),
      status: String(row.status || ""),
      rank: Number(row.rank) || 0,
      enlistedAt: Number(row.enlistedAt) || 0,
      cooldownUntil: Number(row.cooldownUntil) || 0,
      leftAt: Number(row.leftAt) || 0,
    };
  } catch (_error) {
    return null;
  }
}

// The faction a session should advertise: the ACTIVE enlistment, otherwise none.
function militiaFactionFor(characterID, gameStore) {
  const row = readEnlistment(characterID, gameStore);
  if (!row || row.status !== "ACTIVE") return 0;
  return row.factionID;
}

// 0 = never enlisted, 1 = ACTIVE, 2 = LEFT (with or without a cooldown).
function enlistmentStateFor(characterID, gameStore) {
  const row = readEnlistment(characterID, gameStore);
  if (!row) return 0;
  return row.status === "ACTIVE" ? 1 : 2;
}

module.exports = { KEY, TABLE, enlistmentStateFor, militiaFactionFor, readEnlistment };
