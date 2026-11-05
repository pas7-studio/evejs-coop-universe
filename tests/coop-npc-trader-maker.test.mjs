import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// COOP-MMD: the driver behind the owner's market-maker bands ("buy everything at 70-90 % of the
// market, resell at 105-140 %"). These tests pin the book reading, the reference price, plan versus
// live mode, the write-ahead journal and the rule that an ambiguous settlement is never retried.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createTraderMaker } = require(path.join(forkRoot, "Code/server/src/space/coopNpcTraderMaker.js"));

const STATION = 60003760;
const HUB = { stationID: STATION, regionID: 10000002, stationName: "Jita IV - 4" };

function fixture({ cashCents = 5_000_000_00, mode = "plan", playerAsks = [], seedPrice = 1000,
  executor, wallet = null } = {}) {
  const journalFile = path.join(os.tmpdir(),
    `trader-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const calls = [];
  const maker = createTraderMaker({
    call: async (method, params) => {
      calls.push({ method, params });
      if (method !== "GetOrders") throw new Error("unexpected " + method);
      const sells = [];
      if (seedPrice > 0) {
        sells.push({ order_id: 5001, type_id: params.type_id, station_id: STATION, price: seedPrice / 100,
          vol_remaining: 1000, source: "seed", bid: false });
      }
      for (const ask of playerAsks) {
        sells.push({ order_id: ask.orderID, type_id: ask.typeID, station_id: STATION,
          price: ask.unitPriceCents / 100, vol_remaining: ask.remainingQuantity,
          source: "player", bid: false });
      }
      return { sells, buys: [] };
    },
    getStation: (id) => (Number(id) === STATION ? HUB : null),
    readWalletCents: () => (wallet === "unreadable" ? null : wallet === null ? cashCents : wallet),
    buyAsk: executor === undefined ? undefined : executor,
    journalFile,
    clock: () => 1_000_000,
    env: { EVEJS_COOP_TRADER_MAKER: "1", EVEJS_COOP_TRADER_MAKER_MODE: mode,
      EVEJS_COOP_TRADER_CORP_ID: "1000035" },
    minReserveCents: 10_000_00,
    maxSpendPerTickCents: 1_000_000_00,
    maxLotUnits: 50,
  });
  return { maker, journalFile, calls };
}

test("only player asks under 90 % of the cheapest seed ask are candidates", async () => {
  const f = fixture({ playerAsks: [
    { typeID: 34, orderID: 9001, remainingQuantity: 500, unitPriceCents: 850 },   // 85 % - bargain
    { typeID: 35, orderID: 9002, remainingQuantity: 500, unitPriceCents: 950 },   // 95 % - no
  ] });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34, 35] });
  assert.equal(result.status, "TRADER_MAKER_PLAN");
  assert.equal(result.mode, "PLAN");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].typeID, 34);
  assert.equal(result.candidates[0].buyCeilingCents, 900, "90 % of a 1 000 ISK reference");
  assert.equal(result.candidates[0].lot.quantity, 50, "one small lot, not the whole stack");
  assert.equal(result.candidates[0].lot.sellTargetUnitPriceCents, 1400, "resale target 140 %");
  fs.rmSync(f.journalFile, { force: true });
});

test("plan mode never calls the executor", async () => {
  const f = fixture({ playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 500, unitPriceCents: 850 }] });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.executions.length, 0);
  assert.equal(result.status, "TRADER_MAKER_PLAN");
  fs.rmSync(f.journalFile, { force: true });
});

test("live mode buys ONE whole player ask and journals it as settled", async () => {
  const seen = [];
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async (args) => { seen.push(args); return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 12, itemID: 34 }; } });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_SETTLED");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].orderID, 9001);
  assert.equal(seen[0].buyerCorpID, 1000035);
  assert.equal(seen[0].quantity, 50, "the whole ask, because the executor can only claim whole");
  assert.equal(seen[0].maxUnitPriceCents, 850, "never above the ask we planned on");
  assert.match(seen[0].claimKey, /^npc-corpbuy:[0-9a-f]{32}$/);
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims["9001"].phase, "SETTLED");
  assert.equal(journal.claims["9001"].fillID, 12);
  assert.equal(result.executions[0].settled, true);
  fs.rmSync(f.journalFile, { force: true });
});

test("a settled order is never bought twice", async () => {
  let buys = 0;
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async () => { buys += 1; return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 1, itemID: 2 }; } });
  await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  const second = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 1, "one purchase, ever, for that order id");
  assert.equal(second.status, "TRADER_MAKER_ALREADY_HANDLED",
    "the same order is never lifted twice; the journal is the memory");
  fs.rmSync(f.journalFile, { force: true });
});

test("an unresolved claim fences the type until an operator looks at it", async () => {
  let buys = 0;
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async () => { buys += 1; throw new Error("rpc timeout"); } });
  const first = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(first.status, "TRADER_MAKER_NOT_SETTLED");
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims["9001"].phase, "PREPARED", "write-ahead, never silently completed");
  const second = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 1, "an ambiguous native outcome is never retried automatically");
  assert.ok(["TRADER_MAKER_ALREADY_HANDLED", "TRADER_MAKER_NO_BARGAIN"].includes(second.status));
  fs.rmSync(f.journalFile, { force: true });
});

test("no wallet, no hub or a missing flag refuses instead of trading", async () => {
  const broke = fixture({ wallet: "unreadable", playerAsks: [
    { typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }] });
  const blocked = await broke.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.reason, "TRADER_MAKER_WALLET_UNREADABLE",
    "a wallet that cannot be read is not a wallet with money");
  fs.rmSync(broke.journalFile, { force: true });

  const off = createTraderMaker({
    call: async () => ({ sells: [] }), getStation: () => HUB, readWalletCents: () => 1,
    journalFile: path.join(os.tmpdir(), `trader-off-${Date.now()}.json`),
    env: {}, clock: () => 1,
  });
  assert.equal((await off.tick({ stationID: STATION, typeIDs: [34] })).status, "DISABLED");

  const noHub = fixture({ playerAsks: [] });
  assert.equal((await noHub.maker.tick({ stationID: 1, typeIDs: [34] })).status, "BLOCKED");
  fs.rmSync(noHub.journalFile, { force: true });

  const liveNoExecutor = fixture({ mode: "live", playerAsks: [] });
  assert.equal((await liveNoExecutor.maker.tick({ stationID: STATION, typeIDs: [34] })).reason,
    "TRADER_MAKER_EXECUTOR_NOT_WIRED");
  fs.rmSync(liveNoExecutor.journalFile, { force: true });
});
