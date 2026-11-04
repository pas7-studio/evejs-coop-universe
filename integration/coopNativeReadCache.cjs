"use strict";
// Short-lived read cache over the native NPC store.
//
// Why: `nativeNpcStore.getNativeEntity(id)` / `listNativeCargo(...)` re-read and
// deep-clone the WHOLE collection on every call, so a caller that walks pairs or
// fleets paid one full clone per entity. A live V8 profile of the running server
// put 23% of wall time in coopWarCombatAuthority.evaluatePair -> getNativeEntity,
// 5.5% in coopHaulCargoAdoption -> listNativeCargo and 3.4% in
// coopNativeMiningFleetDurable.check -> getNativeEntity.
//
// What is cached is identity/facts that do not change inside a tick (entityID,
// corporationID, systemID, cargo rows), never HP, position or a combat verdict:
// those still come from the caller and from the live controller. The TTL bounds
// staleness to one think interval.
//
// Invalidation: every write through nativeNpcStore drops the cache (see
// invalidateCoopReadCache), so this TTL is only a backstop for a write path that
// does not go through that store. It used to be 200 ms because the TTL was the
// ONLY freshness mechanism, which meant rebuilding two ~8500-row indexes five
// times a second for no reason.
const DEFAULT_TTL_MS = Number(process.env.EVEJS_COOP_NATIVE_CACHE_TTL_MS || 2000);

function createCache({ listNativeEntities, listNativeCargo, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  let entityIndex = null;
  let entityAt = 0;
  let cargoIndex = null;
  let cargoAt = 0;
  let flatCargo = [];
  let haulIndex = null;
  let cargoIDCounts = null;
  const stats = { entityBuilds: 0, cargoBuilds: 0, entityHits: 0, entityMisses: 0, cargoHits: 0, cargoMisses: 0 };

  function invalidate() {
    haulIndex = null;
    cargoIDCounts = null;
    entityIndex = null;
    cargoIndex = null;
    flatCargo = [];
    entityAt = 0;
    cargoAt = 0;
  }

  function allCargoRows() {
    cargoAll();
    return flatCargo;
  }

  function entities() {
    if (!entityIndex || now() - entityAt > ttlMs) {
      const rows = typeof listNativeEntities === "function" ? listNativeEntities() : [];
      entityIndex = new Map();
      for (const raw of rows || []) {
        // Shallow copy: the cache hands these rows to read-only callers (war
        // combat, mining, materialization) and a deep clone of all ~8500 entity
        // rows per 200 ms window dominated the process CPU.
        const row = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : raw;
        // `listNativeEntities()` publishes the id as `entityID`; only the
        // per-entity read uses `itemID`. Indexing on `itemID` alone made every
        // lookup a miss, so `evaluatePair` answered NATIVE_STORE_IDENTITY_MISMATCH
        // for every war pair and no hostile engagement was ever authorised.
        const id = Number(row && (row.itemID ?? row.entityID));
        if (id > 0) entityIndex.set(id, row);
      }
      entityAt = now();
      stats.entityBuilds += 1;
    }
    return entityIndex;
  }

  function entityByID(id) {
    const key = Number(id);
    if (!(key > 0)) return null;
    const hit = entities().get(key) || null;
    if (hit) stats.entityHits += 1;
    else stats.entityMisses += 1;
    return hit;
  }

  function cargoAll() {
    if (!cargoIndex || now() - cargoAt > ttlMs) {
      const rows = typeof listNativeCargo === "function" ? listNativeCargo() : [];
      cargoIndex = new Map();
      // One shallow copy per row is enough: these rows are handed to read-only
      // planners that already treat them as immutable, and a deep clone of the
      // whole cargo table per cache window was measured at 3.8 s / 60 s.
      flatCargo = (Array.isArray(rows) ? rows : [])
        .map((row) => (row && typeof row === "object" && !Array.isArray(row) ? { ...row } : row));
      // Two extra indexes, built in the same single pass:
      //  - haul rows by system+fleet, so the haul planner visits only its own
      //    tagged rows instead of every cargo row on every mining tick;
      //  - cargoID multiplicity, which that planner needs to refuse a duplicate
      //    original cargoID without rescanning the table.
      haulIndex = new Map();
      cargoIDCounts = new Map();
      for (const row of flatCargo) {
        const owner = Number(row && (row.entityID ?? row.shipID ?? row.ownerID));
        if (owner > 0) {
          if (!cargoIndex.has(owner)) cargoIndex.set(owner, []);
          cargoIndex.get(owner).push(row);
        }
        const cargoID = Number(row && row.cargoID);
        if (cargoID > 0) cargoIDCounts.set(cargoID, (cargoIDCounts.get(cargoID) || 0) + 1);
        const haulSystem = Number(row && row.coopHaulSystemID);
        const haulFleet = Number(row && row.coopHaulFleetID);
        if (haulSystem > 0 && haulFleet > 0) {
          const key = haulSystem + ":" + haulFleet;
          if (!haulIndex.has(key)) haulIndex.set(key, []);
          haulIndex.get(key).push(row);
        }
      }
      cargoAt = now();
      stats.cargoBuilds += 1;
    }
    return cargoIndex;
  }

  // Rows this exact fleet slot tagged for hauling. Read-only, same lifetime as
  // the rest of the cargo window.
  function haulRows(systemID, fleetID) {
    cargoAll();
    const system = Number(systemID);
    const fleet = Number(fleetID);
    if (!(system > 0) || !(fleet > 0)) return [];
    return haulIndex.get(system + ":" + fleet) || [];
  }

  function cargoIDCount(cargoID) {
    cargoAll();
    const id = Number(cargoID);
    return id > 0 ? (cargoIDCounts.get(id) || 0) : 0;
  }

  function cargoForEntity(id) {
    const key = Number(id);
    if (!(key > 0)) return [];
    const hit = cargoAll().get(key);
    if (hit) stats.cargoHits += 1;
    else stats.cargoMisses += 1;
    return hit || [];
  }

  function snapshot() {
    return { ...stats, ttlMs, entityCount: entityIndex ? entityIndex.size : 0, cargoOwners: cargoIndex ? cargoIndex.size : 0 };
  }

  return Object.freeze({ entityByID, cargoForEntity, allCargoRows, haulRows, cargoIDCount, invalidate, snapshot });
}

let singleton = null;
function nativeCache() {
  if (!singleton) {
    // The cache is an optimisation, never the authority: the caller still holds
    // the store it proves against, and every miss falls back to it. When the
    // native store is not installed at all (a sandbox that only mirrors this
    // module, a partially deployed tree) an empty cache makes every lookup miss
    // instead of throwing a cache error the caller reports as operator repair.
    let store = null;
    try { store = require("./npc/nativeNpcStore"); } catch (_error) { store = null; }
    singleton = createCache({
      // Prefer the non-cloning enumerations: the cache shallow-copies each row
      // itself, so a deep clone of the whole table per window is pure waste.
      listNativeEntities: () => (
        store
          ? (typeof store.peekNativeEntities === "function"
            ? store.peekNativeEntities()
            : (typeof store.listNativeEntities === "function" ? store.listNativeEntities() : []))
          : []
      ),
      listNativeCargo: () => (
        store
          ? (typeof store.peekNativeCargo === "function"
            ? store.peekNativeCargo()
            : (typeof store.listNativeCargo === "function" ? store.listNativeCargo() : []))
          : []
      ),
    });
  }
  return singleton;
}

module.exports = { createCache, nativeCache };
