"use strict";
// Fronts are DERIVED, never hand-placed.
//
// Owner definition (2026-10-27): every faction owns sectors, and a front is the
// intersection of two factions' sectors - two adjacent systems (adjacency from
// the real gate graph) whose owners differ. That border is the active combat
// zone. Move control of one system and the front moves by itself.
const num = (value) => Number(value) || 0;
const positive = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function ownerOf(territories, systemID) {
  const value = territories && territories[systemID];
  const owner = typeof value === "object" && value ? value.factionID : value;
  return typeof owner === "string" && owner ? owner : null;
}

// One border edge per real reciprocal gate pair between two owners.
function borderEdges({ territories = {}, getStargatesForSystem, getGate } = {}) {
  if (typeof getStargatesForSystem !== "function") return [];
  const edges = new Map();
  for (const key of Object.keys(territories || {})) {
    const systemID = num(key);
    if (!positive(systemID)) continue;
    const owner = ownerOf(territories, systemID);
    if (!owner) continue;
    for (const gate of getStargatesForSystem(systemID) || []) {
      const gateID = num(gate && gate.itemID);
      const destinationGateID = num(gate && gate.destinationID);
      if (!positive(gateID) || !positive(destinationGateID)) continue;
      const back = typeof getGate === "function" ? getGate(destinationGateID) : null;
      if (back && (num(back.destinationID) !== gateID || num(back.solarSystemID) !== num(gate.destinationSolarSystemID || back.solarSystemID))) continue;
      const other = num(gate && gate.destinationSolarSystemID) || num(back && back.solarSystemID);
      if (!positive(other) || other === systemID) continue;
      const otherOwner = ownerOf(territories, other);
      if (!otherOwner || otherOwner === owner) continue;
      const [a, b] = systemID < other ? [systemID, other] : [other, systemID];
      const key2 = a + ":" + b;
      if (edges.has(key2)) continue;
      edges.set(key2, {
        fromSystemID: systemID,
        toSystemID: other,
        fromOwner: owner,
        toOwner: otherOwner,
        gateID: gateID,
        reciprocalGateID: destinationGateID,
      });
    }
  }
  return [...edges.values()];
}

// Groups border edges by faction pair. Each group is one front: the line where
// those two factions actually touch, with the systems that hold it.
function buildFronts(options = {}) {
  const edges = borderEdges(options);
  const fronts = new Map();
  for (const edge of edges) {
    const pair = [edge.fromOwner, edge.toOwner].sort();
    const key = pair.join("|");
    if (!fronts.has(key)) {
      fronts.set(key, {
        frontID: "front:" + pair.join("-"),
        factions: pair,
        edges: [],
        systems: new Set(),
        gates: new Set(),
      });
    }
    const front = fronts.get(key);
    front.edges.push(edge);
    front.systems.add(edge.fromSystemID);
    front.systems.add(edge.toSystemID);
    front.gates.add(edge.gateID);
  }
  return [...fronts.values()]
    .map((front) => ({
      frontID: front.frontID,
      factions: front.factions,
      edgeCount: front.edges.length,
      systemIDs: [...front.systems].sort((a, b) => a - b),
      gateIDs: [...front.gates].sort((a, b) => a - b),
      edges: front.edges.slice().sort((a, b) => a.fromSystemID - b.fromSystemID || a.toSystemID - b.toSystemID),
    }))
    .sort((a, b) => b.edgeCount - a.edgeCount || a.frontID.localeCompare(b.frontID));
}

// Systems that touch enemy space: the candidate places for a front operation.
function contestedSystemIDs(options = {}) {
  const ids = new Set();
  for (const edge of borderEdges(options)) {
    ids.add(edge.fromSystemID);
    ids.add(edge.toSystemID);
  }
  return [...ids].sort((a, b) => a - b);
}

module.exports = { borderEdges, buildFronts, contestedSystemIDs, ownerOf };
