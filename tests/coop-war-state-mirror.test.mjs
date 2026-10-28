// FW-041 guard: the war record must survive a container recreate.
// Measured repeatedly on the work stack: fleet registry, casualty ledger, merit and
// treasury all survived while the war state row came back EMPTY, so the campaign
// vanished, real ISK stayed in escrow and no bounty could ever pay.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chooseWarRestore } = require("../integration/coopVirtualWorldRuntime.cjs");

const empty = { version: 1, wars: {}, campaigns: {}, territories: {} };
const war = { version: 1, wars: { "war:a-b": {} }, campaigns: { c1: {} }, territories: { 30045344: {} } };

test("an absent record is restored from a validated mirror", () => {
  const out = chooseWarRestore({ current: null, mirror: war });
  assert.equal(out.reason, "RESTORED_FROM_MIRROR");
  assert.deepEqual(out.use, war);
});

test("an EMPTY record is also restored - that is the measured failure", () => {
  const out = chooseWarRestore({ current: empty, mirror: war });
  assert.equal(out.reason, "RESTORED_FROM_MIRROR");
  assert.deepEqual(out.use, war);
});

test("a live war is never overwritten by a mirror", () => {
  const other = { version: 1, wars: { "war:x-y": {} }, campaigns: {}, territories: {} };
  const out = chooseWarRestore({ current: other, mirror: war });
  assert.equal(out.reason, "LIVE_RECORD_WINS");
  assert.deepEqual(out.use, other);
});

test("an empty mirror restores nothing", () => {
  assert.equal(chooseWarRestore({ current: null, mirror: empty }).reason, "MIRROR_EMPTY_TOO");
  assert.equal(chooseWarRestore({ current: null, mirror: null }).reason, "NO_MIRROR");
  assert.deepEqual(chooseWarRestore({ current: empty, mirror: null }).use, empty);
});
