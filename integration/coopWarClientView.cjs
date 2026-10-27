"use strict";
// Project the authoritative war state into the payloads the EVE client already
// renders. Nothing here invents an operation: only PREPARING/ASSAULT campaigns of
// an ACTIVE war appear, and only systems the war state really owns.
//
// Two native surfaces are fed:
//   * insurgencySolarsystem.GetAllVisibleCampaigns  -> the global-map campaign
//     layer (origin system + covered systems + FSM state), whose client snapshot
//     shape our war model was designed to mirror.
//   * fwWarzoneSolarsystem.GetAllWarzonesOccupationStates / GetLocalOccupationState
//     -> the faction-warfare front tab (owner/occupier per warzone system).
//
// Source .cjs modules become .js siblings in the deployed EveJS overlay.
const siblingSuffix = typeof __filename === "string" && __filename.endsWith(".js") ? "" : ".cjs";
const core = require("./coopFactionWarCore" + siblingSuffix);

const CAMPAIGN_STATE_ACTIVE = 3;
const LIVE_CAMPAIGN_STATES = new Set(["PREPARING", "ASSAULT"]);
const DEFAULT_WARZONE_ID = 2;          // Caldari/Gallente space, where the coop world lives
const DEFAULT_EXPIRY_MS = 6 * 3600000;

const num = (value) => Number(value) || 0;
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

// The client snapshot carries a numeric campaign id, so a stable hash is used
// instead of a random number: the same campaign always maps to the same id.
function numericID(text) {
  const value = String(text || "");
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 2000000000) + 1;
}

// The client expects a Windows FILETIME (100ns ticks since 1601).
function filetime(ms) {
  const ticks = BigInt(Math.trunc(num(ms))) * 10000n + 116444736000000000n;
  return String(ticks);
}

function liveCampaigns(state) {
  if (!state || !state.campaigns || !state.wars) return [];
  return Object.values(state.campaigns)
    .filter((campaign) => campaign && LIVE_CAMPAIGN_STATES.has(campaign.state))
    .filter((campaign) => {
      const war = state.wars[campaign.warID];
      return Boolean(war) && war.state === "ACTIVE";
    })
    .sort((a, b) => String(a.campaignID).localeCompare(String(b.campaignID)));
}

// The campaign's real objective. The adjudicator binds a native structure to an
// assault and records it as objectiveEvidence[].objectiveID = "structure:<id>"
// only after native verification, so the latest such entry is the live target.
// No objective yet means 0, exactly like stock (the client renders no structure).
function objectiveStructureID(campaign) {
  const evidence = Array.isArray(campaign && campaign.objectiveEvidence)
    ? campaign.objectiveEvidence
    : [];
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const raw = String((evidence[index] && evidence[index].objectiveID) || "");
    if (!raw.startsWith("structure:")) continue;
    const structureID = Number(raw.slice("structure:".length));
    if (Number.isSafeInteger(structureID) && structureID > 0) return structureID;
  }
  return 0;
}

// One client campaign snapshot per live campaign. `coveredSolarsystemIDs` is the
// real border pair the campaign fights over, never the whole map.
function campaignSnapshots(state, { nowMs = Date.now(), warzoneID = DEFAULT_WARZONE_ID } = {}) {
  const expiry = num(nowMs) > 0 ? num(nowMs) : Date.now();
  return liveCampaigns(state).map((campaign) => {
    const war = state.wars[campaign.warID];
    return {
      campaignID: numericID(campaign.campaignID),
      fsmState: CAMPAIGN_STATE_ACTIVE,
      stateExpiryTimestamp: filetime(expiry + DEFAULT_EXPIRY_MS),
      warzoneID: num(warzoneID) || DEFAULT_WARZONE_ID,
      originSolarsystemID: num(campaign.targetSystemID),
      coveredSolarsystemIDs: [num(campaign.sourceSystemID), num(campaign.targetSystemID)]
        .filter(pos),
      structureID: objectiveStructureID(campaign),
      piratePointsRequired: 20,
      antipiratePointsRequired: 5,
      piratePointsScored: 0,
      antipiratePointsScored: 0,
      pirateFactionID: num(war.attackerFactionID),
    };
  });
}

// Front tab: military control per system, plus who is contesting it. A system is
// only listed when the war state really assigns or contests it.
function occupationStates(state) {
  const territories = (state && state.territories) || {};
  const campaigns = liveCampaigns(state);
  const contestedBy = new Map();
  for (const campaign of campaigns) {
    const war = state.wars[campaign.warID];
    contestedBy.set(num(campaign.targetSystemID), num(war.attackerFactionID));
  }
  const bySystem = {};
  for (const [key, record] of Object.entries(territories)) {
    const systemID = num(key);
    const ownerID = num(record && record.militaryControllerFactionID);
    if (!pos(systemID) || !pos(ownerID)) continue;
    bySystem[systemID] = {
      ownerID,
      occupierID: contestedBy.get(systemID) || ownerID,
      contested: contestedBy.has(systemID) || (record && record.state === "CONTESTED") === true,
      militaryState: String((record && record.state) || "SECURE"),
    };
  }
  return bySystem;
}

// Chat report from the front. Text is built only from real state, so a report can
// never claim an action that did not happen.
function frontReport(kind, details = {}) {
  const name = (id) => (pos(id) ? "#" + Number(id) : "unknown");
  if (kind === "war-opened") {
    return "[Front] " + name(details.attackerFactionID) + " opened a front against " +
      name(details.defenderFactionID) + " in system " + name(details.targetSystemID) + ".";
  }
  if (kind === "assault-begun") {
    return "[Front] Assault begun in system " + name(details.targetSystemID) +
      ": " + num(details.attackerShips) + " attacking ships against " +
      num(details.defenderShips) + " defenders.";
  }
  if (kind === "objective-captured") {
    return "[Front] System " + name(details.systemID) + " captured by " +
      name(details.factionID) + ".";
  }
  if (kind === "campaign-lost") {
    return "[Front] Campaign in system " + name(details.systemID) + " lost.";
  }
  // FW-039: fleet attrition is reported where the player reads it - one line per
  // real loss and per real replacement, never per tick.
  if (kind === "fleet-loss") {
    return "[Front] " + name(details.factionID) + " lost a " + String(details.role || "hull") +
      " in system " + name(details.systemID) + " (" + num(details.remaining) +
      " left in the fleet, " + num(details.lost) + " lost so far).";
  }
  if (kind === "fleet-replacement") {
    return "[Front] " + name(details.factionID) + " recommitted " + num(details.adopted) +
      " hull(s) in system " + name(details.systemID) + " - fleet back to " +
      num(details.size) + " (" + String(details.status || "RECONSTITUTED") + ").";
  }
  return null;
}

// The authoritative war record, read through the same SQLite keyspace the war
// store writes. A missing record means there is no war to show.
function warState() {
  const gameStore = require("../gameStore");
  const { TABLE, KEY } = require("./coopFactionWarStore" + siblingSuffix);
  const rows = gameStore.coopAtomicNativeRows;
  if (!rows || typeof rows.transact !== "function") return null;
  const value = rows.transact([TABLE], (tx) => tx.get(TABLE, KEY));
  if (value == null) return null;
  core.validateState(value);
  return value;
}

// Never throws into a native service handler: a broken record simply means the
// client shows no coop campaign instead of a failed map request.
function liveCampaignSnapshots(options = {}) {
  try {
    return campaignSnapshots(warState(), options);
  } catch (_error) {
    return [];
  }
}

module.exports = {
  CAMPAIGN_STATE_ACTIVE, DEFAULT_WARZONE_ID, DEFAULT_EXPIRY_MS,
  numericID, filetime, liveCampaigns, campaignSnapshots, occupationStates, frontReport,
  objectiveStructureID,
  warState, liveCampaignSnapshots,
};
