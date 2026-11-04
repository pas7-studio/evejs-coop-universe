import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The owner's complaint (2026-11-04): a difficulty-4 combat site is too easy for a
// solo battleship, and the top anomalies should feel like group content. Site enemies
// are the real template's own spawn entries, so "harder" may only mean "more of the
// same real NPCs". The multiplier must be idempotent: instance state is persisted and
// re-read on every wave, so a second pass must never multiply twice.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const scaling = require(path.join(forkRoot, "Code/server/src/space/coopSiteWaveScaling.js"));

const hints = () => ({
  encounter: {key: "wave_1", amount: 4},
  encounters: [
    {key: "wave_01", amount: 8},
    {key: "wave_02", amount: 3},
  ],
});

test("difficulty 3 and below stay exactly as authored", () => {
  const input = hints();
  const result = scaling.scaleEncounterAmounts(input, {difficulty: 3, family: "combat"});
  assert.deepEqual(result.encounters.map((x) => x.amount), [8, 3]);
  assert.equal(scaling.waveFactor(1), 1);
  assert.equal(scaling.waveFactor(3), 1);
});

test("difficulty 4-6 scale by their own factor", () => {
  assert.equal(scaling.waveFactor(4), 2);
  assert.equal(scaling.waveFactor(5), 2.5);
  assert.equal(scaling.waveFactor(6), 3);
  assert.equal(scaling.waveFactor(9), 3);
  const four = scaling.scaleEncounterAmounts(hints(), {difficulty: 4, family: "combat"});
  assert.deepEqual(four.encounters.map((x) => x.amount), [16, 6]);
  const five = scaling.scaleEncounterAmounts(hints(), {difficulty: 5, family: "combat"});
  assert.deepEqual(five.encounters.map((x) => x.amount), [20, 8]);
});

test("scaling is idempotent: a persisted instance is never multiplied twice", () => {
  const input = hints();
  scaling.scaleEncounterAmounts(input, {difficulty: 5, family: "combat"});
  scaling.scaleEncounterAmounts(input, {difficulty: 5, family: "combat"});
  assert.deepEqual(input.encounters.map((x) => x.amount), [20, 8]);
  assert.deepEqual(input.encounters.map((x) => x.baseAmount), [8, 3]);
});

test("only combat families and only real amounts are touched", () => {
  const ore = hints();
  scaling.scaleEncounterAmounts(ore, {difficulty: 6, family: "ore"});
  assert.deepEqual(ore.encounters.map((x) => x.amount), [8, 3], "mining sites keep their waves");
  const empty = {encounters: [{key: "wave_01", amount: 0}]};
  scaling.scaleEncounterAmounts(empty, {difficulty: 6, family: "combat"});
  assert.equal(empty.encounters[0].amount, 0);
});

test("the cap and the off switch are real knobs", () => {  const capped = scaling.scaleEncounterAmounts({encounters: [{key: "wave_01", amount: 40}]},
    {difficulty: 6, family: "combat"}, scaling.readTuning({EVEJS_COOP_SITE_WAVE_SCALE_MAX: "48"}));
  assert.equal(capped.encounters[0].amount, 48);
  assert.equal(scaling.readTuning({EVEJS_COOP_SITE_WAVE_SCALE_D4: "3"}).d4, 3);
  assert.equal(scaling.enabled({EVEJS_COOP_SITE_WAVE_SCALE: "0"}), false);
});

test("a scaled site is recognisable in the scanner by its own name", () => {
  assert.equal(scaling.markSiteLabel("Sansha Port", {siteFamily: "combat", difficulty: 5}),
    "Sansha Port [CO-OP x2.5]");
  assert.equal(scaling.markSiteLabel("Sansha Port", {siteFamily: "combat", difficulty: 3}), "Sansha Port");
  assert.equal(scaling.markSiteLabel("Veldspar Field", {siteFamily: "ore", difficulty: 5}), "Veldspar Field");
  assert.equal(scaling.markerFor(6), " [CO-OP x3]");
});
