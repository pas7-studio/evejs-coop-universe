import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// L8-02. The destination's remaining volume is one budget per type, spent across every source stack
// and station - and the LOAD step may not authorise more than the plan already capped.
//
// Authorship: Ornith A produced three attempts for this file; two were rejected by the syntax gate
// and one was truncated at the token limit before the file was complete. The coordinator wrote this
// version from the same behavioural contract and records it as a rescue in
// review/ATTRIBUTION-L8.md. The production change it tests is not a rescue.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {planBundle} = require(path.join(forkRoot, "Code/server/src/space/coopNpcDistribution.js"));
const run = require(path.join(forkRoot, "Code/server/src/space/coopDistributionRun.js"));

const ORIGIN_STATION = 60000682;
const DEST_STATION = 60003760;
const ORIGIN_SYSTEM = 30000145;
const HAULER = 980000093319;
const TRIT = 34;
const PYERITE = 35;

const stack = (quantity, typeID = TRIT, stationID = ORIGIN_STATION) =>
  ({typeID, stationID, quantity, m3PerUnit: 0.01});

const plan = (stacks, bids, capacityM3 = 3100) => planBundle({
  stacks, destination: {stationID: DEST_STATION, bids}, local: {stationID: 0, bids: {}},
  capacityM3, minIsk: 0,
});

const shippedOf = (items, typeID) => items
  .filter((row) => Number(row.typeID) === typeID)
  .reduce((sum, row) => sum + Number(row.quantity), 0);

test("two stacks cannot spend a buyer's volume twice", () => {
  const answer = plan([stack(10000), stack(10000)], {[TRIT]: {price: 3.71, volume: 12000}});
  assert.equal(answer.status, "TRIP");
  assert.equal(shippedOf(answer.items, TRIT), 12000,
    "the buyer offered 12 000 units, so at most 12 000 may be planned");
  assert.equal(answer.totalIsk, 12000 * 3.71,
    "revenue must be booked only on units the buyer offered");
});

test("three types keep three separate buyer budgets", () => {
  const answer = plan([stack(10000, 34), stack(10000, 35), stack(10000, 36)],
    {34: {price: 3.71, volume: 5000}, 35: {price: 15.13, volume: 7000},
      36: {price: 9.4, volume: 2000}});
  assert.equal(shippedOf(answer.items, 34), 5000);
  assert.equal(shippedOf(answer.items, 35), 7000);
  assert.equal(shippedOf(answer.items, 36), 2000);
});

test("one buyer served from three stations gets one budget", () => {
  const answer = plan([
    stack(6000, TRIT, 60000682), stack(6000, TRIT, 60000683), stack(6000, TRIT, 60000684),
  ], {[TRIT]: {price: 3.71, volume: 9000}});
  assert.equal(shippedOf(answer.items, TRIT), 9000,
    "the cap is per buyer, not per source station");
});

test("the hold still bounds the load when it is the smaller limit", () => {
  const answer = plan([stack(10000), stack(10000)], {[TRIT]: {price: 3.71, volume: 12000}}, 50);
  assert.equal(shippedOf(answer.items, TRIT), 5000);
});

test("an exhausted buyer is refused instead of shipped to", () => {
  const answer = plan([stack(10000)], {[TRIT]: {price: 3.71, volume: 0}});
  assert.equal(answer.status, "NO_TRIP");
  assert.deepEqual(answer.items, []);
});

test("no phantom revenue and no emptied warehouse", () => {
  const answer = plan([stack(10000), stack(10000)], {[TRIT]: {price: 3.71, volume: 12000}});
  const shipped = shippedOf(answer.items, TRIT);
  const billed = answer.items.reduce((sum, row) => sum + Number(row.quantity) * Number(row.price), 0);
  assert.equal(billed, answer.totalIsk);
  assert.ok(shipped <= 12000, "shipped more than the buyer's volume");
  assert.ok(20000 - shipped > 0, "the warehouse was emptied into a capped bid");
});

test("PLAN into LOAD: the loader is authorised for no more than the capped demand", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l8-02-"));
  const env = {...process.env, EVEJS_COOP_NPC_MARKET_ROOT: root};
  fs.mkdirSync(path.join(root, "distribution-run"), {recursive: true});
  const journal = {version: 1, haulerID: HAULER, phase: "LOAD", updatedAt: 1793631970172,
    fromStationID: ORIGIN_STATION, fromSystemID: ORIGIN_SYSTEM,
    trip: {demand: {[TRIT]: {price: 3.71, volume: 12000}}},
    stops: [{stationID: ORIGIN_STATION, items: [
      {typeID: TRIT, quantity: 10000, price: 3.71},
      {typeID: TRIT, quantity: 10000, price: 3.71}]}],
    stopIndex: 0};
  fs.writeFileSync(path.join(root, "distribution-run", HAULER + ".json"), JSON.stringify(journal));
  let demanded = null;
  const authorities = {
    now: 1793631970172, observe: () => {}, hullSystemOf: () => ORIGIN_SYSTEM,
    distanceTo: () => 0, capacityM3: () => 3100,
    lift: (request) => { demanded = request.demand; return {status: "LIFTED"}; },
  };
  try {
    await run.tick(HAULER, authorities, env);
    assert.ok(demanded && demanded[TRIT], "the LOAD step passed no demand to the lift");
    assert.equal(demanded[TRIT].volume, 12000,
      "the loader was authorised for more units than the buyer offered");
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test("a type the trip does not want is not loaded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l8-02b-"));
  const env = {...process.env, EVEJS_COOP_NPC_MARKET_ROOT: root};
  fs.mkdirSync(path.join(root, "distribution-run"), {recursive: true});
  const journal = {version: 1, haulerID: HAULER, phase: "LOAD", updatedAt: 1793631970172,
    fromStationID: ORIGIN_STATION, fromSystemID: ORIGIN_SYSTEM,
    trip: {demand: {[TRIT]: {price: 3.71, volume: 4000}}},
    stops: [{stationID: ORIGIN_STATION, items: [
      {typeID: TRIT, quantity: 4000, price: 3.71},
      {typeID: PYERITE, quantity: 9000, price: 15.13}]}],
    stopIndex: 0};
  fs.writeFileSync(path.join(root, "distribution-run", HAULER + ".json"), JSON.stringify(journal));
  let demanded = null;
  const authorities = {
    now: 1793631970172, observe: () => {}, hullSystemOf: () => ORIGIN_SYSTEM,
    distanceTo: () => 0, capacityM3: () => 3100,
    lift: (request) => { demanded = request.demand; return {status: "LIFTED"}; },
  };
  try {
    await run.tick(HAULER, authorities, env);
    assert.equal(demanded[TRIT].volume, 4000);
    assert.equal(demanded[PYERITE], undefined,
      "a type outside the trip's capped demand must not be offered to the lift");
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
