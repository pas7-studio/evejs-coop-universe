import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const Mine = require(sp("coopEconomyMiningDispatch.js"));
const Live = require(sp("coopEconomyLiveReadiness.js"));

const need = { typeID: "34", quantity: 100 };

test("no hull means no invented ship", () => {
  assert.deepEqual(Mine.dispatchMining({ need }), { ok: false, code: "NO_HULL" });
  assert.deepEqual(Mine.dispatchMining({ need, fleet: [{ hullID: "h1", capacity: 10 }] }), {
    ok: false,
    code: "NO_HULL",
  });
});

test("no native port means the plan is not executed", () => {
  const r = Mine.dispatchMining({ need, fleet: [{ hullID: "h1", capacity: 500 }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NATIVE_AUTHORITY_UNAVAILABLE");
});

test("a receipt is the only success, a throw is UNKNOWN and never retried", () => {
  const ok = Mine.dispatchMining({
    need,
    fleet: [{ hullID: "h1", capacity: 500 }],
    miningPort: { dispatch: () => ({ receiptID: "r1" }) },
  });
  assert.deepEqual(ok, { ok: true, code: "DISPATCHED", operationID: "mine:h1:34:100", receiptID: "r1" });
  let calls = 0;
  const unknown = Mine.dispatchMining({
    need,
    fleet: [{ hullID: "h1", capacity: 500 }],
    miningPort: { dispatch: () => { calls += 1; throw new Error("timeout"); } },
  });
  assert.equal(unknown.code, "NATIVE_OPERATION_UNKNOWN");
  assert.equal(calls, 1, "the port must be called exactly once");
  const empty = Mine.dispatchMining({
    need,
    fleet: [{ hullID: "h1", capacity: 500 }],
    miningPort: { dispatch: () => ({}) },
  });
  assert.equal(empty.code, "NATIVE_OPERATION_UNKNOWN");
});

test("a manual-only binding is never promoted to live", () => {
  assert.equal(Live.assessLiveReadiness({ binding: { id: "b", supportsLiveRuntime: false } }).code, "MANUAL_ONLY");
  assert.equal(Live.assessLiveReadiness({ binding: { id: "b", supportsLiveRuntime: true } }).code, "ATTESTATION_REQUIRED");
  assert.equal(
    Live.assessLiveReadiness({ binding: { id: "b", supportsLiveRuntime: true }, attestation: { id: "other", reviewedBy: "r", reviewSHA: "s" } }).code,
    "ATTESTATION_REQUIRED",
  );
  const attested = Live.assessLiveReadiness({
    binding: { id: "b", supportsLiveRuntime: true },
    attestation: { id: "b", reviewedBy: "reviewer", reviewSHA: "abc123" },
  });
  assert.equal(attested.code, "LIVE_ATTESTED");
  assert.equal(attested.live, true);
});
