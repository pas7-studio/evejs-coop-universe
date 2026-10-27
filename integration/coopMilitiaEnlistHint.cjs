"use strict";
// "Where do I enlist?" was unanswerable from the client: the Factional Warfare
// window in this build has no enlist button, and nothing pointed from the wish to
// join to the one station where the militia agent actually stands. The owner had
// to be told by hand. This module turns the real agent record and the real station
// record into a concrete instruction, so the answer is data instead of a favour.
//
// It never invents an agent or a station: no matching agent means null.

function toPositiveInt(value) {
  const n = Math.trunc(Number(value) || 0);
  return n > 0 ? n : 0;
}

function buildEnlistHint({ record, faction, agents, station } = {}) {
  const characterID = toPositiveInt(record && record.characterID);
  const factionID = toPositiveInt(faction && faction.factionID);
  const militiaCorporationID = toPositiveInt(faction && faction.militiaCorporationID);
  if (!characterID || !factionID || !militiaCorporationID) return null;

  const list = Array.isArray(agents) ? agents : [];
  const agent = list.find((row) => toPositiveInt(row && row.stationID) > 0) || null;
  if (!agent) return null;

  const stationID = toPositiveInt(agent.stationID);
  const here = station && toPositiveInt(station.stationID) === stationID ? station : null;
  const characterStationID = toPositiveInt(record && record.stationID);

  return {
    status: characterStationID === stationID ? "ENLIST_HERE" : "ENLIST_ELSEWHERE",
    factionID,
    factionName: String(faction.name || ""),
    militiaCorporationID,
    agentID: toPositiveInt(agent.agentID),
    agentName: String(agent.agentName || agent.name || ""),
    stationID,
    stationName: here ? String(here.stationName || "") : "",
    solarSystemID: here ? toPositiveInt(here.solarSystemID) : toPositiveInt(agent.solarSystemID),
    solarSystemName: here ? String(here.solarSystemName || "") : "",
    characterStationID,
    instruction: characterStationID === stationID
      ? `Talk to ${String(agent.agentName || agent.name || "the militia agent")} here and accept the enlistment.`
      : `Dock at ${here ? String(here.stationName || "") : "station " + stationID}` +
        `${here && here.solarSystemName ? " (" + here.solarSystemName + ")" : ""} and talk to ` +
        `${String(agent.agentName || agent.name || "the militia agent")}.`,
  };
}

module.exports = { buildEnlistHint };
