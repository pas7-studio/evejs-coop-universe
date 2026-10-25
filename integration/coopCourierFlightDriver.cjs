"use strict";
// Native flight driver for an NPC courier.
//
// Why this shape: `transitions.undockSession`/`dockSession` take the identity
// from a session object, but they only *read* it - `beginTransition` touches
// `session._transitionState`, and `syncInventoryChangesToSession` returns early
// when `sendNotification` is missing. So a plain identity object is enough; it
// is never registered in the session registry, which is the part that would
// leak into code expecting a real client.
//
// Every action is one native call, and any doubt returns AMBIGUOUS without a
// retry: a second undock or dock can duplicate state.
const OK = "OK";
const FAILED = "FAILED";
const AMBIGUOUS = "AMBIGUOUS";

function buildCourierSession(character, stationID) {
  const characterID = Number(character && character.characterID) || 0;
  if (!(characterID > 0)) return null;
  return {
    // Identity only; no sendNotification on purpose.
    characterID,
    charid: characterID,
    userid: Number(character.accountId) || 0,
    corpid: Number(character.corporationID) || 0,
    corporationID: Number(character.corporationID) || 0,
    allianceid: Number(character.allianceID) || 0,
    locationid: Number(stationID) || 0,
    stationID: Number(stationID) || 0,
    _transitionState: null,
    isNpcCourier: true,
    // Native transitions push their result through the session. An NPC has no
    // client, so these are no-ops: without them the undock mutated real state
    // and then threw "session.sendSessionChange is not a function".
    sendSessionChange() { return undefined; },
  };
}

// A driver is only usable when every native capability it needs is present.
// Nothing is attempted otherwise, so a half-wired server cannot strand a
// contract in progress.
function preflight(ctx) {
  const missing = [];
  if (!ctx || typeof ctx !== "object") return { status: "NOT_READY", missing: ["runtime"] };
  if (!ctx.transitions || typeof ctx.transitions.undockSession !== "function") missing.push("transitions.undockSession");
  if (!ctx.transitions || typeof ctx.transitions.dockSession !== "function") missing.push("transitions.dockSession");
  if (!ctx.space || typeof ctx.space.warpToPoint !== "function") missing.push("space.warpToPoint");
  return missing.length ? { status: "NOT_READY", missing } : { status: "READY" };
}

function result(state, extra) {
  // Extra fields must not clobber the state for the same reason as refusal().
  return Object.assign({}, extra || {}, { status: state });
}

function undock(ctx, flight) {
  const ready = preflight(ctx);
  if (ready.status !== "READY") return result("NOT_READY", { missing: ready.missing });
  if (Number(ctx.character && ctx.character.stationID) !== Number(flight.originStationID)) {
    return result("REFUSED", {
      reason: "courier is not docked at the contract origin",
      characterStationID: Number(ctx.character && ctx.character.stationID) || 0,
      originStationID: Number(flight.originStationID) || 0,
    });
  }
  const session = buildCourierSession(ctx.character, flight.originStationID);
  if (!session) return result("REFUSED", { reason: "courier character is not usable" });
  let outcome;
  try {
    outcome = ctx.transitions.undockSession(session, {});
  } catch (error) {
    return result(AMBIGUOUS, { reason: String(error && error.message || error) });
  }
  if (outcome && outcome.success === true) {
    // The native undock returns the created ship record; its entity ID is what
    // the warp needs. Verified against transitions.js (data.ship).
    const ship = outcome.data && outcome.data.ship || {};
    const entityID = Number(ship.entityID || ship.itemID || ship.shipID) || 0;
    return result(OK, { shipID: entityID, entityID });
  }
  return result(FAILED, { reason: String(outcome && outcome.errorMsg || "undock failed") });
}

// One native warp to the destination station position. The station position is
// supplied by the caller from real station data, never invented here.
function warp(ctx, flight, stationPosition) {
  const ready = preflight(ctx);
  if (ready.status !== "READY") return result("NOT_READY", { missing: ready.missing });
  if (!stationPosition || !Number.isFinite(Number(stationPosition.x))) {
    return result("REFUSED", { reason: "destination station position is required" });
  }
  const entityID = Number(flight.entityID) || 0;
  if (!(entityID > 0)) return result(FAILED, { reason: "courier ship is not in space (no entity from undock)" });
  const options = {
    forceImmediateStart: true,
    broadcastWarpStartToVisibleSessions: true,
    ingressDurationMs: Number(ctx.warpIngressMs) || 30000,
  };
  try {
    // A courier has no session, so the session-less ingress is the honest call:
    // space.warpToPoint expects a client session and silently did nothing here.
    if (typeof ctx.space.startSessionlessWarpIngress === "function") {
      const outcome = ctx.space.startSessionlessWarpIngress(entityID, stationPosition, options);
      if (outcome === false || (outcome && outcome.success === false)) {
        return result(FAILED, { reason: String(outcome && outcome.errorMsg || "sessionless warp refused") });
      }
      return result(OK, { entityID });
    }
    const warped = ctx.space.warpToPoint(entityID, stationPosition, options);
    return warped === false
      ? result(FAILED, { reason: "warpToPoint refused" })
      : result(OK, { entityID });
  } catch (error) {
    return result(AMBIGUOUS, { reason: String(error && error.message || error) });
  }
}

function dock(ctx, flight) {
  const ready = preflight(ctx);
  if (ready.status !== "READY") return result("NOT_READY", { missing: ready.missing });
  const session = buildCourierSession(ctx.character, flight.destinationStationID);
  if (!session) return result("REFUSED", { reason: "courier character is not usable" });
  let outcome;
  try {
    outcome = ctx.transitions.dockSession(session, flight.destinationStationID);
  } catch (error) {
    return result(AMBIGUOUS, { reason: String(error && error.message || error) });
  }
  if (outcome && outcome.success === true) return result(OK);
  return result(FAILED, { reason: String(outcome && outcome.errorMsg || "dock failed") });
}

// Executes exactly one flight step. The caller persists the flight record and
// advances it only on OK.
function runStep(ctx, flight, stationPosition) {
  if (!flight || !flight.step) return result("REFUSED", { reason: "no flight" });
  if (flight.step === "undock") return undock(ctx, flight);
  if (flight.step === "warp") return warp(ctx, flight, stationPosition);
  if (flight.step === "arrive") {
    // Arrival is never assumed: the caller must supply real evidence that the
    // ship is at the destination before the flight is allowed to dock.
    return ctx && ctx.arrivalConfirmed === true
      ? result(OK)
      : result("REFUSED", { reason: "arrival is not confirmed by the scene" });
  }
  if (flight.step === "dock") return dock(ctx, flight);
  if (flight.step === "done") return result("DONE");
  return result("REFUSED", { reason: "unknown flight step: " + flight.step });
}

module.exports = { OK, FAILED, AMBIGUOUS, buildCourierSession, preflight, undock, warp, dock, runStep };
