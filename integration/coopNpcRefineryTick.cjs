"use strict";
// L7-D: the fee path is bounded by a durable budget. This module owns the commitments, never the
// wallet, and never a second ledger of money.
const budgetApi = require("./coopRefineryBudget");
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

// The refinery names its operation "coop-refine:v1:<itemID>:<quantity>" and that name is the only
// thing that makes a fee idempotent, so the key is taken from the refinery itself, never retyped.
function refineKeyFor(itemID, quantity) {
  try {
    return require("./coopNpcRefinery").keyFor(itemID, quantity);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND")
      return require("./coopNpcRefinery.cjs").keyFor(itemID, quantity);
    throw error;
  }
}

const FLAG = "EVEJS_COOP_NPC_REFINERY";
// The corporation earns whenever its pilots trade, and that has nothing to do with ore.
// The sweep lived only inside the refinery path, so with the refinery off (its default) a
// pilot could earn millions and the corporation stayed at zero - measured 2026-11-05,
// coop-pilot-101 held 1 387 521 ISK of real sale proceeds while corp 1000129 held 2 624.02.
const SWEEP_FLAG = "EVEJS_COOP_CORP_TREASURY_SWEEP";
const DIR_FLAG = "EVEJS_COOP_NPC_REFINERY_DIR";
const CORP_FLAG = "EVEJS_COOP_FACTORY_CORP_ID";
const DEFAULT_CORP_ID = 1000129;
const WAREHOUSE_FLAG = "EVEJS_COOP_NPC_WAREHOUSE_DIR";
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

// A single-slot cache is defeated by two statuses alternating (A, B, A, B...), which is exactly what a
// refinery cycle does: measured 48 identical "blocked" records in two minutes for the same station.
// A signature is therefore suppressed for a window instead of only until the next different one.
const NOTE_WINDOW_MS = 60000;
function once(options, key, signature) {
  const now = Date.now();
  let seen = lastNote.get(key);
  if (!(seen instanceof Map)) {
    seen = new Map();
    lastNote.set(key, seen);
  }
  const previous = Number(seen.get(signature)) || 0;
  if (previous > 0 && now - previous < NOTE_WINDOW_MS) return false;
  seen.set(signature, now);
  if (seen.size > 32) {
    for (const [other, at] of seen) if (now - Number(at || 0) >= NOTE_WINDOW_MS) seen.delete(other);
  }
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
    if (!pos(row && row.itemID) || !pos(row && row.typeID)) continue;
    if (!pos(row && row.quantity)) continue;
    if (Number(row.ownerID) !== ownerID) continue;
    if (Number(row.locationID) !== stationID) continue;
    if (!WAREHOUSE_TAG.test(String(row.customInfo || ""))) continue;
    out.push(row);
  }
  // The BIGGEST stacks first. Measured 2026-10-30: 2 798 972 units of ore sat untouched at
  // 60000682 while 1 951 skip events said "leftover too small" - this list used to be the first
  // eight rows in insertion order, and those eight were always the tiny leftovers, so the large
  // stacks never got a turn. That was starvation, not a missing recipe.
  out.sort((left, right) => Number(right.quantity) - Number(left.quantity));
  return out.slice(0, limit);
}


// Every dock the warehouse's manifests name, newest first. A fleet's newest manifest is
// not the only place the corporation keeps ore: measured 2026-11-03 (m003s5) four deposits
// sat at 60000358 (system 30000144) while the newest manifest was a 30000145 sale trip at
// 60014935, so the refinery reported NO_WAREHOUSE_ORE with the stock one system away.
function manifestStations({env, options}) {
  // An injected reader may name one dock (manifestStation) or a list (manifestStations),
  // as numbers or as {stationID}; the runtime and the tests both use this door.
  const norm = (entry) => {
    if (entry === null || entry === undefined) return null;
    const stationID = pos(typeof entry === "object" ? entry.stationID : entry);
    return stationID ? {stationID, manifest: String((entry && entry.manifest) || "")} : null;
  };
  try {
    if (typeof options.manifestStations === "function")
      return (options.manifestStations() || []).map(norm).filter(Boolean);
    if (typeof options.manifestStation === "function")
      return [norm(options.manifestStation())].filter(Boolean);
    const root = options.warehouseRoot || env[WAREHOUSE_FLAG];
    if (typeof root !== "string" || !require("node:path").isAbsolute(root)) return [];
    const dir = require("node:path").join(root, "trip-manifests");
    // A fleet-scoped beat is strict: only its own system+fleet manifests, so a fleet never
    // refines at another fleet's station. A beat with no fleet id sees every proven dock.
    const hasFleet = pos(options.systemID) && pos(options.fleetID);
    const prefix = hasFleet ?
      String(pos(options.systemID)) + "-" + String(pos(options.fleetID)) + "-" : "";
    const out = [];
    const names = require("node:fs").readdirSync(dir)
      .filter((n) => n.endsWith(".json") && n.startsWith(prefix)).sort().reverse();
    for (const name of names.slice(0, 16)) {
      try {
        const row = JSON.parse(require("node:fs").readFileSync(
          require("node:path").join(dir, name), "utf8"));
        const stationID = pos(row && (row.stationID || row.station));
        if (stationID && !out.some((x) => x.stationID === stationID))
          out.push({stationID, manifest: name});
      } catch (_error) { /* one unreadable manifest never hides the others */ }
    }
    return out;
  } catch (_error) { return []; }
}

function manifestStation({env, options}) {
  const all = manifestStations({env, options});
  return all.length ? all[0] : null;
}

// Move the fleet's own earnings into the corporation that pays the station bill.
// Best effort: a missing ledger or a disabled flag must never block refining.
// The repo keeps .cjs modules while the overlay installs them as .js, and the installer
// only rewrites extensionless requires, so both forms are offered explicitly.
function loadTreasury() {
  try {
    return require("./coopNpcCorpTreasury.cjs");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return require("./coopNpcCorpTreasury");
    throw error;
  }
}

// The corporation wallet has exactly one reader/writer pair; both the tunnel above and
// the fee below must go through it.
function loadWallet() {
  try {
    return require("./coopCorpWallet.cjs");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return require("./coopCorpWallet");
    throw error;
  }
}

function fundTreasury({options, env, ownerID}) {
  try {
    const treasury = options.treasury || loadTreasury();
    return treasury.run({env, root: options.marketRoot, corporationID: ownerID,
      // FW-040: only a pilot who really belongs to this corporation funds it. The
      // resolver is optional, so a caller without the authority keeps the old
      // behaviour instead of guessing an owner.
      resolveCorporation: typeof options.pilotCorporation === "function"
        ? options.pilotCorporation : null,
      gameStore: options.gameStore, fsApi: options.fsApi, now: options.now,
      corporationState: options.corporationState,
      observe: options.observe, probe: options.probe});
  } catch (error) {
    return {status: "TREASURY_UNAVAILABLE", moved: 0,
      reason: String(error && error.message).slice(0, 80)};
  }
}

// Read the fee receipt the refinery verifies by name. A replay never guesses: without the file there
// is nothing to replay, and the caller reports that instead of paying twice.
function readFeeReceipt(fsApi, root, receiptID) {
  if (!pos(receiptID)) return null;
  try {
    const file = require("node:path").join(root, "refinery-fees", String(receiptID) + ".json");
    if (!fsApi.existsSync(file)) return null;
    const parsed = JSON.parse(String(fsApi.readFileSync(file, "utf8")));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

// A charge that was reserved AND debited really took the money, even when the process died before
// the receipt file was written. The commitment ledger is durable, so the receipt can be rebuilt from
// it instead of charging the corporation a second time - and never from a guess: the reservation's
// balanceBefore minus the amount must equal the debit's balanceAfter, or nothing is rebuilt.
function rebuildFeeReceipt({fsApi, root, receiptID, amount, ownerID, stationID, chargeID}) {
  let rows;
  try { rows = budgetApi.readCommitments(root, {fsApi}).rows; }
  catch (_error) { return null; }
  const reserved = rows.find((row) => row && row.operationID === chargeID &&
    row.type === "RESERVED" && Math.abs(Number(row.amountISK) - amount) < 0.005 &&
    Number(row.corporationID) === pos(ownerID) && Number(row.stationID) === pos(stationID));
  const debited = rows.find((row) => row && row.operationID === chargeID && row.type === "DEBITED");
  if (!reserved || !debited) return null;
  const beforeISK = Number(reserved.balanceBefore), afterISK = Number(debited.balanceAfter);
  if (!Number.isFinite(beforeISK) || !Number.isFinite(afterISK)) return null;
  if (Math.abs((beforeISK - amount) - afterISK) > 0.005) return null;
  const receipt = {version: 1, status: "PAID", receiptID, amountISK: amount,
    corporationID: pos(ownerID), stationID: pos(stationID), oreItemID: receiptID,
    beforeISK, afterISK, at: Number(debited.at) || Date.now(), rebuiltFromCommitment: true};
  try {
    const dir = require("node:path").join(root, "refinery-fees");
    fsApi.mkdirSync(dir, {recursive: true});
    const file = require("node:path").join(dir, String(receiptID) + ".json");
    const tmp = file + ".tmp-" + process.pid;
    const fd = fsApi.openSync(tmp, "w", 0o600);
    try { fsApi.writeFileSync(fd, JSON.stringify(receipt)); fsApi.fsyncSync(fd); }
    finally { fsApi.closeSync(fd); }
    fsApi.renameSync(tmp, file);
  } catch (_error) { return null; }
  return receipt;
}

// Pay a real station fee from the corporation's own wallet and leave a durable
// receipt the refinery can verify by name. Never creates ISK: the debit is the source.
function payFee({gameStore, root, ownerID, stationID, oreItemID, amountISK, now, corporationState, operationID, quantity, fsApi = require("node:fs")}) {
  const amount = Math.round(Number(amountISK) * 100) / 100;
  if (!(amount > 0)) return {status: "FEE_INVALID"};
  // L7-D: a fee is only ever paid inside an operator-set scope, and the charge is identified before
  // the money moves. The flag is an additional ceiling, never the authority: without a budget file
  // the limit is 0 and nothing is spent, whatever the flag says.
  const env = process.env;
  const flag = Number(env.EVEJS_COOP_REFINERY_SPEND_LIMIT_ISK || 0) || 0;
  const budget = budgetApi.readBudget(root, {fsApi});
  if (budget.status === "BUDGET_UNREADABLE")
    return {status: "BUDGET_UNREADABLE", reason: String(budget.reason || "").slice(0, 80)};
  const limitISK = Math.min(flag, budget.status === "OK" ? Number(budget.budget.limitISK) : 0);
  const sinceAt = budget.status === "OK" ? Number(budget.budget.sinceAt) : 0;
  const chargeID = String(operationID || ("coop-refine:v1:" + pos(oreItemID) + ":" +
    (pos(quantity) || pos(oreItemID))));
  // The durable receipt is named after the ore stack, exactly as the refinery verifies it.
  const receiptID = pos(oreItemID);
  const wallet = loadWallet().readWallet({corporationState, gameStore,
    corporationID: ownerID});
  if (wallet.status !== "OK") return {status: wallet.status};
  const divisions = wallet.divisions;
  const before = Number(divisions[1000] && divisions[1000].balance);
  if (!Number.isFinite(before) || before < 0) return {status: "CORP_WALLET_INVALID"};
  if (before < amount) return {status: "CORP_WALLET_INSUFFICIENT", iskCost: amount, balanceISK: before};
  // The reservation is durable and counts against the cap even if the process dies before the debit.
  const reserved = budgetApi.reserve(root, {operationID: chargeID, amountISK: amount,
    corporationID: pos(ownerID), stationID: pos(stationID), balanceBefore: before,
    limitISK, sinceAt, now, fsApi});
  if (reserved.status === "SPEND_SCOPE_EXHAUSTED")
    return {status: reserved.status, iskCost: amount, limitISK, chargeID, balanceISK: before};
  if (reserved.status === "OPERATION_ALREADY_COMMITTED") {
    // This exact charge was already reserved, so the corporation already paid it: charging again
    // would debit the wallet twice. The durable receipt is the authority. Measured live 2026-11-06:
    // the refinery had been BLOCKED with this status since 14:05 the day before (10 778 events),
    // because a crash between the debit and the refine left a committed fee and nothing ever replayed
    // it - every tick asked for the fee, every tick refused to pay it, and no ore was ever refined.
    const replayed = readFeeReceipt(fsApi, root, receiptID);
    if (replayed && String(replayed.status) === "PAID" &&
        Math.abs(Number(replayed.amountISK) - amount) < 0.005 &&
        Number(replayed.corporationID) === pos(ownerID) &&
        Number(replayed.stationID) === pos(stationID))
      return {status: "PAID", receipt: replayed, replay: true, iskCost: amount, chargeID};
    // No receipt but a real debit: the money already left, so rebuild the proof instead of asking
    // the corporation to pay for the same ore twice.
    const rebuilt = rebuildFeeReceipt({fsApi, root, receiptID, amount, ownerID, stationID, chargeID});
    if (rebuilt)
      return {status: "PAID", receipt: rebuilt, replay: true, rebuilt: true, iskCost: amount, chargeID};
    // A committed charge with no matching receipt is not a state to paper over: name it, so an
    // operator sees one real problem instead of an endless silent block.
    return {status: "FEE_ALREADY_COMMITTED_RECEIPT_MISMATCH", iskCost: amount, chargeID,
      balanceISK: before};
  }
  if (reserved.status !== "RESERVED")
    return {status: String(reserved.status || "RESERVE_FAILED"), chargeID};
  const written = loadWallet().applyDelta({corporationState, gameStore,
    corporationID: ownerID, division: 1000, delta: -amount});
  if (!written || written.status !== "OK") return {status: String((written && written.status) || "CORP_DEBIT_FAILED")};
  if (typeof gameStore.flushTableSync === "function") {
    const flushed = gameStore.flushTableSync("corporationRuntime", {log: false});
    if (!flushed || flushed.success !== true) return {status: "CORP_DEBIT_FLUSH_UNCERTAIN"};
  }
  // The money left the wallet: the reservation becomes a confirmed commitment. Only after this is the
  // receipt written, so a crash in between is recoverable from the balance (review/L8-SPECS.md).
  const debitAfter = Number.isFinite(Number(written.balance))
    ? Number(written.balance) : Math.round((before - amount) * 100) / 100;
  budgetApi.commit(root, {operationID: chargeID, balanceAfter: debitAfter, now, fsApi});
  const after = Number.isFinite(Number(written.balance))
    ? Number(written.balance) : Math.round((before - amount) * 100) / 100;
  const receipt = {version: 1, status: "PAID", receiptID, amountISK: amount,
    corporationID: pos(ownerID), stationID: pos(stationID), oreItemID: receiptID,
    beforeISK: before, afterISK: after,
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
function refineAtStation(options = {}, stationIDOverride = 0) {
  const env = options.env || process.env;
  const ownerID = pos(env[CORP_FLAG]) || DEFAULT_CORP_ID;
  // The mining fleet docks no hull, so its record usually carries no station. The station
  // that really holds this fleet's ore is proven by its newest warehouse trip manifest,
  // never guessed from an arbitrary system.
  const proved = pos(stationIDOverride) ? null : manifestStation({env, options});
  const stationID = pos(stationIDOverride) || (proved ? proved.stationID : 0);
  // Say why nothing was refined instead of returning silently: a caller that passes no
  // station must be visible in the event stream, not inferred from an empty refinery dir.
  const skip = (status, extra = {}) => {
    if (once(options, "refinery-skip:" + status + ":" + stationID, status))
      note(options, "living-npc-refinery-skipped", {systemID: options.systemID,
        ownerID, stationID, status, ...extra});
    return {status, refined: 0};
  };
  if (!stationID) return skip("NO_STATION");
  // The corporation earns whenever its pilots do, so the sweep does not wait for ore to
  // refine. It runs once per beat (first station only), never once per candidate station.
  const funded = options.sweep === false ? null : fundTreasury({options, env, ownerID});
  if (options.sweep !== false) {
    if (String(env.EVEJS_COOP_TREASURY_TRACE || "") === "1" &&
      !(funded && funded.status === "SWEPT" && Number(funded.moved) > 0))
      note(options, "living-corp-treasury-skipped", {systemID: options.systemID, ownerID,
        status: String((funded && funded.status) || "NO_RESULT"),
        reason: String((funded && (funded.reason || funded.error)) || "").slice(0, 120),
        moved: Number((funded && funded.moved) || 0)});
    if (funded && funded.status === "SWEPT" && Number(funded.moved) > 0)
      note(options, "living-corp-treasury-swept", {systemID: options.systemID, ownerID,
        movedISK: Number(funded.moved),
        corporationISK: funded.balanceISK !== undefined ? funded.balanceISK : null});
  }
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
    rows = candidates({items, ownerID, stationID,
      limit: Math.max(1, Math.min(64,
        Number(env.EVEJS_COOP_NPC_REFINERY_BATCH) || 24))});
  } catch (error) {
    return skip("CANDIDATES_UNREADABLE", {reason: String(error && error.message).slice(0, 80)});
  }
  if (rows === null) return skip("STOCK_UNREADABLE");
  if (!rows.length) return skip("NO_WAREHOUSE_ORE");
  let refined = 0;
  const statuses = [];
  for (const row of rows) {
    let outcome;
    try {
      outcome = refinery.refine({oreItemID: Number(row.itemID), ownerID, stationID});
    } catch (error) {
      outcome = {status: "REFINERY_THROW", reason: String(error && error.message).slice(0, 80)};
    }
    // A positive station fee is a real bill. Pay it from the corporation's own wallet,
    // hand the refinery the durable receipt, and retry once. No ISK is created here.
    if (String(outcome && outcome.status) === "NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED") {
      let paid;
      try {
        const gameStore = options.gameStore || require("../gameStore");
        const root = options.root || env[DIR_FLAG];
        // The charge must be keyed by the SAME operation the refine will run (item + quantity).
        // Keyed by the item alone, a stack whose quantity changed between the payment and the refine
        // could never be paid again: the reservation existed, the quote did not match it, and the
        // ore was stuck forever (measured 2026-11-06 on the whole warehouse).
        paid = payFee({gameStore, root, ownerID, stationID, oreItemID: Number(row.itemID),
          quantity: Number(row.quantity),
          operationID: refineKeyFor(Number(row.itemID), Number(row.quantity)),
          amountISK: outcome.iskCost, now: options.now, fsApi: options.fsApi,
          corporationState: options.corporationState});
      } catch (error) {
        paid = {status: "FEE_PAYMENT_UNAVAILABLE", reason: String(error && error.message).slice(0, 80)};
      }
      if (paid.status === "PAID") {
        try {
          outcome = refinery.refine({oreItemID: Number(row.itemID), ownerID, stationID,
            feePaid: {receiptID: paid.receipt.receiptID, amountISK: paid.receipt.amountISK,
              corporationID: ownerID, stationID}});
        } catch (error) {
          outcome = {status: "REFINERY_THROW", reason: String(error && error.message).slice(0, 80)};
        }
      } else {
        outcome = {...outcome, feePayment: paid.status,
          walletISK: paid.balanceISK !== undefined ? paid.balanceISK : null};
      }
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
    // Only leftovers remain: not a defect, and not something to report every tick.
    if (status === "NATIVE_REFINERY_LEFTOVER_TOO_SMALL") {
      if (once(options, "leftover:" + stationID + ":" + row.itemID, status))
        note(options, "living-npc-refinery-skipped", {systemID: options.systemID,
          ownerID, stationID, status, oreItemID: Number(row.itemID),
          oreTypeID: Number(row.typeID), quantity: Number(row.quantity)});
      continue;
    }
    // A fee is a real economic fact, not an error to swallow: report the exact cost, and
    // report WHY it was not settled. Measured live 2026-11-03 (m003s5): the refinery found
    // two real warehouse stacks and stalled on NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED
    // with every field null, so the world could not tell a missing budget from an unreadable
    // wallet - the exact stall this event exists to explain.
    const fee = outcome && outcome.feePayment !== undefined ? String(outcome.feePayment) : "";
    const walletISK = outcome && outcome.walletISK !== undefined ? outcome.walletISK : null;
    const key = "blocked:" + stationID + ":" + row.itemID + ":" + status;
    if (once(options, key, status + ":" + String(outcome && outcome.iskCost) + ":" + fee)) {
      note(options, "living-npc-refinery-blocked", {systemID: options.systemID,
        ownerID, stationID, status, oreItemID: Number(row.itemID),
        oreTypeID: Number(row.typeID), iskCost: outcome && outcome.iskCost !== undefined ? outcome.iskCost : null,
        feePayment: fee || null, walletISK,
        reason: outcome && outcome.reason ? String(outcome.reason).slice(0, 90) : (fee || null)});
    }
  }
  return {status: refined ? "REFINED" : "BLOCKED", refined, statuses};
}

// Called from the mining fleet tick: throttled, and only when the fleet knows a station.
// Measured 2026-10-28: 454 124 units of tagged warehouse ore sat at 60000682 while the
// refinery worked only at the fleet's own station (1 535 units there), so no Pyerite was
// ever made from the stack the corporation actually owned. Both stations are proven - the
// fleet's dock and the newest warehouse trip manifest - so both are refined, in that order.
// Move the pilots' earned ISK into the corporation without touching a single ore stack. The
// treasury authority is the same one the refinery path uses; nothing new is created, the debit
// is the source. Default OFF, its own flag.
function sweepOnly(options = {}) {
  const env = options.env || process.env;
  const ownerID = pos(env[CORP_FLAG]) || DEFAULT_CORP_ID;
  const funded = fundTreasury({options, env, ownerID});
  const moved = Number((funded && funded.moved) || 0);
  if (funded && funded.status === "SWEPT" && moved > 0)
    note(options, "living-corp-treasury-swept", {systemID: options.systemID, ownerID,
      movedISK: moved, corporationISK: funded.balanceISK !== undefined ? funded.balanceISK : null});
  else if (String(env.EVEJS_COOP_TREASURY_TRACE || "") === "1")
    note(options, "living-corp-treasury-skipped", {systemID: options.systemID, ownerID,
      status: String((funded && funded.status) || "NO_RESULT"),
      reason: String((funded && (funded.reason || funded.error)) || "").slice(0, 120),
      moved});
  return {status: String((funded && funded.status) || "NO_RESULT"), refined: 0,
    swept: moved, ownerID};
}

function run(options = {}) {
  const env = options.env || process.env;
  if (String(env[FLAG] || "") !== "1")
    return String(env[SWEEP_FLAG] || "") === "1"
      ? sweepOnly(options) : {status: "DISABLED", refined: 0};
  const explicit = pos(options.stationID);
  const first = refineAtStation(options, explicit);
  if (first.refined > 0) return first;
  const retryable = ["NO_WAREHOUSE_ORE", "NO_STATION", "STOCK_UNREADABLE"];
  if (!retryable.includes(String(first.status))) return first;
  // Ore belongs to a station, not to a fleet id. Try every dock the warehouse can prove,
  // newest first, and stop at the first station that actually holds tagged ore: measured
  // live in m003s5 (2026-11-03), the newest manifest pointed at an empty dock while two
  // committed warehouse receipts held ore at another proven dock, so nothing ever refined.
  const tried = explicit ? [explicit] : [];
  let last = first;
  for (const dock of manifestStations({env, options})) {
    if (dock.stationID === explicit) continue;
    tried.push(dock.stationID);
    const next = refineAtStation({...options, sweep: false}, dock.stationID);
    if (next.refined > 0) return {...next, triedStations: tried};
    if (!retryable.includes(String(next.status))) return next;
    last = next;
  }
  return {...last, triedStations: tried};
}

function tick(options = {}) {
  const env = options.env || process.env;
  // A sweep-only beat still needs its throttle: it moves money.
  const sweepEnabled = String(env[SWEEP_FLAG] || "") === "1";
  if (String(env[FLAG] || "") !== "1" && !sweepEnabled) return {status: "DISABLED"};
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

module.exports = {FLAG, SWEEP_FLAG, sweepOnly, WAREHOUSE_FLAG, manifestStation, manifestStations, DIR_FLAG, CORP_FLAG, DEFAULT_CORP_ID, THROTTLE_MS, WAREHOUSE_TAG,
  candidates, payFee, refineAtStation, run, tick, resetForTests};
