import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// High-sec NPC safety. Vanilla EveJS makes every NPC hostile to every player hull; the living-world
// pirates used that to kill a Venture in Jita (0.94, killmail 173). A pirate must never open fire on a
// player in high-sec unless the player shot first or is an enemy militia hull.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const safety = require(path.join(forkRoot, "Code/server/src/space/coopHighSecNpcSafety.js"));

const HIGHSEC = 0.9459;
const LOWSEC = 0.28;
const NOW = 1_800_000_000_000;

test("a pirate does not engage a player in high-sec", () => {
  const decision = safety.decide({security: HIGHSEC, nowMs: NOW});
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "HIGHSEC_SAFE");
});

test("low-sec and null-sec keep native NPC behaviour", () => {
  assert.equal(safety.decide({security: LOWSEC, nowMs: NOW}).blocked, false);
  assert.equal(safety.decide({security: -0.4, nowMs: NOW}).blocked, false);
  assert.equal(safety.decide({security: LOWSEC, nowMs: NOW}).reason, "NOT_HIGHSEC");
});

test("the player may always shoot first: fresh retaliation is allowed", () => {
  const decision = safety.decide({
    security: HIGHSEC,
    aggressedAtMs: NOW - 30_000,
    aggressorIsTarget: true,
    nowMs: NOW,
  });
  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "RETALIATION");
});

test("a stale aggression no longer permits an attack", () => {
  const decision = safety.decide({
    security: HIGHSEC,
    aggressedAtMs: NOW - (safety.RETALIATION_WINDOW_MS + 1000),
    aggressorIsTarget: true,
    nowMs: NOW,
  });
  assert.equal(decision.blocked, true);
});

test("aggression against a different hull is not retaliation", () => {
  const decision = safety.decide({
    security: HIGHSEC,
    aggressedAtMs: NOW - 1000,
    aggressorIsTarget: false,
    nowMs: NOW,
  });
  assert.equal(decision.blocked, true);
});

test("an enemy militia hull is still a legal war target in high-sec", () => {
  const decision = safety.decide({security: HIGHSEC, enemyMilitia: true, nowMs: NOW});
  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "ENEMY_MILITIA");
});

test("the rule can be switched off, and only players are protected", () => {
  assert.equal(safety.decide({security: HIGHSEC, env: {EVEJS_COOP_HIGHSEC_NPC_SAFETY: "0"}}).blocked, false);
  assert.equal(safety.targetCharacterIDOf({session: {characterID: 140000005}}), 140000005);
  assert.equal(safety.targetCharacterIDOf({ownerID: 1000162}), 0);
});
