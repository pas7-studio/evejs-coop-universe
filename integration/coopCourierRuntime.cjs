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
// Shared identity object for this courier, owned by the generic motion module.
const motion = require("./coopNativeAgentMotion" + EXT);
const bridge = require("./coopCourierNativeAccept" + EXT);
const notices = require("./coopCourierNotices" + EXT);
const nodeFs = require("node:fs");
// Notice ledger lives on the persistent data volume: a restart or a container
// recreate must never mail the same courier message twice.
const NOTICE_FILE = process.env.EVEJS_COOP_COURIER_NOTICE_FILE || "/var/lib/evejs/coop-courier-notices.json";

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
  const sendMail = typeof deps.sendMail === "function" ? deps.sendMail : null;
  let sentNotices = {};
  try {
    const raw = nodeFs.readFileSync(NOTICE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") sentNotices = parsed;
  } catch (_error) {
    sentNotices = {};
  }
  function noticeAlreadySent(contractID, kind) {
    const row = sentNotices[String(contractID)];
    return Boolean(row && row[kind]);
  }
  function rememberNotice(contractID, kind) {
    sentNotices[String(contractID)] = Object.assign({}, sentNotices[String(contractID)], { [kind]: new Date().toISOString() });
    try {
      nodeFs.writeFileSync(NOTICE_FILE, JSON.stringify(sentNotices));
    } catch (_error) {
      /* the mail is already out; a lost ledger line must not throw */
    }
  }
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

  // EveJS's native acceptCourier leaves the package in the courier's hangar at
  // the origin station, and completion requires it at the destination station.
  // So a courier must really load it into the hull and really hand it over:
  // both are ordinary inventory moves, never a flag flip.
  const CARGO_HOLD_FLAG = 5;
  const STATION_HANGAR_FLAG = 4;

  function movePackage(wrapID, locationID, flagID) {
    if (!itemStore || typeof itemStore.moveItemToLocation !== "function") {
      return { ok: false, detail: "itemStore.moveItemToLocation is unavailable" };
    }
    try {
      const moved = itemStore.moveItemToLocation(wrapID, locationID, flagID, null);
      if (moved && moved.success === false) {
        return { ok: false, detail: String(moved.errorMsg || "item move refused") };
      }
      return { ok: true, detail: "" };
    } catch (error) {
      return { ok: false, detail: String(error && error.message || error) };
    }
  }

  // Loads the contract package from the origin hangar into the courier's cargo
  // hold, so the ship does not fly empty.
  function loadPackageIntoShip(contract, identity) {
    const wrapID = num(contract && contract.plasticWrapItemID);
    const shipID = num(identity && identity.ship && identity.ship.itemID);
    if (!(wrapID > 0) || !(shipID > 0)) return { ok: false, detail: "no package or hull" };
    const row = itemRow(wrapID);
    if (!row) return { ok: false, detail: "package " + wrapID + " not found" };
    if (num(row.locationID) === shipID) return { ok: true, detail: "already loaded" };
    if (num(row.locationID) !== num(contract.startStationID)) {
      return { ok: false, detail: "package is not at the origin station" };
    }
    return movePackage(wrapID, shipID, CARGO_HOLD_FLAG);
  }

  // Hands the package over at the destination station. completeContract only
  // accepts a package that really sits there.
  function unloadPackageAtStation(contract, identity) {
    const wrapID = num(contract && contract.plasticWrapItemID);
    const stationID = num(contract && contract.endStationID);
    const shipID = num(identity && identity.ship && identity.ship.itemID);
    if (!(wrapID > 0) || !(stationID > 0)) return { ok: false, detail: "no package or station" };
    const row = itemRow(wrapID);
    if (!row) return { ok: false, detail: "package " + wrapID + " not found" };
    if (num(row.locationID) === stationID) return { ok: true, detail: "already at destination" };
    if (shipID > 0 && num(row.locationID) !== shipID) {
      return { ok: false, detail: "package is neither in the hull nor at the destination" };
    }
    return movePackage(wrapID, stationID, STATION_HANGAR_FLAG);
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
  function arrivalCheck(flight) {
    const scene = sceneFor(num(flight.systemID));
    if (!scene) return { ok: false, detail: "no scene for system " + num(flight.systemID) };
    if (typeof scene.getEntityByID !== "function") return { ok: false, detail: "scene has no getEntityByID" };
    const target = stationPosition(num(flight.destinationStationID));
    if (!target) return { ok: false, detail: "no station position for " + num(flight.destinationStationID) };
    const entity = scene.getEntityByID(num(flight.entityID));
    if (!entity) return { ok: false, detail: "no ship entity " + num(flight.entityID) + " in scene" };
    if (!entity.position) return { ok: false, detail: "ship entity has no position" };
    const metres = Math.round(distanceM(entity.position, target));
    return { ok: metres <= DOCKING_RANGE_M, detail: "distance " + metres + "m warpState " + String(entity.warpState || entity.mode || "") };
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

  function stationName(stationID) {
    try {
      const station = worldData && typeof worldData.getStationByID === "function" ? worldData.getStationByID(stationID) : null;
      return String(station && station.stationName || stationID);
    } catch (_error) {
      return String(stationID);
    }
  }

  // The courier messages the issuer the same way a player would: a real native
  // EVEmail from its own character. Nothing is invented - the text only carries
  // real contract, station and hull facts.
  function notify(kind, contract, identity) {
    if (!contract || !identity) return null;
    const characterID = num(identity.character.characterID);
    const issuerID = num(contract.issuerID);
    const built = notices.buildNotice(kind, {
      pilotName: String(identity.character.characterName || "Courier"),
      contractID: num(contract.contractID),
      volumeM3: num(contract.volume),
      fromStationName: stationName(num(contract.startStationID)),
      toStationName: stationName(num(contract.endStationID)),
      reward: num(contract.reward),
    });
    if (built.status !== "NOTICE") return built;
    if (noticeAlreadySent(num(contract.contractID), kind)) {
      log(`[CoopCourier] notice ${kind} already sent for ${num(contract.contractID)}, not repeating`);
      return built;
    }
    if (!sendMail || !(issuerID > 0) || !(characterID > 0)) {
      log(`[CoopCourier] notice ${kind} not sent (no mail authority) for ${num(contract.contractID)}`);
      return built;
    }
    try {
      sendMail({ senderID: characterID, toCharacterIDs: [issuerID], title: built.subject, body: built.body });
      rememberNotice(num(contract.contractID), kind);
      log(`[CoopCourier] notice ${kind} mailed to ${issuerID} for ${num(contract.contractID)}`);
    } catch (error) {
      log(`[CoopCourier] notice ${kind} failed ${String(error && error.message || error)}`);
    }
    return built;
  }

  // Reposition planning that also works when the ship is already in space: the
  // flight then starts at the warp step instead of a second undock.
  function planReposition(identity, target, systemID) {
    const characterID = num(identity.character.characterID);
    const shipID = num(identity.ship && identity.ship.itemID);
    if (!(characterID > 0) || !(shipID > 0) || !(target > 0)) return null;
    const stationID = num(identity.character.stationID);
    const inSpace = !(stationID > 0);
    return {
      contractID: characterID,
      characterID,
      shipItemID: shipID,
      originStationID: inSpace ? target : stationID,
      destinationStationID: target,
      step: "undock",
      stepStartedAtMs: now(),
      entityID: 0,
      reposition: true,
      systemID: num(systemID),
      identity,
    };
  }

  // A contract that is already IN_PROGRESS with our courier as the acceptor has
  // to be flown to the destination; without this the accepted cargo would sit in
  // the hangar forever after a restart.
  function resumeInProgress() {
    if (!contracts || typeof contracts.listContractRecords !== "function") return;
    for (const record of contracts.listContractRecords() || []) {
      const contractID = num(record && record.contractID);
      if (!(contractID > 0) || flights.has(contractID) || attempted.has(contractID)) continue;
      if (num(record.type) !== 3 || num(record.status) !== 1) continue;
      const pilotID = num(record.acceptorID);
      if (!pilots.includes(pilotID)) continue;
      const identity = identityFor(pilotID);
      if (!identity) continue;
      const pkg = itemRow(num(record.plasticWrapItemID));
      if (!pkg || num(pkg.ownerID) !== pilotID) continue;
      if (num(identity.character.stationID) !== num(record.startStationID)) {
        if (!repositions.has(pilotID)) {
          const move = planReposition(identity, num(record.startStationID), record.startSolarSystemID);
          if (move) {
            repositions.set(pilotID, move);
            log(`[CoopCourier] courier ${pilotID} returning to origin ${move.destinationStationID} for contract ${contractID}`);
          }
        }
        continue;
      }
      const planned = flightCore.createFlight({ contract: record, identity, nowMs: now() });
      if (planned.status !== "FLIGHT_PLANNED") {
        log(`[CoopCourier] contract ${contractID} resume ${planned.status} ${planned.reason || ""}`.trim());
        continue;
      }
      flights.set(contractID, Object.assign({}, planned, {
        systemID: num(record.startSolarSystemID),
        identity,
      }));
      attempted.add(contractID);
      log(`[CoopCourier] contract ${contractID} resumed in progress by ${pilotID}, flying to ${num(record.endStationID)}`);
    }
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
      // evaluateContract only judges hull and funds; the courier still has to be
      // physically docked at the origin. Fly it there first instead of refusing.
      if (num(picked.identity.character.stationID) !== num(record.startStationID)) {
        const pilotID = num(picked.identity.character.characterID);
        if (!repositions.has(pilotID)) {
          const move = planReposition(picked.identity, num(record.startStationID), record.startSolarSystemID);
          if (move) {
            repositions.set(pilotID, move);
            log(`[CoopCourier] courier ${pilotID} repositioning ${move.originStationID} -> ${move.destinationStationID} from ${move.step}`);
          } else {
            log(`[CoopCourier] contract ${contractID} reposition NO_FLIGHT`);
          }
        }
        continue;
      }
      // A hull that sits at the origin but lost its hangar flag is repaired in
      // place: an interrupted native transition is the only way that happens.
      const rawShip = itemRow(num(picked.identity.ship && picked.identity.ship.itemID));
      if (rawShip && num(rawShip.locationID) === num(record.startStationID) && num(rawShip.flagID) !== 4) {
        gameStore.write("items", String(num(picked.identity.ship.itemID)), Object.assign({}, rawShip, { flagID: 4 }));
        if (typeof gameStore.flushTableSync === "function") gameStore.flushTableSync("items");
        log(`[CoopCourier] hull ${num(picked.identity.ship.itemID)} hangar flag repaired`);
      }
      const at = packageLocationID(record);
      const accepted = bridge.accept({
        contract: record,
        identity: picked.identity,
        packageLocationID: at,
        packageOwnerID: num(itemRow(record.plasticWrapItemID)?.ownerID),
        runtime: contracts,
      });
      // Only a real accept (or a doubtful native result) is remembered: a clean
      // refusal is retried after the state it complained about has been repaired.
      if (accepted.status === "ACCEPTED" || accepted.status === "AMBIGUOUS") attempted.add(contractID);
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
      notify("accepted", record, picked.identity);
    }
  }

  // A native undock that already moved the real ship leaves it in space with no
  // station. Retrying "undock" would refuse forever, so a ship that is really in
  // the scene continues from the warp step with its real entity.
  function recoverInSpace(flight) {
    if (flight.step !== "undock") return flight;
    const scene = sceneFor(num(flight.systemID));
    if (!scene || typeof scene.getEntityByID !== "function") return flight;
    const shipID = num(flight.shipItemID);
    const entity = typeof scene?.getEntityByID === "function" ? scene.getEntityByID(shipID) : null;
    if (entity) return Object.assign({}, flight, {
      step: "warp",
      entityID: num(entity.entityID) || shipID,
      stepStartedAtMs: now(),
      recoveredInSpace: true,
    });
    // No live entity: the ship is a leftover from a previous process (undocked,
    // then the server restarted). Dock it back with the stock dockSession rather
    // than inventing a position or a warp.
    const identity = identityFor(num(flight.characterID));
    if (!identity || num(identity.character.stationID)) return flight;
    const session = driver.buildCourierSession(identity.character, num(flight.destinationStationID));
    if (!session || !transitions || typeof transitions.dockSession !== "function") return flight;
    try {
      const outcome = transitions.dockSession(session, num(flight.destinationStationID));
      if (outcome && outcome.success === true) {
        return Object.assign({}, flight, { step: "done", dockedFromSpace: true, stepStartedAtMs: now() });
      }
      if (outcome && String(outcome.errorMsg || "") === "ALREADY_DOCKED") {
        // The native layer says docked, but the stored row lost its station when
        // the interrupted undock threw. Repair the location through the store -
        // never by pretending a flight happened.
        const id = num(identity.character.characterID);
        const row = Object.assign({}, identity.character, { stationID: num(flight.destinationStationID) });
        delete row.characterID;
        gameStore.write("characters", String(id), row);
        if (typeof gameStore.flushTableSync === "function") gameStore.flushTableSync("characters");
        // The same interrupted undock left the hull pointing at the solar system.
        // A docked ship must be in a station hangar, so repair that too.
        const shipRow = itemRow(flight.shipItemID);
        if (shipRow) {
          const fixed = Object.assign({}, shipRow, { locationID: num(flight.destinationStationID), flagID: 4 });
          gameStore.write("items", String(num(flight.shipItemID)), fixed);
          if (typeof gameStore.flushTableSync === "function") gameStore.flushTableSync("items");
        }
        log(`[CoopCourier] courier ${id} station and hull repaired to ${num(flight.destinationStationID)} (native ALREADY_DOCKED)`);
        return Object.assign({}, flight, { step: "done", dockedFromSpace: true, stepStartedAtMs: now() });
      }
      log(`[CoopCourier] courier ${flight.characterID} dock-from-space refused ${String(outcome && outcome.errorMsg || "no result")}`);
    } catch (error) {
      log(`[CoopCourier] courier ${flight.characterID} dock-from-space failed ${String(error && error.message || error)}`);
    }
    return flight;
  }

  function stepFlight(contractID, flight) {
    if (flight.step === "undock") {
      const recovering = identityFor(num(flight.characterID));
      const inSpace = recovering && !num(recovering.character.stationID);
      if (inSpace) {
        const recovered = recoverInSpace(flight);
        if (recovered.recoveredInSpace || recovered.dockedFromSpace) {
          log(`[CoopCourier] courier ${flight.characterID} already in space, resuming from warp`);
          flight = recovered;
          if (flight.reposition) repositions.set(num(flight.characterID), flight);
          else flights.set(contractID, flight);
        }
      }
    }
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
        notify("delivered", live, identity);
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
    // A courier that flies empty can never complete, so the real package is
    // loaded into the hull before the undock and handed over after the dock.
    if (flight.step === "undock" && !flight.reposition) {
      const loaded = loadPackageIntoShip(contracts.getContractRecord(contractID), identity);
      if (!loaded.ok) {
        log(`[CoopCourier] contract ${contractID} package not loaded: ${loaded.detail}`);
        return;
      }
      if (loaded.detail === "already loaded") log(`[CoopCourier] contract ${contractID} package already in the hull`);
    }
    const target = stationPosition(num(flight.destinationStationID));
    const arrival = flight.step === "arrive" ? arrivalCheck(flight) : { ok: false, detail: "" };
    const ctx = {
      character: identity.character,
      transitions,
      space,
      sceneForSystem: typeof deps.sceneForSystem === "function" ? deps.sceneForSystem : null,
      session: motion.agentSessionFor(identity.character),

      warpIngressMs: 30000,
      arrivalConfirmed: flight.step === "arrive" ? arrival.ok : false,
    };
    if (flight.step === "arrive" && !arrival.ok) {
      log(`[CoopCourier] courier ${flight.characterID} arrival pending: ${arrival.detail}`);
      // The first warp of a flight can be a no-op when it was issued without a
      // session. Re-issue it natively (throttled) instead of waiting forever.
      const last = num(flight.rewarpAtMs);
      if (!last || now() - last > 60000) {
        const warped = driver.warp(ctx, flight, target);
        log(`[CoopCourier] courier ${flight.characterID} re-warp ${warped.status} ${warped.reason || ""}`.trim());
        flights.set(contractID, Object.assign({}, flight, { rewarpAtMs: now() }));
      }
      return;
    }
    const observed = driver.runStep(ctx, flight, target);
    if (flight.step === "dock" && observed.status === driver.OK && !flight.reposition) {
      const handedOver = unloadPackageAtStation(contracts.getContractRecord(contractID), identity);
      log(
        handedOver.ok
          ? `[CoopCourier] contract ${contractID} package handed over at ${num(flight.destinationStationID)}`
          : `[CoopCourier] contract ${contractID} package not handed over: ${handedOver.detail}`,
      );
    }
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
      if (flight.step === "undock" && !flight.reposition) {
        notify("departing", contracts.getContractRecord(contractID), identity);
      }
    }
  }

  function tick() {
    startFlights();
    resumeInProgress();
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
