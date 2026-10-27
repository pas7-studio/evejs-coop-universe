"use strict";
/**
 * ALIFE-16. The refinery had no caller.
 *
 * integration/coopNpcRefinery.cjs (COOP-031) already does the real work: a native SDE
 * reprocessing quote, one atomic native item debit+credit, a durable journal. But nothing
 * in the server ever called it, so ore could never become minerals and the fleet's only
 * buyer stayed the finite seed-market book (measured: living-economy-destination
 * HOLD_NO_BUYER, unfilled 183 747).
 *
 * This is the caller. It never invents a quote, never waives a fee and never touches
 * stock the refinery has not proven: it lists only tagged warehouse ore in the
 * corporation's hangar, asks the refinery to refine it, and reports the honest status -
 * including NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED with the real ISK cost when the
 * station charges a fee (v1 of the refinery supports zero-fee quotes only).
 *
 * Default OFF (EVEJS_COOP_NPC_REFINERY=1 enables it, the same flag the runtime checks).
 */

const FLAG = "EVEJS_COOP_NPC_REFINERY";
const DIR_FLAG = "EVEJS_COOP_NPC_REFINERY_DIR";
const CORP_FLAG = "EVEJS_COOP_FACTORY_CORP_ID";
const DEFAULT_CORP_ID = 1000129;
const WAREHOUSE_TAG = /^coop-warehouse:v1:cargo:[0-9]+$/;
const THROTTLE_MS = 60_000;

const pos = (x) => {
  const n = Number(x);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

const lastNote = new Map();
const lastRun = new Map();

function note(options, event, fields) {
  try {
    const observe = options.observe || require("./coopObserve").observe;
    const probe = options.probe || require("./coopRuntimeProbe");
    observe(probe, event, {systemID: pos(fields.systemID) || 0}, fields);
  } catch (_error) { /* telemetry only */ }
}

function once(options, key, signature) {
  if (lastNote.get(key) === signature) return false;
  lastNote.set(key, signature);
  return true;
}

// Only the corporation's own tagged warehouse ore in the station hangar is a candidate:
// same invariant the refinery re-checks before it debits anything.
function candidates({items, ownerID, stationID, limit = 8}) {
  const rows = items.listOwnedItems(ownerID, {
    locationID: stationID,
    flagID: items.ITEM_FLAGS && items.ITEM_FLAGS.HANGAR,
  });
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    if (!pos(row && row.itemID) || !pos(row && row.typeID)) continue;
    if (!pos(row && row.quantity)) continue;
    if (Number(row.ownerID) !== ownerID) continue;
    if (Number(row.locationID) !== stationID) continue;
    if (!WAREHOUSE_TAG.test(String(row.customInfo || ""))) continue;
    out.push(row);
  }
  return out;
}

// Pay a real station fee from the corporation's own wallet and leave a durable
// receipt the refinery can verify by name. Never creates ISK: the debit is the source.
function payFee({gameStore, root, ownerID, stationID, oreItemID, amountISK, now, fsApi = fs}) {
  const amount = Math.round(Number(amountISK) * 100) / 100;
  if (!(amount > 0)) return {status: "FEE_INVALID"};
  const pointer = "/corporations/" + ownerID + "/wallet";
  const current = gameStore.read("corporationRuntime", pointer);
  const divisions = current && current.success === true && current.data && current.data.divisions;
  if (!divisions || typeof divisions !== "object") return {status: "CORP_WALLET_UNAVAILABLE"};
  const before = Number(divisions[1000] && divisions[1000].balance);
  if (!Number.isFinite(before) || before < 0) return {status: "CORP_WALLET_INVALID"};
  if (before < amount) return {status: "CORP_WALLET_INSUFFICIENT", iskCost: amount, balanceISK: before};
  const next = {divisions: {...divisions,
    [1000]: {...(divisions[1000] || {}), balance: Math.round((before - amount) * 100) / 100}}};
  const written = gameStore.write("corporationRuntime", pointer, next);
  if (!written || written.success !== true) return {status: "CORP_DEBIT_FAILED"};
  if (typeof gameStore.flushTableSync === "function") {
    const flushed = gameStore.flushTableSync("corporationRuntime", {log: false});
    if (!flushed || flushed.success !== true) return {status: "CORP_DEBIT_FLUSH_UNCERTAIN"};
  }
  const receiptID = pos(oreItemID);
  const receipt = {version: 1, status: "PAID", receiptID, amountISK: amount,
    corporationID: pos(ownerID), stationID: pos(stationID), oreItemID: receiptID,
    beforeISK: before, afterISK: Math.round((before - amount) * 100) / 100,
    at: Number(now) || Date.now()};
  try {
    const dir = require("node:path").join(root, "refinery-fees");
    fsApi.mkdirSync(dir, {recursive: true});
    const file = require("node:path").join(dir, receiptID + ".json");
    const tmp = file + ".tmp-" + process.pid;
    const fd = fsApi.openSync(tmp, "w", 0o600);
    try { fsApi.writeFileSync(fd, JSON.stringify(receipt)); fsApi.fsyncSync(fd); }
    finally { fsApi.closeSync(fd); }
    fsApi.renameSync(tmp, file);
  } catch (error) {
    return {status: "FEE_RECEIPT_UNWRITTEN", amountISK: amount};
  }
  return {status: "PAID", receipt};
}

/**
 * Refine the corporation's warehouse ore at one station. Returns a summary; never throws.
 */
function run(options = {}) {
  const env = options.env || process.env;
  if (String(env[FLAG] || "") !== "1") return {status: "DISABLED", refined: 0};
  const ownerID = pos(env[CORP_FLAG]) || DEFAULT_CORP_ID;
  const stationID = pos(options.stationID);
  if (!stationID) return {status: "NO_STATION", refined: 0};
  let refinery;
  try {
    const factory = options.refinery ||
      require("./coopNpcRefineryRuntime").createLiveRefinery({root: env[DIR_FLAG]});
    refinery = factory;
  } catch (error) {
    const reason = String(error && error.message || error).slice(0, 80);
    if (once(options, "refinery-init:" + stationID, reason))
      note(options, "living-npc-refinery-blocked", {systemID: options.systemID,
        ownerID, stationID, status: "REFINERY_UNAVAILABLE", reason});
    return {status: "REFINERY_UNAVAILABLE", reason, refined: 0};
  }
  const items = options.items || require("../services/inventory/itemStore");
  let rows;
  try {
    rows = candidates({items, ownerID, stationID, limit: 8});
  } catch (error) {
    return {status: "CANDIDATES_UNREADABLE", reason: String(error && error.message).slice(0, 80), refined: 0};
  }
  if (rows === null) return {status: "STOCK_UNREADABLE", refined: 0};
  if (!rows.length) return {status: "NO_WAREHOUSE_ORE", refined: 0};
  let refined = 0;
  const statuses = [];
  for (const row of rows) {
    let outcome;
    try {
      outcome = refinery.refine({oreItemID: Number(row.itemID), ownerID, stationID});
    } catch (error) {
      outcome = {status: "REFINERY_THROW", reason: String(error && error.message).slice(0, 80)};
    }
    const status = String(outcome && outcome.status || "UNKNOWN");
    statuses.push(status);
    if (status === "COMMITTED" || status === "ALREADY_COMMITTED") {
      refined += 1;
      const key = "refined:" + stationID + ":" + row.itemID;
      if (once(options, key, status)) {
        note(options, "living-npc-refined", {systemID: options.systemID,
          ownerID, stationID, status, oreItemID: Number(row.itemID),
          oreTypeID: Number(row.typeID), consumed: Number(row.quantity),
          minerals: Array.isArray(outcome.outputs) ? outcome.outputs.length : 0,
          operationID: String(outcome.operationID || "")});
      }
      continue;
    }
    // A fee is a real economic fact, not an error to swallow: report the exact cost.
    const key = "blocked:" + stationID + ":" + row.itemID + ":" + status;
    if (once(options, key, status + ":" + String(outcome && outcome.iskCost))) {
      note(options, "living-npc-refinery-blocked", {systemID: options.systemID,
        ownerID, stationID, status, oreItemID: Number(row.itemID),
        oreTypeID: Number(row.typeID), iskCost: outcome && outcome.iskCost !== undefined ? outcome.iskCost : null,
        reason: outcome && outcome.reason ? String(outcome.reason).slice(0, 90) : null});
    }
  }
  return {status: refined ? "REFINED" : "BLOCKED", refined, statuses};
}

// Called from the mining fleet tick: throttled, and only when the fleet knows a station.
function tick(options = {}) {
  const env = options.env || process.env;
  if (String(env[FLAG] || "") !== "1") return {status: "DISABLED"};
  const stationID = pos(options.stationID);
  const key = String(pos(options.systemID)) + ":" + stationID;
  const now = Number(options.now) || Date.now();
  const previous = lastRun.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) return {status: "THROTTLED"};
  lastRun.set(key, now);
  return run({...options, env, stationID});
}

function resetForTests() {
  lastNote.clear();
  lastRun.clear();
}

module.exports = {FLAG, DIR_FLAG, CORP_FLAG, DEFAULT_CORP_ID, THROTTLE_MS, WAREHOUSE_TAG,
  candidates, payFee, run, tick, resetForTests};
