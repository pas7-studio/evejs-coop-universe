import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveMaterializeLimit } = require("../integration/coopMaterializeLimit.cjs");

test("a configured value above the materializer maximum is clamped, never thrown", () => {
  const r = resolveMaterializeLimit("26");
  assert.equal(r.limit, 10);
  assert.equal(r.clamped, true);
  assert.equal(r.reason, "ABOVE_MAXIMUM");
  assert.equal(r.configured, "26");
});

test("a value below the minimum is clamped up", () => {
  const r = resolveMaterializeLimit("0");
  assert.equal(r.limit, 1);
  assert.equal(r.reason, "BELOW_MINIMUM");
});

test("a value in range is used verbatim", () => {
  const r = resolveMaterializeLimit("4");
  assert.equal(r.limit, 4);
  assert.equal(r.clamped, false);
  assert.equal(r.reason, "IN_RANGE");
});

test("an absent value falls back to the documented default", () => {
  for (const value of [undefined, null, "", "  "]) {
    const r = resolveMaterializeLimit(value);
    assert.equal(r.limit, 2);
    assert.equal(r.clamped, false);
    assert.equal(r.reason, "DEFAULT");
  }
});

test("a non-numeric value falls back and is reported, not silently accepted", () => {
  const r = resolveMaterializeLimit("many");
  assert.equal(r.limit, 2);
  assert.equal(r.reason, "NOT_AN_INTEGER");
});

test("every resolved limit is accepted by the real createBridge contract", () => {
  const { createBridge } = require("../integration/coopNpcMaterializer.cjs");
  for (const value of ["26", "0", "4", "many", undefined]) {
    const { limit } = resolveMaterializeLimit(value);
    assert.doesNotThrow(() => createBridge({ limit, exists: () => false, spawn: () => ({ success: false }) }));
  }
});
