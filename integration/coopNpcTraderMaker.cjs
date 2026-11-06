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
  readPlayerAsks = null,
  buyAsk = null,
  journalFile,
  clock = () => Date.now(),
  env = process.env,
  maxBuysPerTick = DEFAULT_MAX_BUYS_PER_TICK,
  maxTypesPerTick = MAX_TYPES_PER_TICK,
  minReserveCents = 1_000_000, // 10 000 ISK is real money in this world: never spend it by accident
  maxSpendPerTickCents = 100_000_000, // 1 M ISK per tick ceiling
  maxLotUnits = 50,
  // Owner rule 2026-11-06: "buy the asks if they are a reasonable price". The band is a number, not
  // a constant: 0.9 keeps the original "bargain only" behaviour, 1.0 means "at or below the market
  // ask", and anything above 1 is refused because that is no longer a reasonable price.
  buyMaxPct = null,
  minProfitBps = null,
} = {}) {
  if (typeof call !== "function" || typeof getStation !== "function" ||
      typeof readWalletCents !== "function" || typeof clock !== "function" ||
      typeof journalFile !== "string" || !path.isAbsolute(journalFile) ||
      (buyAsk !== null && typeof buyAsk !== "function") ||
      (readPlayerAsks !== null && typeof readPlayerAsks !== "function"))
    throw Error("TRADER_MAKER_DEPENDENCIES_REQUIRED");
  if (!Number.isSafeInteger(maxBuysPerTick) || maxBuysPerTick < 1 || maxBuysPerTick > 4 ||
      !Number.isSafeInteger(maxTypesPerTick) || maxTypesPerTick < 1 ||
      maxTypesPerTick > MAX_TYPES_PER_TICK ||
      !Number.isSafeInteger(minReserveCents) || minReserveCents < 0 ||
      !Number.isSafeInteger(maxSpendPerTickCents) || maxSpendPerTickCents < 1)
    throw Error("TRADER_MAKER_LIMITS_INVALID");
  if (buyMaxPct !== null && !(Number.isFinite(buyMaxPct) && buyMaxPct > 0 && buyMaxPct <= 1))
    throw Error("TRADER_MAKER_BUY_BAND_INVALID");
  if (minProfitBps !== null && !(Number.isSafeInteger(minProfitBps) && minProfitBps >= 0))
    throw Error("TRADER_MAKER_PROFIT_BAND_INVALID");
  const band = {
    ...(buyMaxPct === null ? {} : { maxBuyPct: buyMaxPct }),
    ...(minProfitBps === null ? {} : { minProfitBps }),
  };
  // One lot is one whole escrow stack: the atomic settlement moves ONE stack and pays ONE exact
  // quantity, so a truncated lot can never settle. It is skipped, not silently shrunk.
  const MAX_REFUSALS = 3;

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
    const referenceAsks = []; // real for-sale asks AT THE HUB
    const regionAsks = []; // real for-sale asks elsewhere in the region: a fallback reference
    const playerAsks = [];
    for (const row of sells) {
      if (!row || row.bid === true) continue;
      if (Number(row.type_id) !== Number(typeID)) continue;
      const priceCents = cents(row.price);
      const volume = pos(row.vol_remaining);
      const orderID = String(row.order_id === null || row.order_id === undefined ? "" : row.order_id);
      if (priceCents === null || !volume || !/^[0-9]{1,20}$/.test(orderID)) continue;
      const atHub = Number(row.station_id) === Number(stationID);
      if (String(row.source) === "player") {
        // A player's ask is only ever settled at the hub, where its escrow lives.
        if (!atHub) continue;
        playerAsks.push({ typeID, orderID, stationID, remainingQuantity: volume,
          unitPriceCents: priceCents, verifiedNative: true, state: "open" });
      } else if (atHub) {
        referenceAsks.push({ orderID, priceCents, volume });
      } else {
        regionAsks.push({ orderID, priceCents, volume });
      }
    }
    // The market price for this type is what the world itself asks for it. The hub is the truth;
    // when nothing is offered at the hub at all, the cheapest real ask anywhere in the region is
    // still a real market price (and the only honest number available), so a seller who really
    // offers something at the hub is not refused just because the seeded stock sits elsewhere.
    const hubCents = referenceAsks.length
      ? Math.min(...referenceAsks.map((ask) => ask.priceCents))
      : null;
    const regionCents = regionAsks.length
      ? Math.min(...regionAsks.map((ask) => ask.priceCents))
      : null;
    const reference = hubCents !== null ? hubCents : regionCents;
    // Ask rows the public book cannot show: read them from the escrow authority when the caller
    // provides one, and never trust a row it would not name.
    if (typeof readPlayerAsks === "function") {
      const escrowed = await readPlayerAsks(stationID, typeID);
      const known = new Set(playerAsks.map((ask) => String(ask.orderID)));
      for (const row of Array.isArray(escrowed) ? escrowed : []) {
        const orderID = String(row && row.orderID || "");
        const priceCents = money(row && row.unitPriceCents);
        const volume = pos(row && row.remainingQuantity);
        if (!/^[0-9]{1,20}$/.test(orderID) || known.has(orderID)) continue;
        if (priceCents === null || !(priceCents > 0) || !volume) continue;
        playerAsks.push({ typeID, orderID, stationID, remainingQuantity: volume,
          unitPriceCents: priceCents, verifiedNative: true, state: "open" });
        known.add(orderID);
      }
    }
    return { referenceCents: reference, referenceScope: hubCents !== null ? "HUB" : (regionCents !== null ? "REGION" : "NONE"),
      playerAsks, seedAsks: referenceAsks.length, regionAsks: regionAsks.length };
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
        ...band,
      });
      if (plan.status === "PLANNED") {
        plans.push({ typeID: book.playerAsks[0].typeID, referenceCents: book.referenceCents,
          referenceScope: book.referenceScope,
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
        typeID: plan.typeID, referenceCents: plan.referenceCents, referenceScope: plan.referenceScope,
        buyCeilingCents: plan.buyCeilingCents,
        sellFloorCents: plan.sellFloorCents, lot: plan.lots[0],
      })),
      executions: [],
      refused: [],
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
        if (existing && existing.phase === "SETTLED") { alreadyHandled += 1; continue; }
        // A PREPARED claim may already have closed the book row: never touch it again. A REFUSED
        // claim moved nothing at all, so a later tick may retry it - a bounded number of times.
        if (existing && existing.phase === "PREPARED") continue;
        if (existing && existing.phase === "REFUSED" &&
            (existing.refusals || 0) >= MAX_REFUSALS) continue;
        // Whole escrow only: the settlement pays for exactly one whole physical stack.
        if (lot.quantity !== lot.offerQuantity) {
          summary.refused.push({ orderID: key, typeID: lot.typeID, quantity: lot.quantity,
            offerQuantity: lot.offerQuantity, reason: "LOT_REQUIRES_PARTIAL_SETTLEMENT" });
          continue;
        }
        const claimKey = "npc-corpbuy:" + crypto.randomUUID().replace(/-/g, "");
        journal.claims[key] = { phase: "PREPARED", claimKey, typeID: lot.typeID,
          stationID: lot.stationID, quantity: lot.quantity, unitPriceCents: lot.buyUnitPriceCents,
          createdAt: clock(), refusals: existing ? (existing.refusals || 0) : 0 };
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
        // BLOCKED is the executor saying "I did nothing": no claim, no fill, no money. That is the
        // only non-settled outcome a later tick may retry; a throw or any other status is treated
        // as ambiguous and stays PREPARED forever, for an operator.
        const refused = !settled && result && result.status === "BLOCKED";
        journal.claims[key] = {
          ...journal.claims[key],
          phase: settled ? "SETTLED" : (refused ? "REFUSED" : "PREPARED"),
          refusals: refused ? ((existing ? (existing.refusals || 0) : 0) + 1)
            : (journal.claims[key].refusals || 0),
          result: String(result && result.status || "NO_RESULT"),
          reason: refused ? String(result.reason || "NO_REASON").slice(0, 90) : null,
          fillID: settled ? result.fillID : null,
          itemID: settled ? result.itemID : null,
          atMs: clock(),
        };
        saveJournal(journal);
        summary.executions.push({ typeID: lot.typeID, orderID: lot.sourceOrderID, quantity: lot.quantity,
          buyUnitPriceCents: lot.buyUnitPriceCents, settled, fillID: settled ? result.fillID : null,
          outcome: String(result && (result.status === "BLOCKED"
            ? "BLOCKED:" + (result.reason || "NO_REASON") : result.status) || "NO_RESULT") });
        if (!settled) break; // one ambiguous outcome stops the tick, never a cascade
      }
    } finally {
      fs.closeSync(fd);
      try { fs.unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    summary.status = summary.executions.some((row) => row.settled)
      ? "TRADER_MAKER_SETTLED"
      : (summary.executions.length ? "TRADER_MAKER_NOT_SETTLED"
        : (summary.refused.length ? "TRADER_MAKER_SKIPPED" : "TRADER_MAKER_ALREADY_HANDLED"));
    probe.observe("space.trader-maker", null, null, {
      status: summary.status, mode: summary.mode, hub: summary.hub, buyerCorpID: summary.buyerCorpID,
      cashCents: summary.cashCents, executions: summary.executions,
      refused: summary.refused.map((row) => ({ typeID: row.typeID, reason: row.reason })),
    });
    return summary;
  }

  return Object.freeze({ tick, journal: loadJournal, mode: "CORP_MARKET_MAKER" });
}

module.exports = { createTraderMaker, DEFAULT_MAX_BUYS_PER_TICK, MAX_TYPES_PER_TICK };
