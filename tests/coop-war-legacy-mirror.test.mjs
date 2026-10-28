// FW-050 guard: the legacy namespace copy of the war state must stay OFF by default.
//
// Measured 22:2xZ on the work stack: `corporationRuntime` stores "coop-faction-war" as
// a row GROUP, so writing one member marks the whole group dirty and the next flush
// rebuilds every member from the in-memory cache - including `treasury-v1`, which the
// atomic path updates in SQLite without refreshing that cache. The treasury row came
// back with 3 reservations and nextJournalID 3 while events had already used escrow
// journals 8000000000000004..6: two ASSAULT campaigns lost HELD escrow while the
// wallets kept the debits (1000120: -25 000 ISK with no reservation behind it).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { legacyWarStateMirrorEnabled } = require("../integration/coopVirtualWorldRuntime.cjs");

test("the dangerous legacy copy is off when nobody asks for it", () => {
  assert.equal(legacyWarStateMirrorEnabled({}), false);
  assert.equal(legacyWarStateMirrorEnabled({ EVEJS_COOP_WAR_STATE_LEGACY_MIRROR: "0" }), false);
});

test("an operator can still turn it on explicitly", () => {
  assert.equal(legacyWarStateMirrorEnabled({ EVEJS_COOP_WAR_STATE_LEGACY_MIRROR: "1" }), true);
});

test("only the exact opt-in value enables it", () => {
  for (const value of ["", "true", "yes", "on", "2"]) {
    assert.equal(legacyWarStateMirrorEnabled({ EVEJS_COOP_WAR_STATE_LEGACY_MIRROR: value }), false,
      `"${value}" must not silently re-enable a writer that can revert the treasury row`);
  }
});
