"use strict";
// Opening move of a war: turn a real front into a real war + campaign record.
//
// The mobiliser only reserves ships for a campaign that already exists in the war
// state (`wars[warID]` ACTIVE + `campaigns[campaignID]` PREPARING/ASSAULT with
// sourceSystemID and targetSystemID). This module builds exactly that shape from
// the derived fronts, so nothing has to be hand-written into the store.
const num = (value) => Number(value) || 0;
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function refuse(reason, extra) {
  return Object.assign({ status: "REFUSED", reason }, extra || {});
}

// The biggest front with a real, numeric faction pair on both sides. Ties are
// broken by the system ids so two ticks never flip the war back and forth.
function pickFront(fronts) {
  const usable = (Array.isArray(fronts) ? fronts : [])
    .filter((front) => front && Array.isArray(front.edges) && front.edges.length)
    .filter((front) => front.edges.some((edge) => pos(edge.fromSystemID) && pos(edge.toSystemID) &&
      pos(edge.fromOwner) && pos(edge.toOwner) && Number(edge.fromOwner) !== Number(edge.toOwner)))
    .sort((a, b) => b.edgeCount - a.edgeCount || String(a.frontID).localeCompare(String(b.frontID)));
  return usable[0] || null;
}

function planOpeningCampaign({ fronts, nowMs, warID, campaignID } = {}) {
  const front = pickFront(fronts);
  if (!front) return refuse("NO_FRONT_WITH_TWO_REAL_FACTIONS");
  const edge = front.edges
    .filter((candidate) => pos(candidate.fromSystemID) && pos(candidate.toSystemID) &&
      pos(candidate.fromOwner) && pos(candidate.toOwner) &&
      Number(candidate.fromOwner) !== Number(candidate.toOwner))
    .sort((a, b) => a.fromSystemID - b.fromSystemID || a.toSystemID - b.toSystemID)[0];
  if (!edge) return refuse("NO_REAL_EDGE");
  const at = num(nowMs) > 0 ? num(nowMs) : Date.now();
  const attackerFactionID = Number(edge.fromOwner);
  const defenderFactionID = Number(edge.toOwner);
  const war = {
    warID: String(warID || "war:" + attackerFactionID + "-" + defenderFactionID + ":" + at),
    state: "ACTIVE",
    attackerFactionID,
    defenderFactionID,
    startedAtMs: at,
    frontID: String(front.frontID || ""),
  };
  const campaign = {
    campaignID: String(campaignID || "campaign:" + war.warID + ":1"),
    warID: war.warID,
    state: "PREPARING",
    sourceSystemID: Number(edge.fromSystemID),
    targetSystemID: Number(edge.toSystemID),
    startedAt: at,
  };
  return { status: "PLANNED", war, campaign, frontID: front.frontID, edgeCount: front.edgeCount };
}

module.exports = { pickFront, planOpeningCampaign };
