"use strict";
// Live courier dispatch: a seeded courier CHARACTER accepts a real native
// courier contract, flies it with native undock/warp/dock and completes it.
//
// Nothing is invented here. Every mutation is a stock native call:
//   - accept/complete go through contractRuntimeState (the same functions a
//     client uses), with an identity object that is never registered as a
//     session,
//   - the flight uses transitions.undockSession/dockSession and space.warpToPoint,
//   - arrival is only confirmed by the real scene: the ship entity must be
//     inside station docking range of the destination station position.
//
// Fail-closed rules:
//   - one accept attempt per contract per process; an ambiguous native result
//     is never retried,
//   - a flight advances only on a confirmed OK for the same step token,
//   - a contract is completed only when its package item is physically at the
//     destination station.
// The same file is loaded as .cjs in the repo and as .js inside the server.
const EXT = (typeof __filename === "string" && __filename.endsWith(".js")) ? "" : ".cjs";
const { evaluateContract } = require("./coopCourierDispatch" + EXT);
const flightCore = require("./coopCourierFlight" + EXT);
const driver = require("./coopCourierFlightDriver" + EXT);
const bridge = require("./coopCourierNativeAccept" + EXT);

// Collateral is insurance, not a refusal reason: a courier takes a contract when
// it actually holds the ISK. requireZeroCollateral stays the pure-core default
// so unit tests keep covering both policies.
const LIVE_POLICY = Object.freeze({ sameSystemOnly: true, requireZeroCollateral: false, maxRouteLegs: 8 });
// Stock station docking range.
const DOCKING_RANGE_M = 2500;

function num(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function distanceM(left, right) {
  const dx = num(left.x) - num(right.x);
  const dy = num(left.y) - num(right.y);
  const dz = num(left.z) - num(right.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// deps: { contracts, gameStore, itemStore, worldData, transitions, space,
//         sceneForSystem, pilots, now, log }
function createCourierDispatch(deps = {}) {
  const contracts = deps.contracts;
  const gameStore = deps.gameStore;
  const itemStore = deps.itemStore;
  const worldData = deps.worldData;
  const transitions = deps.transitions;
  const space = deps.space;
  const sceneForSystem = deps.sceneForSystem;
  const pilots = (Array.isArray(deps.pilots) ? deps.pilots : []).map(num).filter((id) => id > 0);
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const flights = new Map();
  const repositions = new Map();
  const attempted = new Set();

  // Item rows come from the same store as characters: {key,json} with the bare
  // item ID as the key. itemStore.readItems() is not used here because it needs
  // the inventory service bootstrapped, and a read must never depend on that.
  function itemRow(itemID) {
    const id = num(itemID);
    if (!(id > 0) || !gameStore || typeof gameStore.read !== "function") return null;
    try {
      let row = gameStore.read("items", String(id));
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

  function characterRow(characterID) {
    try {
      if (!gameStore || typeof gameStore.read !== "function") return null;
      // The store keeps rows as {key,json}: the key is the bare character ID and
      // the value is a JSON string. Reading "/"+id (a path-style key) silently
      // returned nothing and every pilot looked like a non-identity.
      let row = gameStore.read("characters", String(characterID));
      if (!row) row = gameStore.read("characters", "/" + characterID);
      // gameStore.read returns { success, errorMsg, data }: the row lives in data.
      if (row && typeof row === "object" && !Array.isArray(row) && "success" in row) {
        if (row.success !== true) return null;
        row = row.data;
      }
      if (typeof row === "string") row = JSON.parse(row);
      if (!row || typeof row !== "object") return null;
      // The stored record has no characterID field: the row key is the ID.
      return Object.assign({ characterID }, row, { stationID: num(row.stationID || row.locationID) });
    } catch (_error) {
      return null;
    }
  }

  function identityFor(characterID) {
    const character = characterRow(characterID);
    if (!character || !(num(character.accountId) > 0)) return null;
    const shipID = num(character.shipID);
    const row = shipID ? itemRow(shipID) : null;
    const ship = row ? Object.assign({ itemID: shipID }, row) : null;
    return { character, ship, hullCapacityM3: num(ship && ship.capacity) };
  }

  function packageLocationID(contract) {
    const row = itemRow(num(contract && contract.plasticWrapItemID));
    return row ? num(row.locationID) : 0;
  }

  function sceneFor(systemID) {
    try {
      return typeof sceneForSystem === "function" ? sceneForSystem(systemID) : null;
    } catch (_error) {
      return null;
    }
  }

  function stationPosition(stationID) {
    try {
      const station = worldData && typeof worldData.getStationByID === "function"
        ? worldData.getStationByID(stationID)
        : null;
      const position = station && station.position;
      return position && Number.isFinite(num(position.x)) ? position : null;
    } catch (_error) {
      return null;
    }
  }

  // Real arrival proof: the native ship entity is in space and inside docking
  // range of the destination station. No position, no confirmation.
  function arrivalConfirmed(flight) {
    const scene = sceneFor(num(flight.systemID));
    const target = stationPosition(num(flight.destinationStationID));
    if (!scene || typeof scene.getEntityByID !== "function" || !target) return false;
    const entity = scene.getEntityByID(num(flight.entityID));
    if (!entity || !entity.position) return false;
    return distanceM(entity.position, target) <= DOCKING_RANGE_M;
  }

  function pilotFor(contract) {
    const seen = [];
    for (const pilotID of pilots) {
      const identity = identityFor(pilotID);
      if (!identity) { seen.push(pilotID + ":NO_IDENTITY"); continue; }
      const decision = evaluateContract(contract, LIVE_POLICY, {
        walletIsk: num(identity.character.balance),
        hullCapacityM3: identity.hullCapacityM3,
      });
      if (decision.status === "ELIGIBLE") return { identity, decision };
      seen.push(`${pilotID}:${decision.status}:own${num(identity.ship && identity.ship.ownerID)}/cap${identity.hullCapacityM3}/sys${num(identity.character.solarSystemID)}/st${num(identity.character.stationID)}`);
    }
    log(`[CoopCourier] contract ${num(contract && contract.contractID)} pilots ${seen.join(" ")}`);
    return null;
  }

  // A real courier is only where it really is. When the best hull is docked at
  // another station in the same system, it must FLY to the contract origin
  // before it may accept - no teleport, no faked station.
  function repositionFor(contract) {
    const origin = num(contract && contract.startStationID);
    const systemID = num(contract && contract.startSolarSystemID);
    const volume = num(contract && contract.volume);
    const collateral = num(contract && contract.collateral);
    if (!(origin > 0) || !(systemID > 0)) return null;
    for (const pilotID of pilots) {
      if (repositions.has(pilotID)) continue;
      const identity = identityFor(pilotID);
      if (!identity) continue;
      const { character, ship } = identity;
      if (!ship || num(ship.ownerID) !== num(character.characterID)) continue;
      if (num(ship.capacity) < volume || num(character.balance) < collateral) continue;
      if (num(character.solarSystemID) !== systemID) continue;
      const at = num(character.stationID);
      if (!(at > 0) || at === origin) continue;
      return { identity, at };
    }
    return null;
  }

  function startFlights() {
    if (!contracts || typeof contracts.listContractRecords !== "function") return;
    for (const record of contracts.listContractRecords() || []) {
      const contractID = num(record && record.contractID);
      if (!(contractID > 0) || attempted.has(contractID) || flights.has(contractID)) continue;
      if (num(record.type) !== 3 || num(record.status) !== 0) continue;
      const picked = pilotFor(record);
      if (!picked) {
        const move = repositionFor(record);
        if (move) {
          const planned = flightCore.createFlight({
            contract: { contractID: num(move.identity.character.characterID), startStationID: move.at, endStationID: num(record.startStationID) },
            identity: move.identity,
            nowMs: now(),
          });
          if (planned.status === "FLIGHT_PLANNED") {
            repositions.set(num(move.identity.character.characterID), Object.assign({}, planned, {
              reposition: true,
              systemID: num(record.startSolarSystemID),
              identity: move.identity,
            }));
            log(`[CoopCourier] courier ${move.identity.character.characterID} repositioning ${move.at} -> ${num(record.startStationID)}`);
            continue;
          }
        }
        log(`[CoopCourier] contract ${contractID} no eligible courier yet`);
        continue;
      }
      attempted.add(contractID);
      const at = packageLocationID(record);
      const accepted = bridge.accept({
        contract: record,
        identity: picked.identity,
        packageLocationID: at,
        runtime: contracts,
      });
      if (accepted.status !== "ACCEPTED") {
        log(`[CoopCourier] contract ${contractID} accept ${accepted.status} ${accepted.plan || ""} ${accepted.reason || ""}`.trim());
        continue;
      }
      const planned = flightCore.createFlight({ contract: record, identity: picked.identity, nowMs: now() });
      if (planned.status !== "FLIGHT_PLANNED") {
        log(`[CoopCourier] contract ${contractID} accepted but ${planned.status} ${planned.reason || ""}`.trim());
        continue;
      }
      const flight = Object.assign({}, planned, {
        systemID: num(record.startSolarSystemID),
        identity: picked.identity,
      });
      flights.set(contractID, flight);
      log(`[CoopCourier] contract ${contractID} ACCEPTED by ${picked.identity.character.characterID}, flight planned`);
    }
  }

  function stepFlight(contractID, flight) {
    const action = flightCore.nextAction(flight, now());
    if (action.status === "FLIGHT_DONE") {
      if (flight.reposition) {
        repositions.delete(num(flight.characterID));
        log(`[CoopCourier] courier ${flight.characterID} repositioned to ${flight.destinationStationID}`);
        return;
      }
      const live = contracts.getContractRecord(contractID);
      const identity = identityFor(num(flight.characterID)) || flight.identity;
      const done = bridge.complete({
        contract: live,
        identity,
        packageLocationID: packageLocationID(live),
        runtime: contracts,
      });
      if (done.status === "COMPLETED") {
        log(`[CoopCourier] contract ${contractID} DELIVERED by ${flight.characterID}`);
        flights.delete(contractID);
      } else {
        log(`[CoopCourier] contract ${contractID} complete ${done.status} ${done.reason || ""}`.trim());
      }
      return;
    }
    if (action.status !== "ACTION") {
      log(`[CoopCourier] contract ${contractID} flight ${action.status} ${action.step || ""}`.trim());
      return;
    }
    const identity = identityFor(num(flight.characterID));
    if (!identity) return;
    const target = stationPosition(num(flight.destinationStationID));
    const ctx = {
      character: identity.character,
      transitions,
      space,
      warpIngressMs: 30000,
      arrivalConfirmed: flight.step === "arrive" ? arrivalConfirmed(flight) : false,
    };
    const observed = driver.runStep(ctx, flight, target);
    const token = flightCore.stepToken(flight);
    const next = flightCore.advanceFlight(flight, observed.status, now(), token);
    const withEntity = Object.assign({}, next, {
      entityID: num(observed.entityID) || num(flight.entityID),
      identity: flight.identity,
      systemID: flight.systemID,
    });
    if (flight.reposition) repositions.set(num(flight.characterID), withEntity);
    else flights.set(contractID, withEntity);
    const label = flight.reposition ? `courier ${flight.characterID} reposition` : `contract ${contractID}`;
    if (observed.status !== driver.OK) {
      log(`[CoopCourier] ${label} ${flight.step} ${observed.status} ${observed.reason || ""}`.trim());
    } else {
      log(`[CoopCourier] ${label} ${flight.step} OK -> ${withEntity.step}`);
    }
  }

  function tick() {
    startFlights();
    for (const [contractID, flight] of [...flights]) {
      try {
        stepFlight(contractID, flight);
      } catch (error) {
        log(`[CoopCourier] contract ${contractID} step failed ${String(error && error.message || error)}`);
      }
    }
    for (const [pilotID, flight] of [...repositions]) {
      try {
        stepFlight(pilotID, flight);
      } catch (error) {
        log(`[CoopCourier] courier ${pilotID} reposition failed ${String(error && error.message || error)}`);
      }
    }
  }

  return {
    tick,
    flights: () => [...flights.values()],
    attempted: () => [...attempted],
    LIVE_POLICY,
    DOCKING_RANGE_M,
  };
}

module.exports = { createCourierDispatch, LIVE_POLICY, DOCKING_RANGE_M };
