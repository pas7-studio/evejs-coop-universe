import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const W = require(sp("coopEconomyWorkOrder.js"));
const R = require(sp("coopEconomyExecutionRegistry.js"));

const valid = () => ({
  operationID: "op-1",
  corpID: "corp-1",
  phase: "NEED_IDENTIFIED",
  quantity: 5,
  resourceKeys: ["item:34"],
  updatedAt: 1,
});

test("only the declared transitions are legal", () => {
  assert.equal(W.canTransition("NEED_IDENTIFIED", "PLANNED"), true);
  assert.equal(W.canTransition("PLANNED", "RESERVED"), true);
  assert.equal(W.canTransition("EXECUTING", "OUTCOME_UNKNOWN"), true);
  assert.equal(W.canTransition("COMPLETED", "EXECUTING"), false);
  assert.equal(W.canTransition("VERIFYING", "RESERVED"), false);
  assert.equal(W.canTransition("BOGUS", "PLANNED"), false);
  assert.equal(W.canTransition("PLANNED", "BOGUS"), false);
});

test("a valid work order has no errors", () => {
  assert.deepEqual(W.validateWorkOrder(valid()), { ok: true, errors: [] });
});

test("an empty work order names every defect once, sorted", () => {
  const r = W.validateWorkOrder({});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    "MISSING_CORP",
    "MISSING_OPERATION_ID",
    "MISSING_RESOURCE_KEY",
    "NEGATIVE_QUANTITY",
    "UNKNOWN_PHASE",
  ]);
});

test("transition returns a frozen copy and leaves the input untouched", () => {
  const wo = valid();
  const planned = W.transition(wo, "PLANNED");
  assert.equal(planned.phase, "PLANNED");
  assert.equal(Object.isFrozen(planned), true);
  assert.equal(wo.phase, "NEED_IDENTIFIED");
  assert.throws(() => W.transition(planned, "COMPLETED"), TypeError);
});

test("the registry keeps exactly one live owner per phase", () => {
  const reg = R.createRegistry();
  assert.deepEqual(reg.register("refinery", "a"), { ok: true, code: "OK", owner: "a" });
  assert.deepEqual(reg.register("refinery", "a"), { ok: true, code: "ALREADY_OWNER", owner: "a" });
  const conflict = reg.register("refinery", "b");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "INCOMPATIBLE_EXECUTORS");
  assert.deepEqual(conflict.conflict, { phase: "refinery", current: "a", rejected: "b" });
  assert.equal(reg.ownerOf("refinery"), "a");
  assert.deepEqual(reg.phases(), ["refinery"]);
});

test("a release must be owned and registration validates its inputs", () => {
  const reg = R.createRegistry();
  reg.register("refinery", "a");
  assert.equal(reg.release("refinery", "b"), false);
  assert.equal(reg.ownerOf("refinery"), "a");
  assert.equal(reg.release("refinery", "a"), true);
  assert.equal(reg.ownerOf("refinery"), null);
  assert.equal(reg.register("", "a").code, "INCOMPATIBLE_EXECUTORS");
  assert.equal(reg.register("mining", null).code, "INCOMPATIBLE_EXECUTORS");
});
