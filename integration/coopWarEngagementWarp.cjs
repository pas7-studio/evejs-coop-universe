"use strict";
// FW-030: an assault whose two sides materialized at different system anchors is
// mustered but un-fightable. The native war director only issues a shot inside its
// own engagement range, and the real doctrine guns on these hulls are short-range
// autocannons: a fleet sitting tens of AU - or even eleven kilometres - away can
// never open fire even though both sides own the field.
//
// A real fleet closes on the enemy it was mustered against. This module issues
// exactly that: one native warpToPoint to a standoff point beside the nearest
// opposing war ship of the same campaign, so the attacker really arrives inside
// gun range. It never spawns, teleports, deals damage or invents a kill, and every
// attempt is reported with its own native status.
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
  warpToPoint,
  orbit = null,
  clock = () => Date.now(),
  env = process.env,
  engageMeters = 3000,
  standoffMeters = 1000,
  warpMeters = 150000,
  cooldownMs = 60000,
} = {}) {
  if (
    [readWarState, sceneForSystem, getController, warpToPoint].some(x => typeof x !== "function") ||
    !registry || typeof registry.snapshot !== "function" ||
    typeof clock !== "function" ||
    (orbit !== null && typeof orbit !== "function") ||
    !Number.isSafeInteger(engageMeters) || engageMeters < 500 ||
    !Number.isSafeInteger(standoffMeters) || standoffMeters < 100 || standoffMeters >= engageMeters ||
    !Number.isSafeInteger(warpMeters) || warpMeters <= engageMeters ||
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
      // field it already controls.
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
        if ((nextAt.get(id) || 0) > now) continue;
        const me = scene.getEntityByID(id);
        if (!me || me.kind !== "ship" || me.nativeNpc !== true || me.session?.characterID) continue;
        if (!finite(me.position) || warping(me)) continue;
        let controller = null;
        try { controller = getController(id); } catch (_error) { controller = null; }
        if (!controller || controller.entityID !== id || Number(controller.systemID) !== systemID) continue;
        // Another director or an active engagement already owns it.
        if (Number(controller.currentTargetID) > 0) continue;
        const manual = controller.manualOrder;
        const orderedTargetID = manual && manual.type === "attack"
          ? Number(manual.targetID) || 0 : 0;
        // A hull holding an accepted attack order but no target is outside real gun
        // range: it closes on the ship it was ordered to kill. Any other hull is
        // closed on only by the assaulting side.
        if (manual && !orderedTargetID) continue;
        if (!orderedTargetID && Number(ship.factionID) !== attackerFactionID) continue;
        const enemies = inSystem
          .filter(o => Number(o.entityID) !== id &&
            Number(o.factionID) !== Number(ship.factionID) &&
            String(o.campaignID) === String(ship.campaignID))
          .map(row => ({ entityID: Number(row.entityID), entity: scene.getEntityByID(Number(row.entityID)) }))
          .filter(x => x.entity && x.entity.nativeNpc === true && finite(x.entity.position) &&
            !warping(x.entity))
          .map(x => ({
            entityID: x.entityID,
            position: x.entity.position,
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
        const nearest = (orderedTargetID
          ? enemies.find(x => x.entityID === orderedTargetID) || null : null) || enemies[0];
        // Already close enough for the real guns: the war director owns the shot.
        if (nearest.distance <= engageMeters) continue;
        nextAt.set(id, now + cooldownMs);
        // A native warp refuses a short hop, so the last leg is flown sublight:
        // the hull orbits the enemy at gun range instead of warping beside it.
        if (nearest.distance <= warpMeters && typeof orbit === "function") {
          let ack = null, threw = "";
          try { ack = orbit(id, nearest.entityID, standoffMeters); }
          catch (error) { threw = String(error?.message || error).slice(0, 120); }
          orders.push({
            entityID: id,
            targetID: nearest.entityID,
            campaignID: campaign.campaignID,
            factionID: Number(ship.factionID),
            systemID,
            distanceMeters: Math.round(nearest.distance),
            status: ack?.success === true ? "NATIVE_ORBIT_ORDERED"
              : String(threw || ack?.errorMsg || "REFUSED").slice(0, 120),
          });
          continue;
        }
        const dx = nearest.position.x - me.position.x;
        const dy = nearest.position.y - me.position.y;
        const dz = nearest.position.z - me.position.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        const point = {
          x: nearest.position.x - (dx / length) * standoffMeters,
          y: nearest.position.y - (dy / length) * standoffMeters,
          z: nearest.position.z - (dz / length) * standoffMeters,
        };
        let ack = null, threw = "";
        try {
          ack = warpToPoint(id, point, {
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
