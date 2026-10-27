"use strict";
// One owner per record. A mining fleet retreat (a real pirate attack, a depleted
// belt, an operator order) warps EVERY hull back to the fleet's off-grid warp
// origin, 2-4 AU from the belt. A hauler that is flying an acknowledged station
// trip is not the retreat's to move: pulling it home destroys a route that already
// has a durable departure ack, so the arrival gate can never pass and the fleet
// sits in "loaded" until the deadline and never mines again. Measured live: fleet
// 960004609's haulers were 190 173 736 005 m from their own trip's station while
// the trip was still live.
//
// The trip's own logic re-flies such a hull with the same native warp, so the
// retreat simply leaves it alone. Default OFF.
const noted = new Map();
const NOTE_THROTTLE_MS = 120_000;

function inLiveTrip(fleetRecord, entityID) {
  const trip = fleetRecord && fleetRecord.coopStationArrival;
  const id = Number(entityID) || 0;
  if (!trip || !trip.haulers || typeof trip.haulers !== "object" || !(id > 0)) return false;
  if (!Object.prototype.hasOwnProperty.call(trip.haulers, String(id))) return false;
  // A trip without its durable departure witness is not live: it is exactly the
  // state the journal now closes, so the retreat may move that hull.
  return trip.manifestID ? true : false;
}
function skip(fleetRecord, entityID) {
  if (process.env.EVEJS_COOP_MINING_TRIP_RETREAT_GUARD !== "1") return false;
  if (!inLiveTrip(fleetRecord, entityID)) return false;
  const now = Date.now();
  const key = String(Number(fleetRecord && fleetRecord.fleetID) || 0) + ":" + String(Number(entityID) || 0);
  if (now - (noted.get(key) || 0) >= NOTE_THROTTLE_MS) {
    noted.set(key, now);
    try {
      require("./coopRuntimeProbe").observe("living-mining-retreat-skip", null,
        { spaceState: { systemID: Number(fleetRecord && fleetRecord.systemID) || 0 } },
        {
          fleetID: Number(fleetRecord && fleetRecord.fleetID) || 0,
          haulerID: Number(entityID) || 0,
          manifestID: String(fleetRecord.coopStationArrival.manifestID || ""),
          reason: "ACTIVE_STATION_TRIP_OWNS_THIS_HULL",
        });
    } catch (_error) { /* telemetry must never block a retreat */ }
  }
  return true;
}
function reset() { noted.clear(); }
module.exports = { skip, inLiveTrip, reset };
