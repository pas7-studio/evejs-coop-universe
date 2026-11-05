"use strict";
// COOP-MMD: the driver for the owner's market-maker bands (space/coopNpcMarketMakerBands.js).
//
// Owner rule 2026-11-05: "with 50-200 billion, buy everything - even what nobody buys - at 70-90 % of
// the market, and try to resell at 105-140 %." The bands decide; this module runs them against the
// book that really exists, once per living-world tick, for one corporation at one hub station:
//
//   1. read the public book per type (bounded) and split it into seed/reference asks and PLAYER asks;
//   2. the reference price is the cheapest seed ask for that type - that IS "the market" here;
//   3. plan with the bands (<=90 % of the reference), cheapest and most profitable first;
//   4. in plan mode only REPORT what it would do; in live mode ask the injected executor to lift
//      ONE whole player ask per tick, through the existing atomic buyer (real corp ISK, real item).
//
// It never mints, never invents a price, never retries an ambiguous settlement, and never places a
// buy or sell order on its own: the bid band is reported so an operator can see what it would price.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { planBargainBuys } = require(path.join(__dirname, "coopNpcMarketMakerBands"));
const probe = require(path.join(__dirname, "coopRuntimeProbe"));

const pos = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : 0;
// A missing money value is NOT zero: an unreadable wallet must refuse, never spend nothing quietly.
const money = (x) => (x === null || x === undefined)
  ? null
  : (Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : null);
const cents = (isk) => {
  const value = Number(isk);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};

const MAX_TYPES_PER_TICK = 24;
const DEFAULT_MAX_BUYS_PER_TICK = 1;

function createTraderMaker({
  call,
  getStation,
  readWalletCents,
  buyAsk = null,
  journalFile,
  clock = () => Date.now(),
  env = process.env,
  maxBuysPerTick = DEFAULT_MAX_BUYS_PER_TICK,
  maxTypesPerTick = MAX_TYPES_PER_TICK,
  minReserveCents = 1_000_000, // 10 000 ISK is real money in this world: never spend it by accident
  maxSpendPerTickCents = 100_000_000, // 1 M ISK per tick ceiling
  maxLotUnits = 50,
} = {}) {
  if (typeof call !== "function" || typeof getStation !== "function" ||
      typeof readWalletCents !== "function" || typeof clock !== "function" ||
      typeof journalFile !== "string" || !path.isAbsolute(journalFile) ||
      (buyAsk !== null && typeof buyAsk !== "function"))
    throw Error("TRADER_MAKER_DEPENDENCIES_REQUIRED");
  if (!Number.isSafeInteger(maxBuysPerTick) || maxBuysPerTick < 1 || maxBuysPerTick > 4 ||
      !Number.isSafeInteger(maxTypesPerTick) || maxTypesPerTick < 1 ||
      maxTypesPerTick > MAX_TYPES_PER_TICK ||
      !Number.isSafeInteger(minReserveCents) || minReserveCents < 0 ||
      !Number.isSafeInteger(maxSpendPerTickCents) || maxSpendPerTickCents < 1)
    throw Error("TRADER_MAKER_LIMITS_INVALID");

  const lock = journalFile + ".lock";

  function loadJournal() {
    try {
      const state = JSON.parse(fs.readFileSync(journalFile, "utf8"));
      if (state.version !== 1 || !state.claims || typeof state.claims !== "object")
        throw Error("TRADER_JOURNAL_INVALID");
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, claims: {} };
      throw error;
    }
  }

  function saveJournal(state) {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    const tmp = `${journalFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let fd;
    try {
      fd = fs.openSync(tmp, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(state));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, journalFile);
    } finally {
      if (fd !== null && fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

  function ownedByUs(typeID) {
    const state = loadJournal();
    return Object.values(state.claims).some((claim) =>
      claim && Number(claim.typeID) === Number(typeID) && claim.phase === "PREPARED");
  }

  async function bookFor(regionID, typeID, stationID) {
    const result = await call("GetOrders", { region_id: regionID, type_id: typeID });
    const sells = Array.isArray(result && result.sells) ? result.sells : [];
    const referenceAsks = [];
    const playerAsks = [];
    for (const row of sells) {
      if (!row || row.bid === true) continue;
      if (Number(row.type_id) !== Number(typeID) || Number(row.station_id) !== Number(stationID))
        continue;
      const priceCents = cents(row.price);
      const volume = pos(row.vol_remaining);
      const orderID = pos(row.order_id);
      if (priceCents === null || !volume || !orderID) continue;
      if (String(row.source) === "player") {
        playerAsks.push({ typeID, orderID, stationID, remainingQuantity: volume,
          unitPriceCents: priceCents, verifiedNative: true, state: "open" });
      } else {
        referenceAsks.push({ orderID, priceCents, volume });
      }
    }
    // The market price for this type is what the world itself asks for it.
    const reference = referenceAsks.length
      ? Math.min(...referenceAsks.map((ask) => ask.priceCents))
      : null;
    return { referenceCents: reference, playerAsks, seedAsks: referenceAsks.length };
  }

  async function tick({ stationID, typeIDs = [] } = {}) {
    const gated = env.EVEJS_COOP_TRADER_MAKER === "1";
    const live = env.EVEJS_COOP_TRADER_MAKER_MODE === "live";
    if (!gated) return { status: "DISABLED" };
    if (!pos(stationID) || !Array.isArray(typeIDs) || !typeIDs.length ||
        typeIDs.length > maxTypesPerTick)
      return { status: "BLOCKED", reason: "TRADER_MAKER_SCOPE_INVALID" };
    if (live && typeof buyAsk !== "function")
      return { status: "BLOCKED", reason: "TRADER_MAKER_EXECUTOR_NOT_WIRED" };
    const station = getStation(stationID);
    if (!station || Number(station.stationID) !== Number(stationID) || !pos(station.regionID))
      return { status: "BLOCKED", reason: "TRADER_MAKER_HUB_MISSING" };
    const buyerCorpID = pos(env.EVEJS_COOP_TRADER_CORP_ID);
    if (!buyerCorpID) return { status: "BLOCKED", reason: "TRADER_MAKER_CORP_MISSING" };
    const cashCents = money(readWalletCents(buyerCorpID));
    if (cashCents === null) return { status: "BLOCKED", reason: "TRADER_MAKER_WALLET_UNREADABLE" };

    const perType = [];
    for (const typeID of [...new Set(typeIDs.map(pos).filter(Boolean))]) {
      try {
        perType.push(await bookFor(station.regionID, typeID, stationID));
      } catch (error) {
        perType.push({ typeID, error: String(error && error.message || error).slice(0, 80) });
      }
    }

    const plans = [];
    let budgetLeft = Math.min(maxSpendPerTickCents, Math.max(0, cashCents - minReserveCents));
    for (const book of perType) {
      if (!book || !book.referenceCents || !book.playerAsks.length) continue;
      const plan = planBargainBuys({
        asks: book.playerAsks,
        referencePriceCents: book.referenceCents,
        cashCents,
        minReserveCents,
        maxSpendCents: budgetLeft,
        maxLotUnits,
        openTypeIDs: ownedByUs(book.playerAsks[0].typeID) ? [book.playerAsks[0].typeID] : [],
      });
      if (plan.status === "PLANNED") {
        plans.push({ typeID: book.playerAsks[0].typeID, referenceCents: book.referenceCents,
          seedAsks: book.seedAsks, lots: plan.lots, buyCeilingCents: plan.buyCeilingCents,
          sellFloorCents: plan.sellFloorCents });
        budgetLeft -= plan.spentCents;
      }
    }
    plans.sort((left, right) => (right.lots[0].grossProfitBps - left.lots[0].grossProfitBps)
      || (right.lots[0].totalCents - left.lots[0].totalCents));

    const summary = {
      status: plans.length ? (live ? "TRADER_MAKER_LIVE" : "TRADER_MAKER_PLAN") : "TRADER_MAKER_NO_BARGAIN",
      mode: live ? "LIVE" : "PLAN",
      hub: stationID,
      buyerCorpID,
      cashCents,
      reserveHeldCents: minReserveCents,
      typesRead: perType.length,
      typesWithReference: perType.filter((book) => book && book.referenceCents).length,
      typesWithPlayerAsks: perType.filter((book) => book && book.playerAsks && book.playerAsks.length).length,
      errors: perType.filter((book) => book && book.error).map((book) => ({ typeID: book.typeID, error: book.error })).slice(0, 6),
      candidates: plans.slice(0, 4).map((plan) => ({
        typeID: plan.typeID, referenceCents: plan.referenceCents, buyCeilingCents: plan.buyCeilingCents,
        sellFloorCents: plan.sellFloorCents, lot: plan.lots[0],
      })),
      executions: [],
    };
    if (!live || !plans.length) {
      probe.observe("space.trader-maker", null, null, {
        status: summary.status, mode: summary.mode, hub: summary.hub, buyerCorpID: summary.buyerCorpID,
        cashCents: summary.cashCents, typesRead: summary.typesRead,
        typesWithPlayerAsks: summary.typesWithPlayerAsks,
        candidates: summary.candidates.map((row) => ({ typeID: row.typeID,
          quantity: row.lot.quantity, buy: row.lot.buyUnitPriceCents,
          sell: row.lot.sellTargetUnitPriceCents, profitBps: row.lot.grossProfitBps })),
      });
      return summary;
    }

    // Live: one whole player ask per tick, journaled BEFORE the first native claim.
    let fd;
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    try { fd = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") return { ...summary, status: "BLOCKED", reason: "TRADER_JOURNAL_LOCKED" };
      throw error;
    }
    try {
      const journal = loadJournal();
      let alreadyHandled = 0;
      for (const plan of plans) {
        if (summary.executions.length >= maxBuysPerTick) break;
        const lot = plan.lots[0];
        const key = String(lot.sourceOrderID);
        const existing = journal.claims[key];
        if (existing && existing.phase !== "SETTLED") continue; // never retry an unresolved claim
        if (existing && existing.phase === "SETTLED") { alreadyHandled += 1; continue; }
        const claimKey = "npc-corpbuy:" + crypto.randomUUID().replace(/-/g, "");
        journal.claims[key] = { phase: "PREPARED", claimKey, typeID: lot.typeID,
          stationID: lot.stationID, quantity: lot.quantity, unitPriceCents: lot.buyUnitPriceCents,
          createdAt: clock() };
        saveJournal(journal); // write-ahead, same rule the coordinator uses
        let result;
        try {
          result = await buyAsk({
            claimKey, buyerCorpID, sellerID: lot.sellerOwnerID, stationID: lot.stationID,
            typeID: lot.typeID, orderID: lot.sourceOrderID, quantity: lot.quantity,
            maxUnitPriceCents: lot.buyUnitPriceCents, minReserveCents,
          });
        } catch (error) {
          result = { status: "TRADER_EXECUTOR_THROW", reason: String(error && error.message || error).slice(0, 90) };
        }
        const settled = result && result.status === "NPC_PURCHASED_PLAYER_GOODS";
        journal.claims[key] = {
          ...journal.claims[key],
          phase: settled ? "SETTLED" : "PREPARED",
          result: String(result && result.status || "NO_RESULT"),
          fillID: settled ? result.fillID : null,
          itemID: settled ? result.itemID : null,
          atMs: clock(),
        };
        saveJournal(journal);
        summary.executions.push({ typeID: lot.typeID, orderID: lot.sourceOrderID, quantity: lot.quantity,
          buyUnitPriceCents: lot.buyUnitPriceCents, settled, fillID: settled ? result.fillID : null,
          outcome: String(result && result.status || "NO_RESULT") });
        if (!settled) break; // one ambiguous outcome stops the tick, never a cascade
      }
    } finally {
      fs.closeSync(fd);
      try { fs.unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    summary.status = summary.executions.some((row) => row.settled)
      ? "TRADER_MAKER_SETTLED"
      : (summary.executions.length ? "TRADER_MAKER_NOT_SETTLED"
        : "TRADER_MAKER_ALREADY_HANDLED");
    probe.observe("space.trader-maker", null, null, {
      status: summary.status, mode: summary.mode, hub: summary.hub, buyerCorpID: summary.buyerCorpID,
      cashCents: summary.cashCents, executions: summary.executions,
    });
    return summary;
  }

  return Object.freeze({ tick, journal: loadJournal, mode: "CORP_MARKET_MAKER" });
}

module.exports = { createTraderMaker, DEFAULT_MAX_BUYS_PER_TICK, MAX_TYPES_PER_TICK };
