"use strict";
// FW-030: an assault whose two sides materialized at different system anchors is
// mustered but un-fightable. The native battle director only orders a shot inside
// its real engagement range (250 km), so a fleet sitting AUs away can never open
// fire even though both sides own the field.
//
// A real fleet warps to the enemy it was mustered against. This module issues
// exactly that: one native warpToEntity to the nearest opposing war ship of the
// same campaign. It never spawns, teleports, deals damage or invents a kill, and
// every attempt is reported with its own native status.
const enabled = env => env.EVEJS_COOP_WAR_ENGAGE_WARP === "1";
const pos = x => Number.isSafeInteger(x) && x > 0;
const finite = p => p && ["x", "y", "z"].every(k => typeof p[k] === "number" && Number.isFinite(p[k]));
const warping = s => String(s?.mode || "").toUpperCase().includes("WARP") ||
  !!(s?.pendingWarp || s?.warpState || s?.isWarping);

function createWarEngagementWarp({
  readWarState,
  registry,
  sceneForSystem,
  getController,
  warpToEntity,
  clock = () => Date.now(),
  env = process.env,
  maxRangeMeters = 250000,
  cooldownMs = 60000,
} = {}) {
  if (
    [readWarState, sceneForSystem, getController, warpToEntity].some(x => typeof x !== "function") ||
    !registry || typeof registry.snapshot !== "function" ||
    typeof clock !== "function" ||
    !Number.isSafeInteger(maxRangeMeters) || maxRangeMeters < 10000 ||
    !Number.isSafeInteger(cooldownMs) || cooldownMs < 10000
  ) throw Error("WAR_ENGAGEMENT_WARP_AUTHORITIES_REQUIRED");
  const nextAt = new Map();

  function tick({ systemIDs = [] } = {}) {
    if (!enabled(env)) return { status: "DISABLED", orders: [], skips: [] };
    if (!Array.isArray(systemIDs) || systemIDs.length > 20) {
      return { status: "INVALID_SYSTEMS", orders: [], skips: [] };
    }
    let state, ships;
    try {
      state = readWarState();
      ships = Object.values(registry.snapshot()?.ships || {});
    } catch (_error) {
      return { status: "NATIVE_AUTHORITIES_UNAVAILABLE", orders: [], skips: [] };
    }
    if (state?.version !== 1 || !state.campaigns || !state.wars || !Array.isArray(ships)) {
      return { status: "INVALID_WAR_STATE", orders: [], skips: [] };
    }
    const now = clock();
    if (!pos(now)) return { status: "CLOCK_UNSAFE", orders: [], skips: [] };
    const campaigns = Object.values(state.campaigns).filter(c =>
      c && c.state === "ASSAULT" && state.wars[c.warID]?.state === "ACTIVE" &&
      pos(Number(c.targetSystemID))).slice(0, 8);
    if (!campaigns.length) return { status: "NO_ASSAULT", orders: [], skips: [] };
    const orders = [], skips = [];
    for (const campaign of campaigns) {
      const systemID = Number(campaign.targetSystemID);
      // Only the assaulting side closes the distance; the defender holds the
      // field it already controls. This also keeps one warp per engagement
      // instead of two fleets warping past each other.
      const attackerFactionID = Number(state.wars[campaign.warID]?.attackerFactionID);
      if (!pos(attackerFactionID)) {
        skips.push({ campaignID: campaign.campaignID, reason: "NO_ATTACKER_FACTION" });
        continue;
      }
      let scene = null;
      try { scene = sceneForSystem(systemID); } catch (_error) { scene = null; }
      if (scene?.systemID !== systemID || typeof scene.getEntityByID !== "function") {
        skips.push({ campaignID: campaign.campaignID, reason: "NO_NATIVE_SCENE" });
        continue;
      }
      const inSystem = ships.filter(s => Number(s.systemID) === systemID);
      for (const ship of inSystem) {
        const id = Number(ship.entityID);
        if (!pos(id)) continue;
        if (Number(ship.factionID) !== attackerFactionID) continue;
        const me = scene.getEntityByID(id);
        if (!me || me.kind !== "ship" || me.nativeNpc !== true || me.session?.characterID) continue;
        if (!finite(me.position) || warping(me)) continue;
        let controller = null;
        try { controller = getController(id); } catch (_error) { controller = null; }
        if (!controller || controller.entityID !== id || Number(controller.systemID) !== systemID) continue;
        // Another director, a player order or an active engagement already owns it.
        if (Number(controller.currentTargetID) > 0 || controller.manualOrder) continue;
        if ((nextAt.get(id) || 0) > now) continue;
        const enemies = inSystem
          .filter(o => Number(o.entityID) !== id &&
            Number(o.factionID) !== Number(ship.factionID) &&
            String(o.campaignID) === String(ship.campaignID))
          .map(row => ({ row, entity: scene.getEntityByID(Number(row.entityID)) }))
          .filter(x => x.entity && x.entity.nativeNpc === true && finite(x.entity.position) &&
            !warping(x.entity))
          .map(x => ({
            entityID: Number(x.row.entityID),
            distance: Math.hypot(
              x.entity.position.x - me.position.x,
              x.entity.position.y - me.position.y,
              x.entity.position.z - me.position.z),
          }))
          .filter(x => Number.isFinite(x.distance))
          .sort((a, b) => a.distance - b.distance || a.entityID - b.entityID);
        if (!enemies.length) {
          skips.push({ campaignID: campaign.campaignID, entityID: id, reason: "NO_ENEMY_IN_SYSTEM" });
          continue;
        }
        const nearest = enemies[0];
        // Already inside the native firing envelope: the battle director owns it.
        if (nearest.distance <= maxRangeMeters) continue;
        nextAt.set(id, now + cooldownMs);
        let ack = null, threw = "";
        try {
          ack = warpToEntity(id, nearest.entityID, {
            forceImmediateStart: true,
            broadcastWarpStartToVisibleSessions: true,
          });
        } catch (error) { threw = String(error?.message || error).slice(0, 120); }
        orders.push({
          entityID: id,
          targetID: nearest.entityID,
          campaignID: campaign.campaignID,
          factionID: Number(ship.factionID),
          systemID,
          distanceMeters: Math.round(nearest.distance),
          status: ack?.success === true ? "NATIVE_WARP_STARTED"
            : String(threw || ack?.errorMsg || "REFUSED").slice(0, 120),
        });
      }
    }
    return { status: orders.length ? "WARP_ORDERED" : "NO_ORDER", orders, skips };
  }
  return Object.freeze({ tick });
}

module.exports = { createWarEngagementWarp, enabled };
