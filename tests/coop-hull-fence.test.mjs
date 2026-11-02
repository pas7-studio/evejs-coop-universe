import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// L7-C. A timeout must fence the hull, not free it: the losing tick keeps running, so a second
// mutation on the same hull is forbidden until the first settles or an operator clears the fence.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const MODULE = path.join(forkRoot, "Code/server/src/space/coopDistributionRun.js");
const HAULER = 980000093319;

function fresh(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l7c-" + label + "-"));
  const env = {...process.env, EVEJS_COOP_NPC_MARKET_ROOT: dir};
  fs.mkdirSync(path.join(dir, "distribution-run"), {recursive: true});
  // INFLIGHT is process-wide by design, so every case gets its own module registry.
  delete require.cache[require.resolve(MODULE)];
  return {dir, env, run: require(MODULE)};
}
const journal = (env) => path.join(env.EVEJS_COOP_NPC_MARKET_ROOT, "distribution-run", HAULER + ".json");
const fence = (env) => path.join(env.EVEJS_COOP_NPC_MARKET_ROOT, "distribution-run", HAULER + ".fence.json");
const seed = (env) => fs.writeFileSync(journal(env), JSON.stringify({version: 1, haulerID: HAULER,
  phase: "PLAN", updatedAt: 1793631970172}), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a never-settling tick fences the hull and is never run twice", async () => {
  const {dir, env, run} = fresh("hang");
  const keeper = setInterval(() => {}, 1000);
  try {
    seed(env);
    let calls = 0;
    const frozen = new Promise(() => {});
    const authorities = {hulls: () => [HAULER], hullTimeoutMs: 1000,
      planTrip: () => { calls += 1; return frozen; }, distanceTo: () => 0,
      hullSystemOf: () => 30000145};
    const before = fs.readFileSync(journal(env), "utf8");
    const first = await run.tickAll(authorities, env);
    assert.equal(first[0].status, "HULL_TIMEOUT");
    assert.ok(fs.existsSync(fence(env)), "a timeout must leave a durable fence");
    const second = await run.tickAll(authorities, env);
    assert.equal(second[0].status, "FENCED_UNRECONCILED");
    assert.equal(calls, 1, "a fenced hull cannot start a second execution");
    assert.equal(fs.readFileSync(journal(env), "utf8"), before,
      "the timeout path must not write the journal of a live execution");
  } finally { clearInterval(keeper); fs.rmSync(dir, {recursive: true, force: true}); }
});

test("a fence that names a fresh process still blocks, and only clearFence lifts it", async () => {
  const {dir, env} = fresh("restart");
  seed(env);
  fs.writeFileSync(fence(env), JSON.stringify({version: 1, haulerID: HAULER,
    reason: "HULL_TIMEOUT", token: 1, at: 1, timeouts: 1, terminal: false}), "utf8");
  delete require.cache[require.resolve(MODULE)];
  const restarted = require(MODULE);
  const before = fs.readFileSync(journal(env), "utf8");
  try {
    const refused = await restarted.tick(HAULER, {planTrip: () => ({status: "NO_TRIP"})}, env);
    assert.equal(refused.status, "FENCED_UNRECONCILED");
    assert.equal(fs.readFileSync(journal(env), "utf8"), before);
    assert.equal(restarted.clearFence(HAULER, "checked the hull by hand", env).status, "CLEARED");
    assert.ok(!fs.existsSync(fence(env)));
    const audit = fs.readFileSync(path.join(env.EVEJS_COOP_NPC_MARKET_ROOT, "distribution-run",
      "fence-audit.jsonl"), "utf8");
    assert.match(audit, /OPERATOR/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test("a settled execution clears its own fence with evidence", async () => {
  const {dir, env, run} = fresh("settle");
  const keeper = setInterval(() => {}, 1000);
  try {
    seed(env);
    const late = new Promise((resolve) => setTimeout(() => resolve({status: "NO_TRIP"}), 1500));
    let calls = 0;
    const authorities = {hulls: () => [HAULER], hullTimeoutMs: 1000,
      planTrip: () => { calls += 1; return late; }, distanceTo: () => 0,
      hullSystemOf: () => 30000145};
    await run.tickAll(authorities, env);
    assert.ok(fs.existsSync(fence(env)));
    await sleep(900);
    const after = await run.tickAll(authorities, env);
    assert.ok(!fs.existsSync(fence(env)), "the fence must lift once the execution really settled");
    assert.notEqual(after[0].status, "FENCED_UNRECONCILED");
    assert.match(fs.readFileSync(path.join(env.EVEJS_COOP_NPC_MARKET_ROOT, "distribution-run",
      "fence-audit.jsonl"), "utf8"), /SETTLED/);
    assert.ok(calls >= 2);
  } finally { clearInterval(keeper); fs.rmSync(dir, {recursive: true, force: true}); }
});

test("one stuck hull does not delay a healthy one", async () => {
  const other = 980000093320;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l7c-par-"));
  const env = {...process.env, EVEJS_COOP_NPC_MARKET_ROOT: dir};
  fs.mkdirSync(path.join(dir, "distribution-run"), {recursive: true});
  delete require.cache[require.resolve(MODULE)];
  const run = require(MODULE);
  const keeper = setInterval(() => {}, 1000);
  try {
    for (const id of [HAULER, other]) {
      fs.writeFileSync(path.join(dir, "distribution-run", id + ".json"), JSON.stringify({
        version: 1, haulerID: id, phase: "PLAN", updatedAt: 1793631970172}), "utf8");
    }
    const frozen = new Promise(() => {});
    const rows = await run.tickAll({hulls: () => [HAULER, other], hullTimeoutMs: 1000,
      planTrip: ({haulerID}) => (Number(haulerID) === HAULER ? frozen : {status: "NO_TRIP"}),
      distanceTo: () => 0, hullSystemOf: () => 30000145}, env);
    const byHull = new Map(rows.map((row) => [Number(row.haulerID), row]));
    assert.equal(byHull.get(HAULER).status, "HULL_TIMEOUT");
    assert.notEqual(byHull.get(other).status, "HULL_TIMEOUT");
  } finally { clearInterval(keeper); fs.rmSync(dir, {recursive: true, force: true}); }
});
