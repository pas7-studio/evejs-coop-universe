import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// MEASURED 2026-11-05 with a live V8 CPU profile (2 219 s profiled): synchronous JSON
// writes plus fsync were ~28% of all non-idle CPU, and this world file was rewritten on
// every cycle because advance() persists whenever any pilot has a physical location -
// which is almost always. Virtual pilot positions come back from the clock, so coalescing
// those writes is safe; nothing durable hangs on them.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createWorld} = require(path.join(forkRoot, "Code/server/src/space/coopVirtualWorld.js"));

const ROUTE = [30000142, 30000144, 30000145];

function world({saveMs} = {}) {
  const file = path.join(os.tmpdir(), `world-save-${process.pid}-${Math.random()}.json`);
  const clock = {now: 1_800_000_000_000};
  if (saveMs !== undefined) process.env.EVEJS_COOP_WORLD_SAVE_MS = String(saveMs);
  const instance = createWorld({file, route: ROUTE, population: 4, clock: () => clock.now,
    travelMs: 60_000});
  return {instance, file, clock};
}

test("a cycle with physical locations does not rewrite the file every time", () => {
  const {instance, file, clock} = world({saveMs: 60_000});
  // The first change always lands immediately (nothing has been saved yet), so the window
  // under test starts after it.
  instance.advance({"coop-pilot-001": 30000144});
  const firstSize = fs.statSync(file).size;
  const firstMtime = fs.statSync(file).mtimeMs;
  for (let index = 0; index < 5; index += 1) {
    instance.advance({"coop-pilot-001": 30000144});
    clock.now += 1000;
  }
  assert.equal(fs.statSync(file).mtimeMs, firstMtime,
    "the coalesced writer must not touch the file inside the save window");
  assert.equal(fs.statSync(file).size, firstSize);
  // The explicit flush is the durability escape hatch (also registered on beforeExit).
  assert.equal(instance.flush(), true);
  assert.ok(fs.statSync(file).mtimeMs >= firstMtime);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.pilots.find((pilot) => pilot.id === "coop-pilot-001").systemID, 30000144,
    "the flush writes the latest state, not the state from the call before");
  fs.rmSync(file, {force: true});
});

test("a flush with nothing pending is a no-op, not a write", () => {
  const {instance, file} = world({saveMs: 60_000});
  instance.flush();
  assert.equal(instance.flush(), false);
  fs.rmSync(file, {force: true});
});
