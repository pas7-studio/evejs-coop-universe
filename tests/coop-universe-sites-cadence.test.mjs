import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Measured 2026-11-02: the sampled nullsec/wormhole fill-in changed on every world tick, so the "pending"
// set was never empty and the whole 36-system site pass (p95 22.3 s of blocked event loop) ran every ~26 s
// instead of the intended ten minutes. Only a system the world really plays in may force an immediate pass.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { shouldReconcile } = require(
  path.join(forkRoot, "Code/server/src/space/coopUniverseSitesCadence.js"),
);

const T0 = Date.UTC(2026, 10, 2, 23, 0, 0);

test("a sampled background system alone does not force a pass", () => {
  assert.equal(
    shouldReconcile({
      pending: [31000001],
      worldIDs: new Set([30000142]),
      lastReconcileAtMs: T0,
      nowMs: T0 + 26_000,
    }),
    false,
  );
});

test("a newly played system forces a pass immediately", () => {
  assert.equal(
    shouldReconcile({
      pending: [30000144],
      worldIDs: new Set([30000142, 30000144]),
      lastReconcileAtMs: T0,
      nowMs: T0 + 26_000,
    }),
    true,
  );
});

test("the ten-minute interval still forces a pass on its own", () => {
  assert.equal(
    shouldReconcile({
      pending: [31000001],
      worldIDs: new Set([30000142]),
      lastReconcileAtMs: T0,
      nowMs: T0 + 10 * 60 * 1000,
    }),
    true,
  );
});

test("force always wins, and nothing pending inside the interval waits", () => {
  assert.equal(shouldReconcile({ pending: [], lastReconcileAtMs: T0, nowMs: T0 + 1000, force: true }), true);
  assert.equal(shouldReconcile({ pending: [], lastReconcileAtMs: T0, nowMs: T0 + 1000 }), false);
});
