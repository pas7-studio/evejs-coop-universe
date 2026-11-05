import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = process.env.EVEJS_FORK_ROOT.trim();
const M = require(join(fork, "Code/server/src/space/coopEconomyGapReport.js"));

test("every stage reachable is READY", () => {
  const r = M.buildGapReport({
    chain: [
      { id: "mine", title: "Mining", modules: ["a"] },
      { id: "factory", title: "Factory", modules: ["b"] },
    ],
    present: ["a", "b"],
    reachable: ["a", "b"],
  });
  assert.equal(r.verdict, "READY");
  assert.equal(r.firstBlockingEdge, null);
  assert.equal(r.stages.map((s) => s.status).join(","), "REACHABLE,REACHABLE");
});

test("an existing but unreachable stage is BLOCKED, never healthy", () => {
  const r = M.buildGapReport({
    chain: [
      { id: "mine", title: "Mining", modules: ["a"] },
      { id: "factory", title: "Factory", modules: ["b", "c"] },
    ],
    present: ["a", "b", "c"],
    reachable: ["a"],
  });
  const factory = r.stages.find((s) => s.id === "factory");
  assert.equal(factory.status, "BLOCKED");
  assert.equal(factory.reachableCount, 0);
  assert.equal(factory.moduleCount, 2);
  assert.equal(r.firstBlockingEdge, "factory");
  assert.equal(r.verdict, "BLOCKED");
});

test("a stage with a module that does not exist is MISSING_MODULE", () => {
  const r = M.buildGapReport({
    chain: [{ id: "refine", title: "Refinery", modules: ["x", "y"] }],
    present: ["x"],
    reachable: ["x"],
  });
  assert.equal(r.stages[0].status, "MISSING_MODULE");
  assert.deepEqual(r.stages[0].missing, ["y"]);
});

test("the first blocking edge is the earliest non-ready stage", () => {
  const r = M.buildGapReport({
    chain: [
      { id: "one", title: "One", modules: ["a"] },
      { id: "two", title: "Two", modules: ["b"] },
      { id: "three", title: "Three", modules: ["c"] },
    ],
    present: ["a", "b", "c"],
    reachable: ["a"],
  });
  assert.equal(r.firstBlockingEdge, "two");
  assert.equal(r.stages[2].status, "BLOCKED");
});

test("malformed input is UNKNOWN, not a false success", () => {
  for (const input of [{}, { chain: "nope" }, null]) {
    const r = M.buildGapReport(input);
    assert.deepEqual(r.stages, []);
    assert.equal(r.firstBlockingEdge, null);
    assert.equal(r.verdict, "UNKNOWN");
  }
});

test("GAP_STATUS exposes the exact status strings", () => {
  assert.equal(M.GAP_STATUS.READY, "REACHABLE");
  assert.equal(M.GAP_STATUS.MISSING, "MISSING_MODULE");
  assert.equal(M.GAP_STATUS.BLOCKED, "BLOCKED");
  assert.equal(M.GAP_STATUS.UNKNOWN, "UNKNOWN");
});


// WAVE4-REGRESSION
test("IE-007 gap report: a present but unreachable module blocks the stage", () => {
  const report = M.buildGapReport({
    chain: [{ id: "supply", modules: ["a", "b"] }],
    present: ["a", "b"],
    reachable: ["a"],
  });
  assert.equal(report.stages[0].status, "BLOCKED", "a half-reachable stage read ready");
  assert.deepEqual(report.stages[0].unreachable, ["b"]);
  assert.equal(report.verdict, "BLOCKED");
  const ready = M.buildGapReport({ chain: [{ id: "supply", modules: ["a", "b"] }], present: ["a", "b"], reachable: ["a", "b"] });
  assert.equal(ready.verdict, "READY");
});
