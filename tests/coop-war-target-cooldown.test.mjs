// FW-064 guard: a border that keeps expiring must back off, not loop.
//
// Measured overnight on the work stack: 30045343 reopened and expired four times
// (:r2, :r3, :r4), each cycle reserving real escrow and refunding it 45 minutes later,
// because the defender never fielded a hull there. The cooldown now grows with the
// number of campaigns that target has already lost, and a successful assault resets it
// because only EXPIRED records are counted.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { targetCooldownMs } = require("../integration/coopFactionWarOpening.cjs");

const BASE = 45 * 60 * 1000;
const campaign = (id, target, state, expiredAt = 0) => ({ campaignID: id, warID: "war:1-2",
  sourceSystemID: 1, targetSystemID: target, state, objectiveEvidence: [],
  revision: 1, expiredAt });

test("a target that never failed waits only the base window", () => {
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343, baseMs: BASE }), BASE);
});

test("each lost campaign doubles the wait, capped", () => {
  const state = (count) => ({ campaigns: Object.fromEntries(Array.from({ length: count },
    (_unused, index) => [`c${index}`, campaign(`c${index}`, 30045343, "EXPIRED", 1000 + index)])) });
  assert.equal(targetCooldownMs({ state: state(1), targetSystemID: 30045343, baseMs: BASE }), BASE * 1);
  assert.equal(targetCooldownMs({ state: state(2), targetSystemID: 30045343, baseMs: BASE }), BASE * 2);
  assert.equal(targetCooldownMs({ state: state(3), targetSystemID: 30045343, baseMs: BASE }), BASE * 4);
  assert.equal(targetCooldownMs({ state: state(9), targetSystemID: 30045343, baseMs: BASE }), BASE * 8,
    "the cap keeps a dead border from being retried only once a week");
});

test("a live or captured campaign is not a failure and resets the wait", () => {
  const state = { campaigns: {
    a: campaign("a", 30045343, "ASSAULT"),
    b: campaign("b", 30045343, "OCCUPIED"),
    c: campaign("c", 30045343, "PREPARING"),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045343, baseMs: BASE }), BASE);
});

test("another system's failures never slow this border down", () => {
  const state = { campaigns: {
    a: campaign("a", 111, "EXPIRED", 1),
    b: campaign("b", 111, "EXPIRED", 2),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 222, baseMs: BASE }), BASE);
});

test("a missing or invalid target still answers the base window, never zero", () => {
  assert.equal(targetCooldownMs({ state: null, targetSystemID: 30045343, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 0, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343, baseMs: 0 }), 1);
});
