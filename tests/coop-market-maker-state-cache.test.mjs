import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// MEASURED 2026-11-05 on a live V8 CPU profile of the work stack (2 219 s profiled):
// read()/write() of coop-market-makers.json was the hottest co-op code in the process -
// 27.35 s + 20.00 s + 3.96 s + 3.89 s + 3.03 s of CPU - because every call re-read and
// re-parsed the whole document, snapshot() re-read it per tick, and a per-tick
// createTraders() call built a fresh instance (and read) each time.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createTraders, TRADERS} = require(path.join(
  forkRoot, "Code/server/src/space/coopMarketMakerTraders.js"));

function tempFile() {
  return path.join(os.tmpdir(), `mm-cache-${process.pid}-${Math.random()}.json`);
}

test("one trading document is one instance per process, so a per-tick call cannot re-parse it", () => {
  const file = tempFile();
  const first = createTraders({file, clock: () => 1_000_000});
  const second = createTraders({file, clock: () => 1_000_000});
  assert.equal(first, second, "createTraders() for the same file returns the same store");
  fs.rmSync(file, {force: true});
});

test("an injected writer always gets its own instance (tests keep their own store)", () => {
  const file = tempFile();
  const writes = [];
  const first = createTraders({file, clock: () => 1_000_000,
    writeFile: (target, text) => writes.push({target, text})});
  const second = createTraders({file, clock: () => 1_000_000,
    writeFile: (target, text) => writes.push({target, text})});
  assert.notEqual(first, second);
  fs.rmSync(file, {force: true});
});

test("the state is read from disk once and then lives in memory", () => {
  const file = tempFile();
  const traders = createTraders({file, clock: () => 1_000_000});
  const first = traders.snapshot();
  assert.deepEqual(first.traders, {}, "an absent file is an empty document, not a crash");
  // A different document landing on disk must NOT be picked up by this process: the store is
  // the single writer, and re-reading per call is exactly the measured hot path.
  fs.writeFileSync(file, JSON.stringify({version: 1, traders: {someoneElse: {traderID: "someoneElse"}}, operations: {}}));
  assert.deepEqual(traders.snapshot().traders, {}, "the live document is authoritative");
  fs.rmSync(file, {force: true});
});

test("a snapshot is a value: comparing two of them cannot be broken by a later write", () => {
  const file = tempFile();
  const traders = createTraders({file, clock: () => 1_000_000});
  const traderID = TRADERS[0].traderID;
  const before = traders.snapshot();
  const reserved = traders.reserve({traderID, amountISK: 1000});
  assert.equal(reserved.status, "RESERVED");
  const after = traders.snapshot();
  assert.equal(before.traders[traderID], undefined, "the earlier snapshot is unchanged");
  assert.ok(after.traders[traderID], "the later snapshot has the trader");
  fs.rmSync(file, {force: true});
});
