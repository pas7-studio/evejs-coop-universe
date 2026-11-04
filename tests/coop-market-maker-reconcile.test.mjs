import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// MEASURED 2026-11-05 on the work stack: coop-market-makers.json had grown to 12 MB with
// 33 184 operations, ALL of them still phase RESERVED and zero live order rows. Every tick
// tried the same placement again (a thrown placement keeps the money "reserved for
// reconciliation", by design) and every retry debited the maker again, while nothing ever
// reconciled or pruned. Two rules fix that: one open reservation per trader and type, and a
// reconcile pass that returns money for reservations no order can match.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createTraders, TRADERS} = require(path.join(
  forkRoot, "Code/server/src/space/coopMarketMakerTraders.js"));

const TRADER_ID = TRADERS[0].traderID;

function store({clock} = {}) {
  const file = path.join(os.tmpdir(), `mm-reconcile-${process.pid}-${Math.random()}.json`);
  const tick = clock || {now: 1_800_000_000_000};
  const traders = createTraders({file, clock: () => tick.now});
  return {traders, file, clock: tick};
}

test("a trader cannot stack two open reservations for the same type", () => {
  const {traders, file} = store();
  const first = traders.reserve({traderID: TRADER_ID, amountISK: 1000,
    meta: {typeID: 34, stationID: 60003760, priceISK: 100, quantity: 10}});
  assert.equal(first.status, "RESERVED");
  const balanceAfterFirst = traders.snapshot().traders[TRADER_ID].balanceISK;
  const second = traders.reserve({traderID: TRADER_ID, amountISK: 1000,
    meta: {typeID: 34, stationID: 60003760, priceISK: 100, quantity: 10}});
  assert.equal(second.status, "RESERVATION_PENDING",
    "the retry reuses the open reservation instead of spending again");
  assert.equal(second.operationID, first.operationID);
  assert.equal(traders.snapshot().traders[TRADER_ID].balanceISK, balanceAfterFirst,
    "the balance is debited once, not once per retry");
  fs.rmSync(file, {force: true});
});

test("a different type still gets its own reservation", () => {
  const {traders, file} = store();
  const first = traders.reserve({traderID: TRADER_ID, amountISK: 500, meta: {typeID: 34}});
  const second = traders.reserve({traderID: TRADER_ID, amountISK: 500, meta: {typeID: 35}});
  assert.equal(first.status, "RESERVED");
  assert.equal(second.status, "RESERVED");
  assert.notEqual(first.operationID, second.operationID);
  fs.rmSync(file, {force: true});
});

test("an unmatched reservation older than the stale window is refunded", () => {
  const clock = {now: 1_800_000_000_000};
  const {traders, file} = store({clock});
  const reserved = traders.reserve({traderID: TRADER_ID, amountISK: 4000, meta: {typeID: 36}});
  const debited = traders.snapshot().traders[TRADER_ID].balanceISK;
  clock.now += 2 * 60 * 60 * 1000; // past the one-hour stale window
  const result = traders.reconcile({nowMs: clock.now});
  assert.equal(result.status, "RECONCILED");
  assert.equal(result.refunded.length, 1);
  assert.equal(result.refunded[0].operationID, reserved.operationID);
  const after = traders.snapshot();
  assert.equal(after.traders[TRADER_ID].balanceISK, debited + 4000, "the money came back");
  assert.equal(after.operations[reserved.operationID].phase, "REFUNDED");
  assert.equal(after.operations[reserved.operationID].reason, "STALE_RESERVATION");
  fs.rmSync(file, {force: true});
});

test("a reservation a live order still points at is never refunded", () => {
  const clock = {now: 1_800_000_000_000};
  const {traders, file} = store({clock});
  const reserved = traders.reserve({traderID: TRADER_ID, amountISK: 900, meta: {typeID: 37}});
  traders.bind(reserved.operationID, {order_id: "5001", type_id: 37, station_id: 60003760,
    price: 90, quantity: 10});
  const balanceBound = traders.snapshot().traders[TRADER_ID].balanceISK;
  clock.now += 2 * 60 * 60 * 1000;
  const result = traders.reconcile({nowMs: clock.now});
  assert.equal(result.refunded.length, 0, "a bound order keeps its escrow");
  assert.equal(traders.snapshot().traders[TRADER_ID].balanceISK, balanceBound);
  fs.rmSync(file, {force: true});
});

test("the document is pruned and capped so it cannot grow to megabytes again", () => {
  const clock = {now: 1_800_000_000_000};
  const {traders, file} = store({clock});
  // Settle a batch of reservations, then let the retention window pass.
  for (let index = 0; index < 40; index += 1) {
    const reserved = traders.reserve({traderID: TRADER_ID, amountISK: 100,
      meta: {typeID: 100 + index}});
    if (reserved.status === "RESERVED") traders.refund(reserved.operationID, "TEST");
    clock.now += 10;
  }
  const before = traders.snapshot();
  const beforeCount = Object.keys(before.operations).length;
  assert.ok(beforeCount > 0);
  clock.now += 8 * 24 * 60 * 60 * 1000; // past the seven-day retention
  const result = traders.reconcile({nowMs: clock.now});
  assert.ok(result.pruned >= beforeCount, "settled rows older than retention are dropped");
  assert.equal(Object.keys(traders.snapshot().operations).length, 0);
  fs.rmSync(file, {force: true});
});

test("reconcile is cheap: it refuses to run again inside its window", () => {
  const clock = {now: 1_800_000_000_000};
  const {traders, file} = store({clock});
  assert.equal(traders.reconcile({nowMs: clock.now}).status, "RECONCILED");
  assert.equal(traders.reconcile({nowMs: clock.now + 500}).status, "SKIPPED");
  fs.rmSync(file, {force: true});
});
