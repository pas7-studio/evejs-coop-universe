
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The working half: real bids on the book, money booked before the order exists, and every refusal
// returning the money. No network here - the market is injected, so this tests our half only.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createTraders} = require(path.join(
  forkRoot, "Code/server/src/space/coopMarketMakerTraders.js"));
const {tick} = require(path.join(
  forkRoot, "Code/server/src/space/coopMarketMakerRuntime.js"));

function store(clock = {now: 1_000_000}) {
  const file = path.join(os.tmpdir(), `mk-${process.pid}-${Math.random()}.json`);
  const traders = createTraders({file, clock: () => clock.now});
  return {traders, file, clock};
}
const ON = {EVEJS_COOP_MARKET_MAKERS: "1", EVEJS_COOP_MARKET_MAKERS_COUNT: "1"};

test("a disabled maker places nothing", async () => {
  const {traders, file} = store();
  const report = await tick({traders, book: () => ({referenceISK: 1000}), placeBuy: async () => ({ok: true}), env: {}});
  assert.equal(report.status, "DISABLED");
  fs.rmSync(file, {force: true});
});

test("a real bid is placed, its ISK is booked before the order exists", async () => {
  const {traders, file, clock} = store();
  const calls = [];
  const report = await tick({
    traders, env: ON, now: clock.now, types: [34],
    book: () => ({typeID: 34, stationID: 60003760, referenceISK: 1000, bestAskISK: 2000, quantity: 2}),
    placeBuy: async request => {
      // the money must already be gone when the order is placed
      const state = traders.snapshot();
      const record = state.traders[request.ownerID];
      assert.ok(record.balanceISK < 100_000_000_000, "balance debited before the order");
      calls.push(request);
      return {ok: true, order: {order_id: "9001", type_id: 34, station_id: 60003760,
        price: request.priceISK, quantity: request.quantity}};
    },
  });
  assert.equal(report.placed.length, 1);
  assert.equal(calls.length, 1);
  const placed = report.placed[0];
  assert.ok(placed.priceISK > 0 && placed.priceISK < 2000, "never above the ask");
  const state = traders.snapshot();
  assert.equal(state.traders[placed.traderID].orders["9001"].typeID, 34, "the order is bound to the trader");
  fs.rmSync(file, {force: true});
});

test("a refused order returns the money in full", async () => {
  const {traders, file, clock} = store();
  const before = traders.snapshot();
  await tick({
    traders, env: ON, now: clock.now, types: [35],
    book: () => ({typeID: 35, stationID: 60003760, referenceISK: 500, quantity: 1}),
    placeBuy: async () => ({ok: false}),
  });
  const after = traders.snapshot();
  const trader = Object.keys(after.traders)[0];
  assert.equal(after.traders[trader].balanceISK, 100_000_000_000, "nothing was spent");
  assert.equal(Object.keys(after.traders[trader].orders).length, 0);
  assert.ok(before.traders[trader] === undefined);
  fs.rmSync(file, {force: true});
});

test("an expired order is cancelled and its money returned", async () => {
  const {traders, file, clock} = store();
  await tick({
    traders, env: ON, now: clock.now, types: [36],
    book: () => ({typeID: 36, stationID: 60003760, referenceISK: 1000, quantity: 1}),
    placeBuy: async () => ({ok: true, order: {order_id: "9100", type_id: 36, station_id: 60003760,
      price: 900, quantity: 1}}),
  });
  const trader = Object.keys(traders.snapshot().traders)[0];
  const snapshotAfterBuy = traders.snapshot().traders[trader];
  const spent = snapshotAfterBuy.balanceISK;
  const boundOperationID = String(snapshotAfterBuy.orders["9100"].operationID || "");
  const reserved = Number((traders.snapshot().operations[boundOperationID] || {}).amountISK) || 0;
  clock.now += 4 * 60 * 60 * 1000; // past the 3 h TTL
  const cancelled = [];
  const report = await tick({
    traders, env: ON, now: clock.now, types: [],
    book: () => null,
    placeBuy: async () => ({ok: false}),
    cancel: async orderID => { cancelled.push(orderID); return {ok: true}; },
  });
  assert.deepEqual(cancelled, ["9100"]);
  assert.equal(report.cancelled.length, 1);
  assert.equal(traders.snapshot().traders[trader].balanceISK, spent + reserved, "the escrow came back");
  fs.rmSync(file, {force: true});
});

test("an empty book still gives a maker a reference: the seeder fallback", () => {
  // market-common::fallback_base_price - the same number the book itself was seeded from.
  const expected = Math.max(10000 + (34 % 250) * 250, 1000);
  assert.equal(expected, 18500);
});
