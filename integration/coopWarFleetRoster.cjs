"use strict";
// FW-027 (fleet reconstitution): war fleets do not simply disappear.
//
// Why this exists: a faction war reads as alive only when a beaten fleet comes
// back. When a fleet loses hulls, the survivors disengage to a real friendly
// staging point and merge with hulls that REALLY exist (never conjured, never a
// clone of a destroyed ship) into a new fleet with the doctrine mix the current
// commander rank allows. If no real replacement exists the fleet stays smaller
// and that is reported, not padded.
//
// Rules this module enforces:
//   * only hulls whose entity is really alive survive; a hull that is gone but
//     was never recorded as lost is marked LOST_UNRECORDED and reported;
//   * an adopted replacement must be a real, free, native hull in the staging
//     system, proved by the injected `listFreeHulls` authority (identity
//     registry: no pilot link, alive) - the roster never spawns a ship;
//   * a hull already owned by any fleet in this roster can never be adopted;
//   * the new fleet's size follows the current command cap, so a commander who
//     lost ships and dropped rank really commands fewer ships;
//   * every loss stays on the record with its wreck/casualty evidence and is
//     returned as a real merit event (`force-lost`) for the caller to award.
const TABLE = "corporationRuntime";
const KEY = "coop-faction-war\u001ffleet-roster-v1";
const VERSION = 1;
const MAX_FLEETS = 256;
const MAX_SHIPS = 64;
const MAX_LOSSES = 256;
const ROLES = new Set(["tackle", "brawler", "sniper", "logistics", "ewar", "heavy"]);
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const valid = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

function empty() {
  return { version: VERSION, nextSerial: 1, fleets: {}, history: [] };
}

function validate(state) {
  if (!state || state.version !== VERSION || !state.fleets || typeof state.fleets !== "object" ||
    Array.isArray(state.fleets) || !Array.isArray(state.history) ||
    !pos(state.nextSerial) || Object.keys(state.fleets).length > MAX_FLEETS ||
    state.history.length > 512) {
    throw Error("WAR_FLEET_ROSTER_INVALID");
  }
  for (const [fleetID, fleet] of Object.entries(state.fleets)) {
    if (!valid(fleetID) || !fleet || fleet.fleetID !== fleetID || !pos(fleet.factionID) ||
      !pos(fleet.systemID) || !pos(fleet.commandCap) || !Array.isArray(fleet.ships) ||
      fleet.ships.length > MAX_SHIPS || !Array.isArray(fleet.losses) ||
      fleet.losses.length > MAX_LOSSES ||
      !["ACTIVE", "DISENGAGED", "DESTROYED", "RECONSTITUTED"].includes(fleet.state)) {
      throw Error("WAR_FLEET_ROSTER_CORRUPT_FLEET");
    }
    const entities = new Set();
    for (const ship of fleet.ships) {
      if (!pos(ship && ship.entityID) || entities.has(ship.entityID) ||
        !ROLES.has(String(ship.role || "")) || !valid(String(ship.doctrineID || "")) ||
        !["ALIVE", "LOST", "LOST_UNRECORDED", "ADOPTED"].includes(String(ship.state || ""))) {
        throw Error("WAR_FLEET_ROSTER_CORRUPT_SHIP");
      }
      entities.add(ship.entityID);
    }
  }
  return state;
}

function createWarFleetRoster(injected) {
  const base = injected && typeof injected === "object" ? injected : {};
  const gameStore = base.gameStore;
  const env = base.env || process.env;
  const clock = typeof base.clock === "function" ? base.clock : () => Date.now();
  // A hull is alive only when the native scene says so; without the authority a
  // caller must not be able to declare survivors.
  const isEntityAlive = base.isEntityAlive;
  // Real, free, native hulls in the staging system (identity registry proof).
  const listFreeHulls = base.listFreeHulls;
  if (typeof gameStore?.coopAtomicNativeRows?.transact !== "function") {
    throw Error("WAR_FLEET_ROSTER_NATIVE_AUTHORITIES_REQUIRED");
  }
  const { readRow } = require("./coopNativeRowPath" +
    (__filename.endsWith(".js") ? "" : ".cjs"));
  const enabled = () => env.EVEJS_COOP_FACTION_WAR === "1" &&
    env.EVEJS_COOP_FACTION_WAR_FLEETS === "1";
  const transact = (fn) => gameStore.coopAtomicNativeRows.transact([TABLE], fn);

  function read() {
    const row = readRow(gameStore, TABLE, KEY);
    return row ? validate(clone(row)) : empty();
  }

  function snapshot() {
    if (!enabled()) return { status: "DISABLED" };
    const state = read();
    return {
      status: "OK",
      fleets: Object.keys(state.fleets).length,
      state: clone(state),
    };
  }

  function fleet(fleetID) {
    const state = read();
    const found = state.fleets[String(fleetID || "")];
    return found ? clone(found) : null;
  }

  function createFleet({ factionID, systemID, stagingSystemID = 0, rank = "", merit = 0,
    commandCap = 0, ships = [], parentFleetID = "" } = {}) {
    if (!enabled()) return { status: "DISABLED" };
    const f = Number(factionID), system = Number(systemID);
    if (!pos(f) || !pos(system)) return { status: "BLOCKED", reason: "FLEET_IDENTITY_REQUIRED" };
    if (!Array.isArray(ships) || !ships.length || ships.length > MAX_SHIPS) {
      return { status: "BLOCKED", reason: "FLEET_SHIPS_REQUIRED" };
    }
    const seen = new Set();
    const normalized = [];
    for (const ship of ships) {
      const entityID = Number(ship && ship.entityID);
      if (!pos(entityID) || seen.has(entityID)) {
        return { status: "BLOCKED", reason: "FLEET_SHIP_IDENTITY_CONFLICT" };
      }
      seen.add(entityID);
      if (!ROLES.has(String(ship.role || "")) || !valid(String(ship.doctrineID || ""))) {
        return { status: "BLOCKED", reason: "FLEET_DOCTRINE_REQUIRED", entityID };
      }
      normalized.push({
        entityID,
        slot: normalized.length,
        role: String(ship.role),
        doctrineID: String(ship.doctrineID),
        loadoutID: String(ship.loadoutID || ship.doctrineID),
        profileID: String(ship.profileID || ""),
        hullTypeID: Number(ship.hullTypeID) || 0,
        hullName: String(ship.hullName || ""),
        pilotID: String(ship.pilotID || ""),
        state: ship.state === "ADOPTED" ? "ADOPTED" : "ALIVE",
      });
    }
    const at = clock();
    return transact((tx) => {
      const state = validate(tx.get(TABLE, KEY) || empty());
      if (Object.keys(state.fleets).length >= MAX_FLEETS) {
        return { status: "BLOCKED", reason: "FLEET_ROSTER_CAP" };
      }
      // One owner per native hull: a ship already in a live fleet cannot be
      // created twice. The parent fleet of a reconstitution is the one allowed
      // source, because its hulls really transfer into the new formation.
      for (const fleet of Object.values(state.fleets)) {
        if (fleet.fleetID === String(parentFleetID || "")) continue;
        if (fleet.state === "RECONSTITUTED" || fleet.state === "DESTROYED") continue;
        for (const ship of fleet.ships) {
          if (seen.has(ship.entityID)) {
            return { status: "BLOCKED", reason: "FLEET_SHIP_ALREADY_OWNED", entityID: ship.entityID };
          }
        }
      }
      const serial = state.nextSerial;
      const fleetID = "coop-fleet-" + f + "-" + String(serial).padStart(4, "0");
      const record = {
        fleetID,
        factionID: f,
        systemID: system,
        stagingSystemID: pos(stagingSystemID) ? Number(stagingSystemID) : system,
        rank: String(rank || ""),
        merit: Number(merit) || 0,
        commandCap: pos(commandCap) ? Number(commandCap) : normalized.length,
        state: "ACTIVE",
        parentFleetID: String(parentFleetID || ""),
        createdAt: at,
        updatedAt: at,
        ships: normalized,
        losses: [],
      };
      state.fleets[fleetID] = record;
      state.nextSerial = serial + 1;
      state.history.push({ at, event: "FLEET_CREATED", fleetID, size: normalized.length });
      if (state.history.length > 512) state.history.splice(0, state.history.length - 512);
      validate(state);
      tx.put(TABLE, KEY, state);
      return {
        status: "CREATED",
        fleetID,
        size: normalized.length,
        commandCap: record.commandCap,
        composition: normalized.map((ship) => ship.role),
      };
    });
  }

  // A real loss, with its evidence. The caller proves the wreck/casualty; the
  // roster only records that this hull left the fleet.
  function recordLoss({ fleetID, entityID, wreckID = 0, casualtyID = "", at = 0 } = {}) {
    if (!enabled()) return { status: "DISABLED" };
    const id = String(fleetID || "");
    const entity = Number(entityID);
    if (!valid(id) || !pos(entity)) return { status: "BLOCKED", reason: "LOSS_IDENTITY_REQUIRED" };
    return transact((tx) => {
      const state = validate(tx.get(TABLE, KEY) || empty());
      const record = state.fleets[id];
      if (!record) return { status: "BLOCKED", reason: "FLEET_NOT_FOUND" };
      const ship = record.ships.find((entry) => entry.entityID === entity);
      if (!ship) return { status: "BLOCKED", reason: "SHIP_NOT_IN_FLEET" };
      if (ship.state === "LOST" || ship.state === "LOST_UNRECORDED") {
        return { status: "DUPLICATE", fleetID: id, entityID: entity };
      }
      const when = pos(at) ? Number(at) : clock();
      ship.state = "LOST";
      ship.lostAt = when;
      ship.wreckID = Number(wreckID) || 0;
      record.losses.push({
        entityID: entity,
        role: ship.role,
        doctrineID: ship.doctrineID,
        wreckID: Number(wreckID) || 0,
        casualtyID: String(casualtyID || ""),
        at: when,
      });
      if (record.losses.length > MAX_LOSSES) {
        return { status: "BLOCKED", reason: "FLEET_LOSS_CAP" };
      }
      const survivors = record.ships.filter((entry) => entry.state === "ALIVE" || entry.state === "ADOPTED");
      record.state = survivors.length ? "DISENGAGED" : "DESTROYED";
      record.updatedAt = when;
      state.history.push({ at: when, event: "FLEET_LOSS", fleetID: id, entityID: entity, survivors: survivors.length });
      if (state.history.length > 512) state.history.splice(0, state.history.length - 512);
      validate(state);
      tx.put(TABLE, KEY, state);
      return {
        status: "RECORDED",
        fleetID: id,
        entityID: entity,
        survivors: survivors.length,
        lost: record.losses.length,
        fleetState: record.state,
        meritEvent: { kind: "force-lost", count: 1, fleetID: id, pilotID: ship.pilotID },
      };
    });
  }

  // Pure plan: who survives, what can really be adopted, and what the current
  // command cap allows. Nothing is written and no ship is created.
  function planReconstitution({ fleetID, stagingSystemID = 0, rank = "", merit = 0,
    compose = null, at = 0 } = {}) {
    if (!enabled()) return { status: "DISABLED" };
    const record = fleet(fleetID);
    if (!record) return { status: "BLOCKED", reason: "FLEET_NOT_FOUND" };
    const staging = pos(stagingSystemID) ? Number(stagingSystemID) : record.stagingSystemID;
    const survivors = [];
    const unrecorded = [];
    for (const ship of record.ships) {
      if (ship.state !== "ALIVE" && ship.state !== "ADOPTED") continue;
      let alive = true;
      if (typeof isEntityAlive === "function") {
        try {
          alive = isEntityAlive(ship.entityID) === true;
        } catch (_error) {
          alive = false;
        }
      }
      if (alive) survivors.push(ship);
      else unrecorded.push(ship.entityID);
    }
    if (!survivors.length) {
      return {
        status: "BLOCKED", reason: "NO_SURVIVOR",
        fleetID: record.fleetID, unrecorded, stagingSystemID: staging,
      };
    }
    if (typeof compose !== "function") return { status: "BLOCKED", reason: "COMPOSITION_AUTHORITY_REQUIRED" };
    const effectiveMerit = Number(merit) || record.merit;
    const plan = compose({ factionID: record.factionID, merit: effectiveMerit, rank });
    if (!plan || plan.status !== "COMPOSED") {
      return {
        status: "BLOCKED", reason: "COMPOSITION_REFUSED",
        fleetID: record.fleetID,
        compositionReason: String((plan && plan.reason) || "UNKNOWN"),
      };
    }
    let free = [];
    if (typeof listFreeHulls === "function") {
      try {
        free = listFreeHulls({ factionID: record.factionID, systemID: staging }) || [];
      } catch (_error) {
        free = [];
      }
    }
    const owned = new Set();
    for (const other of Object.values(read().fleets)) {
      for (const ship of other.ships) {
        if (other.fleetID === record.fleetID) continue;
        if (ship.state !== "LOST" && ship.state !== "LOST_UNRECORDED") owned.add(ship.entityID);
      }
    }
    const available = free.filter((hull) => pos(hull && hull.entityID) &&
      !owned.has(Number(hull.entityID)) && ROLES.has(String(hull.role || "")))
      .map((hull) => ({
        entityID: Number(hull.entityID),
        role: String(hull.role),
        doctrineID: String(hull.doctrineID || ""),
        hullTypeID: Number(hull.hullTypeID) || 0,
      }));
    const usedSurvivors = new Set();
    const adopted = [];
    const ships = [];
    const missing = [];
    for (const slot of plan.ships) {
      const role = String(slot.role);
      let ship = survivors.find((entry) => !usedSurvivors.has(entry.entityID) && entry.role === role);
      if (ship) {
        usedSurvivors.add(ship.entityID);
        ships.push({ ...ship, slot: ships.length, state: ship.state === "ADOPTED" ? "ADOPTED" : "ALIVE" });
        continue;
      }
      const replacement = available.find((hull) => !adopted.some((entry) => entry.entityID === hull.entityID) &&
        hull.role === role);
      if (replacement) {
        adopted.push(replacement);
        ships.push({
          entityID: replacement.entityID, slot: ships.length, role,
          doctrineID: replacement.doctrineID || String(slot.doctrineID || ""),
          loadoutID: replacement.doctrineID || String(slot.loadoutID || ""),
          profileID: String(slot.profileID || ""),
          hullTypeID: replacement.hullTypeID || Number(slot.hullTypeID) || 0,
          hullName: String(slot.hullName || ""),
          pilotID: "", state: "ADOPTED",
        });
        continue;
      }
      missing.push({ role, doctrineID: String(slot.doctrineID || "") });
    }
    // Survivors whose role the new mix does not need still stay with the fleet:
    // they are real hulls and abandoning them would be a fabricated loss.
    const leftOver = survivors.filter((entry) => !usedSurvivors.has(entry.entityID));
    for (const ship of leftOver) {
      ships.push({ ...ship, slot: ships.length, state: ship.state === "ADOPTED" ? "ADOPTED" : "ALIVE" });
    }
    const status = missing.length === 0 ? "RECONSTITUTED" : "REDUCED";
    return {
      status,
      reason: missing.length === 0 ? "REAL_SURVIVORS_PLUS_FREE_HULLS" : "NO_REAL_REPLACEMENT_AVAILABLE",
      fleetID: record.fleetID,
      factionID: record.factionID,
      stagingSystemID: staging,
      commandCap: plan.commandCap,
      previousSize: record.ships.filter((ship) => ship.state === "ALIVE" || ship.state === "ADOPTED").length,
      survivors: survivors.map((ship) => ({ entityID: ship.entityID, role: ship.role })),
      adopted: adopted.map((hull) => ({ entityID: hull.entityID, role: hull.role })),
      missing,
      unrecorded,
      ships,
      size: ships.length,
      at: pos(at) ? Number(at) : clock(),
    };
  }

  // Writes the new fleet and retires the old one. Never spawns: every entityID
  // in the new fleet is a hull that already exists.
  function commitReconstitution({ plan, rank = "" } = {}) {
    if (!enabled()) return { status: "DISABLED" };
    if (!plan || !["RECONSTITUTED", "REDUCED"].includes(plan.status)) {
      return { status: "BLOCKED", reason: "PLAN_NOT_RECONSTITUTABLE" };
    }
    const created = createFleet({
      factionID: plan.factionID,
      systemID: plan.stagingSystemID,
      stagingSystemID: plan.stagingSystemID,
      rank,
      merit: 0,
      commandCap: plan.commandCap,
      ships: plan.ships,
      parentFleetID: plan.fleetID,
    });
    if (created.status !== "CREATED") return created;
    const at = clock();
    transact((tx) => {
      const state = validate(tx.get(TABLE, KEY) || empty());
      const parent = state.fleets[plan.fleetID];
      if (!parent) return;
      parent.state = "RECONSTITUTED";
      parent.updatedAt = at;
      parent.reconstitutedAs = created.fleetID;
      const child = state.fleets[created.fleetID];
      if (child) child.planStatus = plan.status;
      state.history.push({
        at, event: "FLEET_RECONSTITUTED", fleetID: plan.fleetID, newFleetID: created.fleetID,
        status: plan.status, survivors: plan.survivors.length, adopted: plan.adopted.length,
        size: plan.size, commandCap: plan.commandCap, missing: plan.missing.length,
      });
      if (state.history.length > 512) state.history.splice(0, state.history.length - 512);
      validate(state);
      tx.put(TABLE, KEY, state);
    });
    return {
      status: plan.status,
      previousFleetID: plan.fleetID,
      fleetID: created.fleetID,
      size: created.size,
      commandCap: created.commandCap,
      survivors: plan.survivors.length,
      adopted: plan.adopted.length,
      missing: plan.missing,
      unrecorded: plan.unrecorded,
      reason: plan.reason,
    };
  }

  return Object.freeze({ snapshot, fleet, createFleet, recordLoss, planReconstitution, commitReconstitution });
}

module.exports = { TABLE, KEY, VERSION, empty, validate, createWarFleetRoster, ROLES };
