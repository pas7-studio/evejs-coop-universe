import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-04: one fenced warship printed the same
// "[CoopAmmoJournal] bank recovery NEEDS_OPERATOR_REPAIR ..." line every second, which
// buried the rest of the log and made a stuck state look like an active one. The rule is
// now pure and testable: first sighting logs, the same outcome stays quiet, a different
// outcome logs immediately, and a long-running one is repeated after ten minutes.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const journal = require(path.join(forkRoot, "Code/server/src/space/coopNpcAmmoDebitJournal.js"));

const T0 = 1793818000000;

test("the first sighting of a stuck bank is logged", () => {
  assert.equal(journal.shouldNotifyRecovery(undefined, "NEEDS_OPERATOR_REPAIR:X", T0), true);
});

test("a tick by tick repeat of the same outcome stays quiet", () => {
  const previous = {signature: "NEEDS_OPERATOR_REPAIR:X", at: T0};
  assert.equal(journal.shouldNotifyRecovery(previous, "NEEDS_OPERATOR_REPAIR:X", T0 + 1000), false);
  assert.equal(journal.shouldNotifyRecovery(previous, "NEEDS_OPERATOR_REPAIR:X", T0 + 60000), false);
});

test("a different outcome, or the same one after ten minutes, is logged again", () => {
  const previous = {signature: "NEEDS_OPERATOR_REPAIR:X", at: T0};
  assert.equal(journal.shouldNotifyRecovery(previous, "NEEDS_OPERATOR_REPAIR:Y", T0 + 1000), true);
  assert.equal(journal.shouldNotifyRecovery(previous, "NEEDS_OPERATOR_REPAIR:X", T0 + 600001), true);
});

test("an unusable clock never suppresses a warning", () => {
  const previous = {signature: "A", at: Number.NaN};
  assert.equal(journal.shouldNotifyRecovery(previous, "A", Number.NaN), true);
  assert.equal(journal.shouldNotifyRecovery(null, "A", T0), true);
});
