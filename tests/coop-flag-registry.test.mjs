import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const flags = require("../integration/coopFlags.cjs");
const registry = require("../scripts/coop-flags.cjs");

// The world is gated by hundreds of EVEJS_* switches. Two rules keep that
// manageable: only the exact string "1" may enable anything, and every key in
// the code has to be declared in docs/coop-flags.json before it can be used.
// Both were violated in practice (a leftover EVEJS_COOP_NPC_CAPACITOR stayed in
// the probe compose file long after the hack was deleted).
test("only the exact string 1 enables a gate", () => {
  const key = "EVEJS_COOP_TEST_ONLY_ONE";
  for (const value of ["true", "yes", "on", "1 ", "0", ""]) {
    process.env[key] = value;
    assert.equal(flags.on(key), false, JSON.stringify(value));
  }
  process.env[key] = "1";
  assert.equal(flags.on(key), true);
  delete process.env[key];
  assert.equal(flags.on(key), false, "an unset flag is OFF");
});

test("flags are read at call time, never cached at load", () => {
  const key = "EVEJS_COOP_TEST_LATE_SET";
  delete process.env[key];
  assert.equal(flags.on(key), false);
  process.env[key] = "1";
  assert.equal(flags.on(key), true, "a test or the operator sets flags after load");
  delete process.env[key];
});

test("a numeric gate falls back instead of inventing a value", () => {
  const key = "EVEJS_COOP_TEST_TTL";
  delete process.env[key];
  assert.equal(flags.number(key, 60_000), 60_000);
  for (const value of ["", "abc", "-5", "0"]) {
    process.env[key] = value;
    assert.equal(flags.number(key, 60_000), 60_000, JSON.stringify(value));
  }
  process.env[key] = "1500";
  assert.equal(flags.number(key, 60_000), 1500);
  delete process.env[key];
});

test("no module reads an undeclared EVEJS_ flag", () => {
  const readers = registry.scan();
  const baseline = require("../docs/coop-flags.json");
  const fresh = registry.unknown(readers, baseline);
  assert.deepEqual(fresh, [], "declare new flags with: node scripts/coop-flags.cjs --baseline, then review the diff");
  assert.ok(Object.keys(baseline.flags).length > 200, "the registry tracks the real world, not a sample");
});
