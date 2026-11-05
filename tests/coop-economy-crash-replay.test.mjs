import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// Replay is where an economy loses or duplicates money: the process dies between two steps and the
// recovery must re-run the window without applying a step twice. Wave 1 checked the happy path;
// this pins every declared window.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const C = require(join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(),
  "Code/server/src/space/coopEconomyCrashWindows.js"));

const steps = Object.fromEntries(C.STEPS.map((s) => [s, () => ({ ok: true, receiptID: s.toLowerCase() })]));

test("every crash window resumes without applying a step twice", () => {
  assert.ok(Array.isArray(C.CRASH_WINDOWS) && C.CRASH_WINDOWS.length > 0);
  for (const window of C.CRASH_WINDOWS) {
    const r = C.runWindow({ window, operationID: "op-" + window, steps });
    assert.equal(r.ok, true, window + " doubled a step: " + JSON.stringify(r).slice(0, 200));
    assert.ok([C.CRASH_CODE.RECOVERED, C.CRASH_CODE.RECOVERED_WITH_UNKNOWN].includes(r.code),
      window + " recovered as " + r.code);
  }
});

test("an unknown window is refused, not guessed", () => {
  const r = C.runWindow({ window: "NOPE", operationID: "op-nope", steps });
  assert.equal(r.ok, false);
  assert.equal(r.code, C.CRASH_CODE.INVALID_WINDOW);
});

test("a window without an operation identity is refused", () => {
  const r = C.runWindow({ window: C.CRASH_WINDOWS[0], operationID: "", steps });
  assert.equal(r.ok, false);
  assert.equal(r.code, C.CRASH_CODE.JOURNAL_INCOMPLETE);
});
