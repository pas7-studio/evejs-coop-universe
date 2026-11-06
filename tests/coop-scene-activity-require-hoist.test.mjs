import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06 with the live heap sampler on an idle play stack: 69 MB of garbage per minute
// was charged to path.join alone, because the scene activity check re-required the crimewatch module
// with a fresh path.join() on every call - and the scheduler runs that check hundreds of times a
// second. The module is now resolved once, with a failed resolve still retried on the next call so a
// module that cannot load yet is never cached as "missing for ever".
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(
  path.join(forkRoot, "Code/server/src/space/npc/npcSceneActivity.js"), "utf8");

test("the crimewatch module is resolved once, not per activity check", () => {
  const start = source.indexOf("function getSceneCrimewatchDeadlineMs(");
  assert.ok(start > 0, "the deadline getter must exist");
  const body = source.slice(start, source.indexOf("function computeSceneActivityState("));
  assert.doesNotMatch(body, /require\(path\.join/,
    "a require with a fresh path.join inside the hot getter is the 69 MB/min the sampler found");
  assert.match(body, /crimewatchStateOrNull\(\)/, "the getter must use the cached resolver");
});

test("a failed resolve is retried instead of being cached as missing", () => {
  const start = source.indexOf("function crimewatchStateOrNull(");
  assert.ok(start > 0, "the resolver must exist");
  const body = source.slice(start, source.indexOf("function getSceneCrimewatchDeadlineMs("));
  assert.match(body, /if \(crimewatchStateModule\) \{\s*return crimewatchStateModule;/,
    "only a successful load is cached");
  assert.match(body, /catch \(_error\) \{\s*return null;/,
    "a failed load must not poison the cache");
});
