"use strict";
// Opening wars from the real world.
//
// Owner model (2026-10-27): a war is global and multi-front. A front is the place
// where two factions' sectors actually touch, so one faction pair can fight on
// several borders at once. Nothing here invents a faction pair, a border or a
// fleet: the inputs are the real identity links (which native ship sits where),
// the real corporation -> faction table, the real reciprocal gate graph and the
// paper treasury. Every record is written by coopFactionWarCore.transition, so a
// war cannot exist without its native proofs.
//
// Source .cjs modules become .js siblings in the deployed EveJS overlay.
const siblingSuffix = typeof __filename === "string" && __filename.endsWith(".js") ? "" : ".cjs";
const { territoriesFromPresence, buildFronts } = require("./coopFactionWarFronts" + siblingSuffix);
const { planOpeningCampaign } = require("./coopFactionWarBootstrap" + siblingSuffix);
const core = require("./coopFactionWarCore" + siblingSuffix);
const paper = require("./coopFactionWarTreasury" + siblingSuffix);

const num = (value) => Number(value) || 0;
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const MAX_LINKS = 5000;
const LIVE_CAMPAIGN_STATES = new Set(["PREPARING", "ASSAULT"]);

const refuse = (reason, extra) => Object.assign({ status: "REFUSED", reason }, extra || {});

// A gate is a proof only when it is reciprocal: one-way and unresolved gates are
// not a route a fleet can cross.
function gateBetween(fromSystemID, toSystemID, getStargatesForSystem, getGate) {
  if (!pos(fromSystemID) || !pos(toSystemID) || fromSystemID === toSystemID) return null;
  if (typeof getStargatesForSystem !== "function") return null;
  for (const gate of getStargatesForSystem(fromSystemID) || []) {
    const gateID = num(gate && gate.itemID);
    const destinationGateID = num(gate && gate.destinationID);
    if (!pos(gateID) || !pos(destinationGateID)) continue;
    if (num(gate && gate.destinationSolarSystemID) !== toSystemID) continue;
    const back = typeof getGate === "function" ? getGate(destinationGateID) : null;
    if (typeof getGate === "function" &&
      (!back || num(back.destinationID) !== gateID || num(back.solarSystemID) !== toSystemID)) continue;
    return {
      fromGateID: gateID,
      toGateID: destinationGateID,
      fromSystemID,
      toSystemID,
      reciprocal: Boolean(back),
    };
  }
  return null;
}

// Which faction really sits in which system, from the identity links plus the
// real corporation -> faction table. A link whose native record disagrees about
// the system is in flight and owns nothing yet.
function collectPresence({ links, systemIDs, getNativeEntity, getFactionForCorporation, maxLinks = MAX_LINKS } = {}) {
  if (!Array.isArray(links) || links.length > maxLinks) return { status: "INVALID_LINKS", pilots: [], skipped: 0 };
  if (typeof getNativeEntity !== "function" || typeof getFactionForCorporation !== "function")
    return { status: "NATIVE_AUTHORITIES_REQUIRED", pilots: [], skipped: 0 };
  const allowed = Array.isArray(systemIDs) && systemIDs.length
    ? new Set(systemIDs.map(Number).filter(pos))
    : null;
  const pilots = [];
  let skipped = 0;
  for (const link of links) {
    const systemID = num(link && link.systemID);
    const entityID = num(link && link.entityID);
    if (!pos(systemID) || !pos(entityID) || (allowed && !allowed.has(systemID))) { skipped++; continue; }
    let native = null, faction = 0;
    try {
      native = getNativeEntity(entityID);
      if (native && pos(native.systemID) && num(native.systemID) !== systemID) { skipped++; continue; }
      faction = num(getFactionForCorporation(native && native.corporationID));
    } catch (_error) { skipped++; continue; }
    if (!pos(faction)) { skipped++; continue; }
    pilots.push({
      pilotID: link.pilotID,
      entityID,
      systemID,
      factionID: String(faction),
      corporationID: num(native && native.corporationID),
      role: String(link.role || ""),
    });
  }
  return { status: "PRESENCE", pilots, skipped };
}

// Registered military control is authoritative; live presence only fills the
// systems that no campaign has decided yet. A capture must not be undone by
// counting the ships that happen to be passing through.
function territoriesForFronts({ state, presence, minShips = 1 } = {}) {
  const observed = territoriesFromPresence({ pilots: presence && presence.pilots, minShips });
  const territories = Object.assign({}, observed);
  let registeredCount = 0;
  const registered = state && state.territories;
  if (registered && typeof registered === "object") {
    for (const [key, record] of Object.entries(registered)) {
      const systemID = num(key);
      const owner = num(record && record.militaryControllerFactionID);
      if (!pos(systemID) || !pos(owner)) continue;
      territories[String(systemID)] = String(owner);
      registeredCount++;
    }
  }
  return { territories, observedCount: Object.keys(observed).length, registeredCount };
}

// A faction pays for an operation from what it really holds. This is a PAPER
// budget by owner decision: no market order, no cargo, and the paper nature is
// part of the result so it can never be mistaken for a native settlement.
function paperFunding({ heldSystemIDs = [], balanceISK = 0, rates = {} } = {}) {
  const funding = paper.fundOperation({ balanceISK, heldSystemIDs, rates });
  return Object.assign({ heldSystemIDs: heldSystemIDs.length }, funding);
}

// Per-system faction counts, including the systems that are contested. A tie is
// the real reason a front cannot exist, so it has to be visible instead of
// looking like a broken feature.
function presenceSummary({ pilots = [], minShips = 1 } = {}) {
  const counts = new Map();
  for (const pilot of Array.isArray(pilots) ? pilots : []) {
    const systemID = num(pilot && pilot.systemID);
    const factionID = String((pilot && pilot.factionID) || "");
    if (!pos(systemID) || !factionID) continue;
    if (!counts.has(systemID)) counts.set(systemID, new Map());
    const per = counts.get(systemID);
    per.set(factionID, (per.get(factionID) || 0) + 1);
  }
  const threshold = Math.max(1, Math.trunc(num(minShips) || 1));
  const systems = {}, contested = [];
  for (const [systemID, per] of counts) {
    const ranked = [...per.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [topFaction, topShips] = ranked[0];
    const runnerUp = ranked[1] ? ranked[1][1] : 0;
    const entry = { factions: ranked.map(([factionID, ships]) => ({ factionID, ships })), owner: null, reason: "" };
    if (topShips < threshold) entry.reason = "BELOW_MIN_SHIPS";
    else if (topShips === runnerUp) entry.reason = "TIE_CONTESTED";
    else entry.owner = topFaction;
    systems[systemID] = entry;
    if (!entry.owner) contested.push(systemID);
  }
  return { systems, contested };
}

// One war per faction pair. Several campaigns may run under the same war on
// different borders - that is what "multi-front" means here.
function activeWarFor(state, leftFactionID, rightFactionID) {
  const low = Math.min(num(leftFactionID), num(rightFactionID));
  const high = Math.max(num(leftFactionID), num(rightFactionID));
  for (const war of Object.values((state && state.wars) || {})) {
    if (!war || war.state !== "ACTIVE") continue;
    const pair = [num(war.attackerFactionID), num(war.defenderFactionID)].sort((a, b) => a - b);
    if (pair[0] === low && pair[1] === high) return war;
  }
  return null;
}

function liveCampaignFor(state, targetSystemID) {
  return Object.values((state && state.campaigns) || {})
    .find((campaign) => campaign && num(campaign.targetSystemID) === num(targetSystemID) &&
      LIVE_CAMPAIGN_STATES.has(campaign.state)) || null;
}

function buildProofs({ plan, presence, territories, getStargatesForSystem, getGate, minShips, funding }) {
  const pilots = (presence && presence.pilots) || [];
  const countIn = (systemID, factionID) => pilots
    .filter((pilot) => pilot.systemID === Number(systemID) && pilot.factionID === String(factionID)).length;
  const sourceSystemID = plan.campaign.sourceSystemID;
  const targetSystemID = plan.campaign.targetSystemID;
  return {
    // Both sides must really be present on their own side of the border.
    declaration: ({ attackerFactionID, defenderFactionID }) =>
      countIn(sourceSystemID, attackerFactionID) >= minShips &&
      countIn(targetSystemID, defenderFactionID) >= minShips,
    // The system is owned by this faction in the map the front was derived from.
    territory: ({ systemID, ownerFactionID }) => territories[String(systemID)] === String(ownerFactionID),
    // A real reciprocal stargate connects the two systems.
    adjacency: ({ sourceSystemID: from, targetSystemID: to }) =>
      gateBetween(from, to, getStargatesForSystem, getGate) !== null,
    // Paper treasury can pay for the opening operation.
    supply: () => funding.status === "FUNDED" && funding.paper === true,
  };
}

// Turns the real inputs into one opening per open border, or refuses with the
// first missing fact. A border that already has a live campaign is not reopened.
function planWars({
  state, presence, getStargatesForSystem, getGate,
  nowMs, minShips = 1, balanceISK = 0, maxOpenings = 4,
} = {}) {
  if (!state || typeof state !== "object") return refuse("NO_WAR_STATE");
  const { territories, observedCount, registeredCount } =
    territoriesForFronts({ state, presence, minShips });
  const summary = presenceSummary({ pilots: presence && presence.pilots, minShips });
  if (!Object.keys(territories).length)
    return refuse("NO_TERRITORY_FROM_PRESENCE", { territories, observedCount, registeredCount, summary });
  if (typeof getStargatesForSystem !== "function") return refuse("NO_GATE_AUTHORITY", { territories });
  const fronts = buildFronts({ territories, getStargatesForSystem, getGate });
  if (!fronts.length)
    return refuse("NO_FRONT", { territories, observedCount, registeredCount, summary });
  const limit = Math.max(1, Math.min(8, Math.trunc(num(maxOpenings) || 1)));
  const openings = [], skipped = [];
  for (const front of fronts) {
    for (const edge of front.edges) {
      if (openings.length >= limit) break;
      const attackerFactionID = num(edge && edge.fromOwner);
      const defenderFactionID = num(edge && edge.toOwner);
      const sourceSystemID = num(edge && edge.fromSystemID);
      const targetSystemID = num(edge && edge.toSystemID);
      if (!pos(attackerFactionID) || !pos(defenderFactionID) || attackerFactionID === defenderFactionID) {
        skipped.push({ edge, reason: "NOT_TWO_REAL_FACTIONS" });
        continue;
      }
      if (!pos(sourceSystemID) || !pos(targetSystemID)) {
        skipped.push({ edge, reason: "INVALID_EDGE" });
        continue;
      }
      if (liveCampaignFor(state, targetSystemID)) {
        skipped.push({ edge, reason: "TARGET_ALREADY_CONTESTED" });
        continue;
      }
      const war = activeWarFor(state, attackerFactionID, defenderFactionID);
      const warID = war ? war.warID
        : "war:" + Math.min(attackerFactionID, defenderFactionID) + "-" +
          Math.max(attackerFactionID, defenderFactionID);
      const plan = planOpeningCampaign({
        fronts: [{ frontID: front.frontID, edgeCount: 1, edges: [edge] }],
        nowMs,
        warID,
        campaignID: warID + ":campaign:" + targetSystemID,
      });
      if (plan.status !== "PLANNED") { skipped.push({ edge, reason: plan.reason }); continue; }
      const held = Object.keys(territories)
        .filter((key) => territories[key] === String(plan.war.attackerFactionID));
      const funding = paperFunding({ heldSystemIDs: held, balanceISK });
      if (funding.status !== "FUNDED") {
        skipped.push({ edge, reason: "SUPPLY_UNFUNDED:" + funding.status });
        continue;
      }
      const proofs = buildProofs({
        plan, presence, territories, getStargatesForSystem, getGate, minShips, funding,
      });
      openings.push({ plan, proofs, funding, edge, existingWar: Boolean(war), frontID: front.frontID });
    }
  }
  if (!openings.length)
    return refuse("NO_OPENABLE_FRONT", { territories, fronts, skipped, observedCount, registeredCount, summary });
  return { status: "READY", openings, territories, fronts, skipped, summary, observedCount, registeredCount };
}

// Applies every planned opening through the authoritative core, reusing an
// already declared war for the same faction pair.
function applyOpenings({ state, plan, nowMs } = {}) {
  if (!plan || plan.status !== "READY") return refuse("PLAN_NOT_READY");
  const at = num(nowMs) > 0 ? num(nowMs) : Date.now();
  let current = state;
  const applied = [], warIDs = [], campaignIDs = [], fundings = [];
  const step = (command, proofs) => {
    const result = core.transition(current, command, { now: at, proofs });
    if (result.status !== "APPLIED" && result.status !== "DUPLICATE")
      throw Object.assign(Error("WAR_OPENING_BLOCKED:" + result.reason), { reason: result.reason });
    current = result.state || current;
    applied.push(Object.assign({ type: command.type }, result.receipt || {}));
  };
  try {
    for (const opening of plan.openings) {
      const { war, campaign } = opening.plan;
      const proofs = opening.proofs;
      if (!current.wars[war.warID]) {
        step({
          type: "DECLARE_WAR", eventID: "open:" + war.warID + ":declare", warID: war.warID,
          attackerFactionID: war.attackerFactionID, defenderFactionID: war.defenderFactionID,
        }, proofs);
      }
      for (const [systemID, ownerFactionID] of [
        [campaign.sourceSystemID, war.attackerFactionID],
        [campaign.targetSystemID, war.defenderFactionID],
      ]) {
        if (current.territories[String(systemID)]) continue;
        step({
          type: "REGISTER_TERRITORY", eventID: "open:" + war.warID + ":territory:" + systemID,
          systemID, ownerFactionID,
        }, proofs);
      }
      step({
        type: "START_CAMPAIGN", eventID: "open:" + campaign.campaignID + ":start",
        campaignID: campaign.campaignID, warID: war.warID,
        sourceSystemID: campaign.sourceSystemID, targetSystemID: campaign.targetSystemID,
        supplyReservationID: "paper-supply:" + campaign.campaignID,
      }, proofs);
      if (!warIDs.includes(war.warID)) warIDs.push(war.warID);
      campaignIDs.push(campaign.campaignID);
      fundings.push(opening.funding);
    }
    return { status: "OPENED", state: current, warIDs, campaignIDs, applied, fundings };
  } catch (error) {
    return refuse(error.reason || String((error && error.message) || error), { state: current, applied });
  }
}

// Single-opening convenience used by the assault tests and by callers that only
// care about the first front.
function applyOpening({ state, plan, nowMs } = {}) {
  if (!plan || plan.status !== "READY" || !Array.isArray(plan.openings) || plan.openings.length !== 1)
    return refuse("PLAN_NOT_READY");
  const result = applyOpenings({ state, plan, nowMs });
  if (result.status !== "OPENED") return result;
  return Object.assign({}, result, {
    warID: result.warIDs[0],
    campaignID: result.campaignIDs[0],
    funding: result.fundings[0],
  });
}

function createWarOpening({
  readLinks, getNativeEntity, getFactionForCorporation,
  getStargatesForSystem, getGate, readWarState, writeWarState,
  minShips = 1, balanceISK = 0, maxOpenings = 4,
  now = () => Date.now(), maxLinks = MAX_LINKS,
} = {}) {
  const required = [readLinks, getNativeEntity, getFactionForCorporation,
    getStargatesForSystem, readWarState, writeWarState];
  if (required.some((fn) => typeof fn !== "function")) throw Error("WAR_OPENING_AUTHORITIES_REQUIRED");
  let busy = false;
  function tick({ systemIDs = [] } = {}) {
    if (busy) return { status: "BUSY" };
    if (!Array.isArray(systemIDs) || systemIDs.length > 20) return { status: "INVALID_SYSTEMS" };
    busy = true;
    try {
      let state, links;
      try {
        state = readWarState();
        links = readLinks();
      } catch (_error) { return { status: "NATIVE_AUTHORITIES_UNAVAILABLE" }; }
      if (!state) return { status: "NO_WAR_STATE" };
      try { core.validateState(state); } catch (_error) { return { status: "INVALID_WAR_STATE" }; }
      const presence = collectPresence({ links, systemIDs, getNativeEntity, getFactionForCorporation, maxLinks });
      if (presence.status !== "PRESENCE") return { status: presence.status };
      const plan = planWars({
        state, presence, getStargatesForSystem, getGate,
        nowMs: num(now()), minShips, balanceISK, maxOpenings,
      });
      if (plan.status !== "READY")
        return { status: "NO_OPENING", reason: plan.reason || "PLAN_REFUSED", plan };
      const opened = applyOpenings({ state, plan, nowMs: num(now()) });
      if (opened.status !== "OPENED") return opened;
      writeWarState(opened.state);
      return {
        status: "OPENED", warIDs: opened.warIDs, campaignIDs: opened.campaignIDs,
        applied: opened.applied, fundings: opened.fundings,
        presence: { pilots: presence.pilots.length, skipped: presence.skipped },
        territories: plan.territories, fronts: plan.fronts.length, skipped: plan.skipped,
      };
    } finally { busy = false; }
  }
  return Object.freeze({ tick });
}

module.exports = {
  gateBetween, collectPresence, territoriesForFronts, paperFunding, presenceSummary,
  activeWarFor, liveCampaignFor, buildProofs, planWars, applyOpenings, applyOpening,
  createWarOpening,
};
