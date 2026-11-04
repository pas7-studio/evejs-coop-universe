"use strict";
// The money half of docs/MARKET_MAKERS.md: five traders whose ISK is booked, reserved and refunded, and
// a tick that decides what to buy or list. It never talks to the market daemon itself - the caller
// injects `placeBuy`, `placeSell`, `cancel` and `book`, so this module can be tested without a book and
// cannot invent an order behind the runtime's back.
//
// The Rust book accepts an order with no escrow check (audited 2026-11-03), so the rule here is simple:
// ISK leaves the trader's balance BEFORE a buy order exists, and comes back only when that order is
// provably gone (refused, cancelled or expired).
const fs = require("node:fs");
const path = require("node:path");
const { TRADERS, DEFAULTS } = require("./coopMarketMaker" + (__filename.endsWith(".js") ? "" : ".cjs"));

const pos = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const int = value => Math.trunc(Number(value) || 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = nowMs => Math.floor(Number(nowMs || Date.now()) / DAY_MS);

function enabled(env = process.env) {
  return String(env.EVEJS_COOP_MARKET_MAKERS || "") === "1";
}

function emptyState() {
  return { version: 1, traders: {}, operations: {} };
}

function normalize(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return emptyState();
  return {
    version: 1,
    traders: raw.traders && typeof raw.traders === "object" ? raw.traders : {},
    operations: raw.operations && typeof raw.operations === "object" ? raw.operations : {},
  };
}

const instancesByPath = new Map();

function createTraders({ file, clock = () => Date.now(), writeFile = null } = {}) {
  const filePath = String(file || process.env.EVEJS_COOP_MARKET_MAKER_FILE ||
    "/var/lib/evejs/coop-market-makers.json");
  // An injected writer means a test that expects its own writes: never share such an
  // instance. Otherwise one trading document is one object for the whole process, so a
  // per-tick createTraders() call cannot re-read and re-parse the file every tick.
  if (writeFile === null && instancesByPath.has(filePath)) {
    return instancesByPath.get(filePath);
  }
  const persist = writeFile || ((target, text) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf8");
  });

  // The document is loaded once and then lives here; read() never touches the disk again.
  // Callers mutate the returned object and then call write(state), exactly as before.
  let cached = null;
  function read() {
    if (cached) return cached;
    try {
      cached = normalize(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (_error) {
      cached = emptyState();
    }
    return cached;
  }
  function write(state) {
    cached = state;
    persist(filePath, JSON.stringify(state, null, 2) + "\n");
    return state;
  }

  function traderRecord(state, traderID, nowMs) {
    const trader = TRADERS.find(entry => entry.traderID === traderID) || null;
    if (!trader) return null;
    const existing = state.traders[traderID];
    const day = dayKey(nowMs);
    if (!existing) {
      state.traders[traderID] = {
        traderID,
        balanceISK: trader.bankrollISK,
        spentTodayISK: 0,
        day,
        orders: {},
        holdings: {},
      };
      return state.traders[traderID];
    }
    if (int(existing.day) !== day) {
      existing.day = day;
      existing.spentTodayISK = 0;
    }
    if (!existing.orders || typeof existing.orders !== "object") existing.orders = {};
    if (!existing.holdings || typeof existing.holdings !== "object") existing.holdings = {};
    return existing;
  }

  // Reserve first: the money is gone from the balance before any order can exist.
  function reserve({ traderID, amountISK, kind = "BUY", meta = {} } = {}) {
    const amount = pos(amountISK);
    if (!amount) return { status: "INVALID_AMOUNT" };
    const state = read();
    const nowMs = clock();
    const record = traderRecord(state, traderID, nowMs);
    if (!record) return { status: "UNKNOWN_TRADER" };
    const trader = TRADERS.find(entry => entry.traderID === traderID);
    if (record.balanceISK < amount) return { status: "NO_BALANCE" };
    if (record.spentTodayISK + amount > trader.dailySpendISK) return { status: "DAILY_CAP" };
    const operationID = `op-${nowMs}-${Object.keys(state.operations).length + 1}-${traderID}`;
    record.balanceISK -= amount;
    record.spentTodayISK += amount;
    state.operations[operationID] = {
      operationID, traderID, kind: String(kind), amountISK: amount,
      phase: "RESERVED", at: nowMs, meta,
    };
    write(state);
    return { status: "RESERVED", operationID, amountISK: amount };
  }

  // Bind only after the caller proved the order exists (a read-back), exactly like the player path.
  function bind(operationID, order = {}) {
    const state = read();
    const operation = state.operations[String(operationID || "")];
    if (!operation || operation.phase !== "RESERVED") return { status: "NOT_RESERVED" };
    const orderID = String((order && order.order_id) || "");
    if (!/^[1-9][0-9]*$/.test(orderID)) return { status: "ORDER_ID_REQUIRED" };
    operation.phase = "BOUND";
    operation.orderID = orderID;
    operation.boundAt = clock();
    const record = traderRecord(state, operation.traderID, clock());
    if (record) {
      record.orders[orderID] = {
        orderID, typeID: int(order.type_id) || int(operation.meta.typeID),
        stationID: int(order.station_id) || int(operation.meta.stationID),
        priceISK: Number(order.price) || Number(operation.meta.priceISK) || 0,
        quantity: int(order.quantity) || int(operation.meta.quantity) || 0,
        kind: operation.kind, operationID: operation.operationID,
        at: clock(), expiresAt: clock() + DEFAULTS.orderTtlMs,
      };
    }
    write(state);
    return { status: "BOUND", orderID };
  }

  // A refused or unknown call never keeps the money: the reservation is released in full.
  function refund(operationID, reason = "") {
    const state = read();
    const operation = state.operations[String(operationID || "")];
    if (!operation || operation.phase === "REFUNDED") return { status: "NOT_REFUNDABLE" };
    operation.phase = "REFUNDED";
    operation.refundedAt = clock();
    operation.reason = String(reason || "");
    const record = traderRecord(state, operation.traderID, clock());
    if (record) {
      record.balanceISK += operation.amountISK;
      record.spentTodayISK = Math.max(0, record.spentTodayISK - operation.amountISK);
    }
    write(state);
    return { status: "REFUNDED", amountISK: operation.amountISK };
  }

  // A value, not the live document: callers compare two snapshots (tests do) and a caller
  // must never be able to change the store by mutating what it was handed. The expensive part
  // was the per-call file read + JSON.parse, and that is gone - copying five trader records is
  // cheap next to re-parsing the whole document from disk.
  function snapshot() {
    const state = read();
    return typeof structuredClone === "function"
      ? structuredClone(state)
      : JSON.parse(JSON.stringify(state));
  }

  const api = Object.freeze({ reserve, bind, refund, snapshot, filePath });
  if (writeFile === null) instancesByPath.set(filePath, api);
  return api;
}

module.exports = { createTraders, enabled, emptyState, normalize, dayKey, TRADERS, DEFAULTS };
