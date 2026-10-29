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

// FW-099: WAR_ESCROW_MISSING is a treasury defect, not a fact about the border.
//
// Measured on the owner's play stack 2026-10-30: ten campaigns of 30003837 and five of
// 30045344 expired with that reason while FW-050 was live. The 8x cooldown they left
// behind kept the only armed border of a funded war (decision BOTH_SIDES_CAN_FIELD_NAVY)
// shut for hours after the treasury was fixed, so the world reported "no front" all day.
const lostEscrow = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "WAR_ESCROW_MISSING" });
const noProof = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "NO_ASSAULT_DEPLOYMENT_PROOF" });

test("a border released for lost escrow does not inherit a weeks-long backoff", () => {
  const state = { campaigns: Object.fromEntries(Array.from({ length: 10 },
    (_unused, index) => [`c${index}`, lostEscrow(`c${index}`, 30003837, 1000 + index)])) };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30003837, baseMs: BASE }), BASE,
    "10 lost-escrow releases must not sum to the 8x cap");
});

test("an expired assault proof still grows the cooldown, and mixed history counts only it", () => {
  const only = { campaigns: { a: noProof("a", 30045344, 1), b: noProof("b", 30045344, 2) } };
  assert.equal(targetCooldownMs({ state: only, targetSystemID: 30045344, baseMs: BASE }), BASE * 2);
  const mixed = { campaigns: { a: lostEscrow("a", 30045344, 1), b: noProof("b", 30045344, 2),
    c: lostEscrow("c", 30045344, 3), d: noProof("d", 30045344, 4) } };
  assert.equal(targetCooldownMs({ state: mixed, targetSystemID: 30045344, baseMs: BASE }), BASE * 2,
    "two real assault-proof failures, two ignored escrow releases");
});

test("an unknown reason is still a failure, never an excuse", () => {
  const state = { campaigns: { a: campaign("a", 30045344, "EXPIRED", 1),
    b: { ...campaign("b", 30045344, "EXPIRED", 2), expiredReason: "SOMETHING_NEW" } } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045344, baseMs: BASE }), BASE * 2);
});
