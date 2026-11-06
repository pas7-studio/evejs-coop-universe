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
  executor, wallet = null, buyMaxPct = null, minProfitBps = null, seedStation = STATION,
  playerEscrow = null } = {}) {
  const journalFile = path.join(os.tmpdir(),
    `trader-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const calls = [];
  const maker = createTraderMaker({
    call: async (method, params) => {
      calls.push({ method, params });
      if (method !== "GetOrders") throw new Error("unexpected " + method);
      const sells = [];
      if (seedPrice > 0) {
        sells.push({ order_id: 5001, type_id: params.type_id, station_id: seedStation, price: seedPrice / 100,
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
    readPlayerAsks: playerEscrow === null ? null : async () => playerEscrow,
    journalFile,
    clock: () => 1_000_000,
    env: { EVEJS_COOP_TRADER_MAKER: "1", EVEJS_COOP_TRADER_MAKER_MODE: mode,
      EVEJS_COOP_TRADER_CORP_ID: "1000035" },
    minReserveCents: 10_000_00,
    maxSpendPerTickCents: 1_000_000_00,
    maxLotUnits: 50,
    buyMaxPct,
    minProfitBps,
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
  // A real market order id is a 64-bit integer and does not fit a JS number: it must survive as text.
  const BIG_ORDER = "2257714186837032994";
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: BIG_ORDER, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async (args) => { seen.push(args); return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 12, itemID: 34 }; } });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_SETTLED");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].orderID, BIG_ORDER, "the 64-bit order id is passed through untouched");
  assert.equal(seen[0].buyerCorpID, 1000035);
  assert.equal(seen[0].quantity, 50, "the whole ask, because the executor can only claim whole");
  assert.equal(seen[0].maxUnitPriceCents, 850, "never above the ask we planned on");
  assert.match(seen[0].claimKey, /^npc-corpbuy:[0-9a-f]{32}$/);
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims[BIG_ORDER].phase, "SETTLED");
  assert.equal(journal.claims[BIG_ORDER].fillID, 12);
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

test("an ambiguous claim is resumed with the SAME key, and fenced after six attempts", async () => {
  // The executor's fill id is a pure function of the claim key, so resuming is safe by construction:
  // it finds its own durable marker and settles once, or finds the receipt and pays nothing.
  let buys = 0;
  const keys = [];
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async (args) => { buys += 1; keys.push(args.claimKey); throw new Error("rpc timeout"); } });
  const first = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(first.status, "TRADER_MAKER_NOT_SETTLED");
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims["9001"].phase, "PREPARED", "write-ahead, never silently completed");
  assert.equal(journal.claims["9001"].attempts, 1);
  for (let tick = 0; tick < 6; tick += 1) await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 6, "retried, but bounded");
  assert.ok(keys.every((key) => key === keys[0]), "every retry reuses the original claim key");
  const fenced = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 6, "after the attempt ceiling the order is left for an operator");
  assert.ok(["TRADER_MAKER_ALREADY_HANDLED", "TRADER_MAKER_NO_BARGAIN"].includes(fenced.status));
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

// Measured 2026-11-05 (externalservices/market-server/src/state.rs): the public book is built from
// the seed_stock table only, so a real player order never appears in GetOrders. The player's asks
// therefore come from the GameStore escrow authority, merged into the same plan.
test("player asks come from the escrow authority, because the public book cannot show them", async () => {
  const journalFile = path.join(os.tmpdir(), `trader-escrow-${process.pid}-${Date.now()}.json`);
  const seenTypes = [];
  const maker = createTraderMaker({
    call: async (method, params) => {
      if (method !== "GetOrders") throw new Error("unexpected " + method);
      // The book: the seed ask is the reference, and it contains NO player rows at all.
      return { sells: [{ order_id: 5001, type_id: params.type_id, station_id: STATION,
        price: 10, vol_remaining: 1000, source: "seed", bid: false }] };
    },
    getStation: () => HUB,
    readWalletCents: () => 5_000_000_000_000,
    readPlayerAsks: (hub, typeID) => {
      seenTypes.push({ hub, typeID });
      if (Number(typeID) !== 34) return [];
      // The escrow row as the GameStore really stores it: price in ISK, order id as text.
      return [{ orderID: "2257714186837032994", remainingQuantity: 100, unitPriceCents: 800 }];
    },
    journalFile,
    clock: () => 1_000_000,
    env: { EVEJS_COOP_TRADER_MAKER: "1", EVEJS_COOP_TRADER_MAKER_MODE: "plan",
      EVEJS_COOP_TRADER_CORP_ID: "1000035" },
    minReserveCents: 0,
  });
  const result = await maker.tick({ stationID: STATION, typeIDs: [34, 35] });
  assert.equal(result.typesWithPlayerAsks, 1, "only the type the escrow authority names");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].typeID, 34);
  assert.equal(result.candidates[0].lot.sourceOrderID, "2257714186837032994");
  assert.equal(result.candidates[0].referenceCents, 1000, "the seed ask is still the reference");
  assert.equal(result.candidates[0].lot.buyUnitPriceCents, 800, "the escrowed price, in cents");
  assert.ok(seenTypes.every((row) => row.hub === STATION));
  fs.rmSync(journalFile, { force: true });
});

test("an escrowed ask outside the band is read but not bought", async () => {
  const journalFile = path.join(os.tmpdir(), `trader-band-${process.pid}-${Date.now()}.json`);
  const maker = createTraderMaker({
    call: async (method, params) => (method === "GetOrders"
      ? { sells: [{ order_id: 5001, type_id: params.type_id, station_id: STATION,
        price: 10, vol_remaining: 1000, source: "seed", bid: false }] }
      : null),
    getStation: () => HUB,
    readWalletCents: () => 5_000_000_000_000,
    readPlayerAsks: () => [{ orderID: "7", remainingQuantity: 10, unitPriceCents: 950 }],
    journalFile,
    clock: () => 1_000_000,
    env: { EVEJS_COOP_TRADER_MAKER: "1", EVEJS_COOP_TRADER_MAKER_MODE: "plan",
      EVEJS_COOP_TRADER_CORP_ID: "1000035" },
    minReserveCents: 0,
  });
  const result = await maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_NO_BARGAIN", "95 % of the market is not a bargain");
  assert.equal(result.typesWithPlayerAsks, 1);
  assert.equal(result.candidates.length, 0);
  fs.rmSync(journalFile, { force: true });
});

// Owner rule 2026-11-06: "buy the asks if they are a reasonable price". The band is a number: 1.0
// means "at or below the real ask", so a player asking the market price still gets bought, and the
// 3 % spread floor is what makes that a trade instead of a gift.
test("a reasonable price is bought: the band can be the market itself", async () => {
  const seen = [];
  const f = fixture({ mode: "live", buyMaxPct: 1, minProfitBps: 300,
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 1000 }],
    executor: async (args) => { seen.push(args);
      return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 7, itemID: 34 }; } });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_SETTLED");
  assert.equal(seen[0].maxUnitPriceCents, 1000, "100 % of the reference is inside a 100 % ceiling");
  fs.rmSync(f.journalFile, { force: true });
});

test("a clean refusal is retried a bounded number of times, then fenced", async () => {
  let buys = 0;
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    executor: async () => { buys += 1;
      return { status: "BLOCKED", reason: "NPC_LIFT_ORDER_BUSY" }; } });
  for (let tick = 0; tick < 3; tick += 1) await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims["9001"].phase, "REFUSED");
  assert.equal(journal.claims["9001"].refusals, 3);
  assert.equal(journal.claims["9001"].reason, "NPC_LIFT_ORDER_BUSY");
  const fenced = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 3, "a refused order that keeps refusing is not hammered forever");
  assert.ok(["TRADER_MAKER_NO_BARGAIN", "TRADER_MAKER_ALREADY_HANDLED"].includes(fenced.status),
    "the fenced type is not even planned");
  fs.rmSync(f.journalFile, { force: true });
});

test("a stack bigger than the lot cap is skipped, never silently shrunk", async () => {
  let buys = 0;
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 500, unitPriceCents: 850 }],
    executor: async () => { buys += 1;
      return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 1, itemID: 2 }; } });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(buys, 0, "a 500-unit ask cannot be paid for 50 units: it is one whole escrow stack");
  assert.equal(result.status, "TRADER_MAKER_SKIPPED");
  assert.equal(result.refused[0].reason, "LOT_REQUIRES_PARTIAL_SETTLEMENT");
  fs.rmSync(f.journalFile, { force: true });
});

test("a hub with no ask of its own still gets a price from the region, not from nowhere", async () => {
  // The seeded stock for a junk type often sits at another station in The Forge. That is still a
  // real market price, and refusing to look at it was another way the owner's goods never sold.
  const f = fixture({ seedStation: 60003761,
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }] });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_PLAN");
  assert.equal(result.candidates[0].referenceCents, 1000, "the regional ask is the reference");
  assert.equal(result.candidates[0].referenceScope, "REGION");
  fs.rmSync(f.journalFile, { force: true });

  const hub = fixture({ playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50,
    unitPriceCents: 850 }] });
  const atHub = await hub.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(atHub.candidates[0].referenceScope, "HUB", "the hub always wins when it has an ask");
  fs.rmSync(hub.journalFile, { force: true });
});

test("an ask in both the book and the escrow gets its SELLER from the escrow", async () => {
  // Measured live 2026-11-06: the book row carries the price but no owner, so lot.sellerOwnerID was 0
  // and every attempt answered BLOCKED:NPC_LIFT_REQUEST_INVALID. The escrow row names the seller.
  const seen = [];
  const f = fixture({ mode: "live",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    playerEscrow: [{ orderID: "9001", remainingQuantity: 50, unitPriceCents: 850,
      sellerOwnerID: 140000005 }],
    executor: async (args) => { seen.push(args);
      return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 3, itemID: 4 }; } });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_SETTLED");
  assert.equal(seen[0].sellerID, 140000005, "the settlement knows whom to pay");
  assert.equal(seen[0].quantity, 50);
  fs.rmSync(f.journalFile, { force: true });
});

test("book and escrow disagreeing on quantity or price is not an offer", async () => {
  const f = fixture({ mode: "plan",
    playerAsks: [{ typeID: 34, orderID: 9001, remainingQuantity: 50, unitPriceCents: 850 }],
    playerEscrow: [{ orderID: "9001", remainingQuantity: 50, unitPriceCents: 900,
      sellerOwnerID: 140000005 }] });
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(result.status, "TRADER_MAKER_NO_BARGAIN");
  fs.rmSync(f.journalFile, { force: true });
});

test("a claim the executor already started is finished before anything new is planned", async () => {
  // The order is no longer on the book at all (the fill closed it), so only the journal can find it.
  const calls = [];
  const claimKey = "npc-corpbuy:" + "a".repeat(32);
  const f = fixture({ mode: "live", playerAsks: [],
    executor: async (args) => { calls.push(args);
      return { status: "NPC_PURCHASED_PLAYER_GOODS", fillID: 9, itemID: 8 }; } });
  fs.writeFileSync(f.journalFile, JSON.stringify({ version: 1, claims: { "286": {
    phase: "PREPARED", claimKey, typeID: 21472, stationID: STATION, quantity: 1,
    unitPriceCents: 6_470_000_000, sellerID: 140000005, createdAt: 1, attempts: 1, refusals: 0,
  } } }));
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(calls.length, 1, "the pending claim is resumed even with nothing to plan");
  assert.equal(calls[0].claimKey, claimKey, "with the same claim key, so it cannot pay twice");
  assert.equal(calls[0].sellerID, 140000005);
  assert.equal(calls[0].orderID, "286");
  assert.equal(result.status, "TRADER_MAKER_SETTLED");
  assert.equal(result.executions[0].resumed, true);
  const journal = JSON.parse(fs.readFileSync(f.journalFile, "utf8"));
  assert.equal(journal.claims["286"].phase, "SETTLED");
  assert.equal(journal.claims["286"].fillID, 9);
  fs.rmSync(f.journalFile, { force: true });
});

test("a claim with no recorded seller is left for an operator instead of guessing", async () => {
  const calls = [];
  const f = fixture({ mode: "live", playerAsks: [],
    executor: async (args) => { calls.push(args); return { status: "BLOCKED", reason: "x" }; } });
  fs.writeFileSync(f.journalFile, JSON.stringify({ version: 1, claims: { "286": {
    phase: "PREPARED", claimKey: "npc-corpbuy:" + "b".repeat(32), typeID: 21472,
    stationID: STATION, quantity: 1, unitPriceCents: 6_470_000_000, createdAt: 1, attempts: 1,
  } } }));
  const result = await f.maker.tick({ stationID: STATION, typeIDs: [34] });
  assert.equal(calls.length, 0);
  assert.equal(result.status, "TRADER_MAKER_ALREADY_HANDLED");
  fs.rmSync(f.journalFile, { force: true });
});
