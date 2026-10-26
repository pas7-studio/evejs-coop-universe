"use strict";
// Runs *inside* the EveJS server container (piped through `docker exec -i node -`).
// One read-only probe: contract, package, courier, hull, persisted leg, history.
// Nothing here mutates state; every field comes from the real stores.
const base = "/app/server/src/";
const fs = require("node:fs");

function readRow(table, key) {
  try {
    const store = require(base + "gameStore");
    let row = store.read(table, String(key));
    if (row && typeof row === "object" && !Array.isArray(row) && "success" in row) {
      if (row.success !== true) return null;
      row = row.data;
    }
    if (typeof row === "string") row = JSON.parse(row);
    return row && typeof row === "object" ? row : null;
  } catch (_error) {
    return null;
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return null;
  }
}

const out = { contract: null, package: null, courier: null, ship: null, leg: null, history: null, notes: [] };
const wanted = Number(process.env.Q_CONTRACT) || 0;

try {
  const contracts = require(base + "services/contracts/contractRuntimeState");
  const records = (typeof contracts.listContractRecords === "function" && contracts.listContractRecords()) || [];
  const record = wanted > 0
    ? records.find((row) => Number(row.contractID) === wanted)
    : records.find((row) => Number(row.type) === 3 && Number(row.status) === 1);
  if (!record) {
    out.notes.push(wanted > 0 ? `contract ${wanted} not found` : "no in-progress courier contract");
  } else {
    out.contract = {
      contractID: Number(record.contractID),
      status: Number(record.status),
      acceptorID: Number(record.acceptorID) || 0,
      issuerID: Number(record.issuerID) || 0,
      startStationID: Number(record.startStationID) || 0,
      endStationID: Number(record.endStationID) || 0,
      volumeM3: Number(record.volume) || 0,
      reward: Number(record.reward) || 0,
      collateral: Number(record.collateral) || 0,
      completedAt: record.completedAt || null,
      plasticWrapItemID: Number(record.plasticWrapItemID) || 0,
    };
    const wrap = readRow("items", out.contract.plasticWrapItemID);
    if (wrap) {
      out.package = {
        itemID: Number(wrap.itemID) || out.contract.plasticWrapItemID,
        ownerID: Number(wrap.ownerID) || 0,
        locationID: Number(wrap.locationID) || 0,
        flagID: Number(wrap.flagID) || 0,
        volume: Number(wrap.volume) || 0,
      };
    }
    const character = readRow("characters", out.contract.acceptorID);
    if (character) {
      out.courier = {
        characterID: Number(character.characterID) || out.contract.acceptorID,
        characterName: character.characterName || "",
        stationID: character.stationID === null || character.stationID === undefined ? null : Number(character.stationID),
        solarSystemID: Number(character.solarSystemID) || 0,
        shipID: Number(character.shipID) || 0,
      };
      const ship = readRow("items", out.courier.shipID);
      if (ship) {
        out.ship = {
          itemID: Number(ship.itemID) || out.courier.shipID,
          typeID: Number(ship.typeID) || 0,
          locationID: Number(ship.locationID) || 0,
          flagID: Number(ship.flagID) || 0,
          capacity: Number(ship.capacity) || 0,
        };
      }
    }
    const legs = readJsonFile("/var/lib/evejs/coop-courier-flights.json");
    const leg = legs && legs.legs ? legs.legs[String(out.contract.contractID)] : null;
    if (leg) {
      out.leg = {
        step: leg.step,
        entityID: Number(leg.entityID) || 0,
        systemID: Number(leg.systemID) || 0,
        stepStartedAtMs: Number(leg.stepStartedAtMs) || 0,
        rewarpAtMs: Number(leg.rewarpAtMs) || 0,
      };
    }
    const history = readJsonFile("/var/lib/evejs/coop-courier-history.json");
    const row = history && history.history ? history.history[String(out.contract.contractID)] : null;
    if (row) {
      out.history = {
        departedAtMs: Number(row.departedAtMs) || 0,
        incidents: Array.isArray(row.incidents) ? row.incidents.length : 0,
        lastIncident: Array.isArray(row.incidents) && row.incidents.length ? row.incidents[row.incidents.length - 1] : null,
      };
    }
  }
} catch (error) {
  out.notes.push("probe failed: " + String(error && error.message || error));
}

console.log(JSON.stringify(out));
