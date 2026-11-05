import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// Backpressure is the only thing between a cooperative economy and an unbounded queue of jobs, so
// its limits must be real in both directions: nothing beyond the limit is admitted, and finishing
// work must return the capacity it occupied.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const C = require(join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(),
  "Code/server/src/space/coopEconomyBackpressure.js"));

test("the active limit and the queue limit are both respected", () => {
  const bp = C.createBackpressure({ maxActive: 2, maxQueued: 1 });
  assert.equal(bp.admit({ operationID: "A" }).code, "ADMITTED");
  assert.equal(bp.admit({ operationID: "B" }).code, "ADMITTED");
  assert.equal(bp.admit({ operationID: "C" }).code, "QUEUED", "a third job ran alongside the limit");
  assert.equal(bp.admit({ operationID: "D" }).code, "QUEUE_FULL", "the queue grew past its limit");
  assert.deepEqual(bp.counts(), { active: 2, queued: 1 });
});

// A finished operation occupies no slot. The module kept its own counters and complete() never
// returned the slot, so after enough work the pool reported itself full for ever.
test("completing an operation returns its slot", () => {
  const bp = C.createBackpressure({ maxActive: 2, maxQueued: 1 });
  bp.admit({ operationID: "A" });
  bp.admit({ operationID: "B" });
  assert.equal(bp.complete({ operationID: "A" }).code, "COMPLETED");
  assert.equal(bp.counts().active, 1, "counts() disagrees with the completion");
  const next = bp.admit({ operationID: "E" });
  assert.equal(next.code, "ADMITTED",
    "a finished job kept its slot: the pool is " + JSON.stringify(bp.counts()));
  // a freed slot is handed to the next operation, not held in the queue
  bp.admit({ operationID: "F" });
  assert.equal(bp.admit({ operationID: "G" }).code, "QUEUE_FULL");
  bp.complete({ operationID: "E" });          // active 1, queued 1
  assert.equal(bp.admit({ operationID: "H" }).code, "ADMITTED",
    "a free slot was not used while a job waited in the queue");
  bp.complete({ operationID: "B" });
  bp.complete({ operationID: "F" });
  bp.complete({ operationID: "G" });
  bp.complete({ operationID: "H" });
  assert.deepEqual(bp.counts(), { active: 0, queued: 0 }, "the pool never drained");
});

test("a full warehouse is refused and nothing is dropped", () => {
  const bp = C.createBackpressure({ maxActive: 2, maxQueued: 1 });
  const r = bp.admit({ operationID: "W", warehouse: { usedUnits: 10, capacityUnits: 10 } });
  assert.equal(r.ok, false);
  assert.equal(r.code, "WAREHOUSE_FULL");
  assert.ok(r.keptUnits === undefined || r.keptUnits >= 10, "stock was deleted to make room");
  assert.equal(bp.counts().active, 0, "a refused job took a slot");
});
