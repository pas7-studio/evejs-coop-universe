"use strict";
/**
 * ALIFE-17. The corporation earns nothing while its pilots do.
 *
 * The NPC market credits a PILOT ledger (`<market root>/ledger.json`), so after three
 * live sales the fleet's pilots held 98 402 ISK while the owning corporation's wallet
 * stayed at 0 - and the refinery, which charges a real station fee
 * (measured 4 998-23 760 ISK per stack), could therefore never run. The ore is the
 * corporation's, so the proceeds belong to the corporation.
 *
 * This sweeps earned pilot ISK into the corporation's own wallet in the native
 * gameStore, with a durable receipt and a compensating write if the credit fails. It
 * never mints: every cent moved already exists in the pilot ledger, and the amount is
 * debited there in the same operation.
 *
 * Default OFF (EVEJS_COOP_CORP_TREASURY=1).
 */

const fs = require("node:fs");
const path = require("node:path");

const FLAG = "EVEJS_COOP_CORP_TREASURY";
const DIR_FLAG = "EVEJS_COOP_NPC_MARKET_DIR";
const CORPORATION_FLAG = "EVEJS_COOP_FACTORY_CORP_ID";
// Working capital that stays with the pilots. The treasury sweep used to zero every pilot after
// each sale, which left the manufacturer unable to buy the blueprint or the missing mineral it
// needs: the native trader pays for a purchase from the PILOT's earned balance, not from the
// corporation's wallet. A zero default keeps the old behaviour exactly; a positive value is an
// operator decision about how much cash the crew may keep to do its job.
const KEEP_FLAG = "EVEJS_COOP_TREASURY_KEEP_ISK";
const DEFAULT_CORP = 1000129;
const DIVISION = 1000;

const pos = (x) => {
  const n = Number(x);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const cents = (isk) => Math.round(Number(isk) * 100);

function loadWallet() {
  try {
    return require("./coopCorpWallet.cjs");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return require("./coopCorpWallet");
    throw error;
  }
}

function atomicWrite(file, value, fsApi) {
  fsApi.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = file + ".tmp-" + process.pid;
  const fd = fsApi.openSync(tmp, "w", 0o600);
  try { fsApi.writeFileSync(fd, JSON.stringify(value)); fsApi.fsyncSync(fd); }
  finally { fsApi.closeSync(fd); }
  fsApi.renameSync(tmp, file);
}

// Read the pilot ledger without touching it: balances are cents-precise ISK.
function pilotEarnings(ledger) {
  const out = [];
  const pilots = ledger && ledger.pilots && typeof ledger.pilots === "object" ? ledger.pilots : {};
  for (const [pilotID, record] of Object.entries(pilots)) {
    const value = Number(record && record.balance);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({pilotID, isk: Math.round(value * 100) / 100});
  }
  return out.sort((a, b) => b.isk - a.isk || String(a.pilotID).localeCompare(String(b.pilotID)));
}

function walletOf(record) {
  const divisions = record && record.divisions && typeof record.divisions === "object" ? record.divisions : null;
  return divisions;
}

function run(options = {}) {
  const env = options.env || process.env;
  if (String(env[FLAG] || "") !== "1") return {status: "DISABLED", moved: 0};
  const fsApi = options.fsApi || fs;
  const root = options.root || env[DIR_FLAG];
  if (typeof root !== "string" || !path.isAbsolute(root)) return {status: "MARKET_DIRECTORY_REQUIRED", moved: 0};
  const corporationID = pos(options.corporationID) || pos(env[CORPORATION_FLAG]) || DEFAULT_CORP;
  // FW-040: a pilot's earned ISK belongs to the pilot's OWN corporation. When the
  // caller can prove a pilot's corporation, only the pilots that really belong to
  // this corporation are swept - otherwise an Angel pilot's real sale would fund
  // an ORE factory, which is exactly why an armed faction never showed income.
  const resolveCorporation = typeof options.resolveCorporation === "function"
    ? options.resolveCorporation : null;
  const ledgerFile = path.join(root, "ledger.json");
  let ledger;
  try { ledger = JSON.parse(fsApi.readFileSync(ledgerFile, "utf8")); }
  catch (error) {
    return {status: error && error.code === "ENOENT" ? "NO_LEDGER" : "LEDGER_UNREADABLE", moved: 0};
  }
  const allEarnings = pilotEarnings(ledger);
  let skippedForeign = 0;
  const earnings = resolveCorporation
    ? allEarnings.filter((entry) => {
      let owner = 0;
      try { owner = Number(resolveCorporation(entry.pilotID)) || 0; }
      catch (_error) { owner = 0; }
      // An unknown owner is never swept: unproven ISK must not move.
      if (owner !== Number(corporationID)) { skippedForeign += 1; return false; }
      return true;
    })
    : allEarnings;
  if (!earnings.length)
    return {status: skippedForeign ? "NO_EARNINGS_FOR_THIS_CORPORATION" : "NO_PILOT_EARNINGS",
      moved: 0, skippedForeign};
  // Only the part above the pilot's float moves: a crew with no ISK cannot buy the blueprint or
  // the mineral the factory is short of, and the native trader pays from the pilot's balance.
  const keep = Math.max(0, Number(env[KEEP_FLAG] || 0) || 0);
  const sweepable = keep > 0
    ? earnings.map((entry) => ({...entry, isk: Math.round(Math.max(0, entry.isk - keep) * 100) / 100}))
      .filter((entry) => entry.isk > 0)
    : earnings;
  if (!sweepable.length)
    return {status: "PILOT_FLOAT_HELD", moved: 0, keepISK: keep,
      heldISK: Math.round(earnings.reduce((sum, entry) => sum + cents(entry.isk), 0)) / 100};
  const total = Math.round(sweepable.reduce((sum, entry) => sum + cents(entry.isk), 0)) / 100;
  if (!(total > 0)) return {status: "NO_PILOT_EARNINGS", moved: 0};

  const gameStore = options.gameStore || require("../gameStore");
  // The corporation's wallet is owned by the native corporation runtime. Reading it as a
  // raw store pointer reported CORP_WALLET_UNAVAILABLE forever on a world whose runtime
  // table had never been bootstrapped, while the pilots really held earned ISK.
  const wallet = loadWallet().readWallet({corporationState: options.corporationState,
    gameStore, corporationID});
  if (wallet.status !== "OK")
    return {status: wallet.status, moved: 0, reason: wallet.reason || ""};
  const divisions = wallet.divisions;
  const before = Number(divisions[DIVISION] && divisions[DIVISION].balance);
  if (!Number.isFinite(before) || before < 0) return {status: "CORP_WALLET_INVALID", moved: 0};

  // Debit the pilots first: if the credit then fails we put every cent back, so ISK can
  // never be lost or created by a half-applied sweep.
  const debited = ledger.pilots;
  const originals = new Map();
  for (const entry of sweepable) {
    const record = debited[entry.pilotID] || {};
    originals.set(entry.pilotID, record);
    const held = Math.max(0, Number(record.balance) - Number(entry.isk));
    debited[entry.pilotID] = {...record, balance: Math.round(held * 100) / 100,
      lastCorpSweepAt: Number(options.now) || Date.now()};
  }
  try { atomicWrite(ledgerFile, ledger, fsApi); }
  catch (error) { return {status: "LEDGER_WRITE_FAILED", moved: 0, reason: String(error && error.message).slice(0, 80)}; }

  const written = loadWallet().applyDelta({corporationState: options.corporationState,
    gameStore, corporationID, division: DIVISION, delta: total});
  if (!written || written.status !== "OK") {
    // Put the exact pre-sweep record back on every swept pilot: with a float in play, "the swept
    // amount" is no longer the pilot's whole balance.
    for (const [pilotID, record] of originals) debited[pilotID] = record;
    try { atomicWrite(ledgerFile, ledger, fsApi); } catch (_error) { /* reported below */ }
    return {status: String((written && written.status) || "CORP_CREDIT_FAILED"), moved: 0,
      reason: String((written && (written.reason || written.status)) || "UNKNOWN").slice(0, 80)};
  }
  const after = Number.isFinite(Number(written.balance))
    ? Number(written.balance)
    : Math.round((before + total) * 100) / 100;
  if (typeof gameStore.flushTableSync === "function") {
    const flushed = gameStore.flushTableSync("corporationRuntime", {log: false});
    if (!flushed || flushed.success !== true) return {status: "CORP_FLUSH_UNCERTAIN", moved: total};
  }
  const receipt = {version: 1, status: "SWEPT", corporationID, division: DIVISION,
    amountISK: total, beforeISK: before, afterISK: after,
    pilots: earnings, at: Number(options.now) || Date.now()};
  try {
    atomicWrite(path.join(root, "corp-treasury", corporationID + ".json"), receipt, fsApi);
  } catch (_error) { /* the money already moved; the ledger is the authority */ }
  try {
    const observe = options.observe || require("./coopObserve").observe;
    const probe = options.probe || require("./coopRuntimeProbe");
    observe(probe, "living-npc-corp-wallet-funded", {systemID: 0}, {
      corporationID, amountISK: total, beforeISK: before, afterISK: receipt.afterISK,
      pilots: earnings.length});
  } catch (_error) { /* telemetry only */ }
  return {status: "SWEPT", moved: total, corporationID, afterISK: receipt.afterISK,
    pilots: earnings.length, skippedForeign};
}

module.exports = {FLAG, DIR_FLAG, CORPORATION_FLAG, DEFAULT_CORP, DIVISION, pilotEarnings, run};
