import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The stock behaviour loop answers "is this player hull friendly to this NPC?" with a hard-coded
// yes. This rule is the only exception, it is off by default, and it never overrides high-sec
// safety. A pirate with a real attack order, or one the player just shot, is not friendly.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {allowsPlayerPrey, enabled} = require(path.join(
  forkRoot, "Code/server/src/space/coopPlayerPreyHostility.js"));

const NOW = Date.UTC(2026, 9, 31, 19, 0, 0);
const ON = {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"};

const source = {itemID: 980000095003, kind: "ship", nativeNpc: true};
const player = {itemID: 9988400108317, kind: "ship", session: {characterID: 140000005}};

function controller(overrides = {}) {
  return {
    entityID: source.itemID,
    manualOrder: null,
    lastAggressorID: 0,
    lastAggressedAtMs: 0,
    ...overrides,
  };
}

const run = ({env = ON, ctl = controller(), target = player, blocks = false, nowMs = NOW} = {}) =>
  allowsPlayerPrey(source, target, {
    env,
    nowMs,
    probe: false,
    registry: {getControllerByEntityID: () => ctl},
    safety: {blocksAggression: () => blocks},
  });

test("the rule is off unless the operator switched it on", () => {
  assert.equal(enabled({}), false);
  assert.equal(run({env: {}}), false);
  assert.equal(run({env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "0"}}), false);
  assert.equal(enabled(ON), true);
});

test("a real attack order on this exact player makes the hull hostile to it", () => {
  const ctl = controller({manualOrder: {type: "attack", targetID: player.itemID}});
  assert.equal(run({ctl}), true);
  // an order on somebody else is not permission for this hull
  assert.equal(run({ctl: controller({manualOrder: {type: "attack", targetID: 42}})}), false);
  assert.equal(run({ctl: controller({manualOrder: {type: "warp", targetID: player.itemID}})}), false);
});

test("a player who shot the hull gets shot back, but only for five minutes", () => {
  const shot = controller({lastAggressorID: player.itemID, lastAggressedAtMs: NOW - 60_000});
  assert.equal(run({ctl: shot}), true);
  const stale = controller({lastAggressorID: player.itemID, lastAggressedAtMs: NOW - 6 * 60_000});
  assert.equal(run({ctl: stale}), false);
  const otherAggressor = controller({lastAggressorID: 777, lastAggressedAtMs: NOW - 1000});
  assert.equal(run({ctl: otherAggressor}), false);
});

test("high-sec safety keeps the first word, order or not", () => {
  const ctl = controller({manualOrder: {type: "attack", targetID: player.itemID}});
  assert.equal(run({ctl, blocks: true}), false,
    "a protected player hull stays safe even with an order");
});

test("only a real player hull is eligible", () => {
  const ctl = controller({manualOrder: {type: "attack", targetID: 555}});
  assert.equal(run({
    ctl, target: {itemID: 555, kind: "ship"},
  }), false, "an NPC hull is never a player");
  assert.equal(run({ctl, target: {itemID: 555, kind: "ship", session: {characterID: 0}}}), false);
  assert.equal(run({
    ctl: controller({manualOrder: {type: "attack", targetID: 555}}),
    target: {itemID: 555, kind: "ship", nativeNpc: true, session: {characterID: 140000005}},
  }), false, "a player-flown NPC hull is still an NPC");
});

test("an ordered pirate may be allowed to engage in high security, but only on request", () => {
  const ctl = controller({manualOrder: {type: "attack", targetID: player.itemID}});
  assert.equal(run({ctl, blocks: true}), false, "default: high-sec safety still vetoes");
  assert.equal(allowsPlayerPrey(source, player, {
    env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1", EVEJS_COOP_PIRATE_PREY_HIGHSEC: "1"},
    nowMs: NOW,
    probe: false,
    registry: {getControllerByEntityID: () => ctl},
    safety: {blocksAggression: () => true},
  }), true, "with the switch on, a real order is enough");
  // the switch never invents an order
  assert.equal(allowsPlayerPrey(source, player, {
    env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1", EVEJS_COOP_PIRATE_PREY_HIGHSEC: "1"},
    nowMs: NOW,
    probe: false,
    registry: {getControllerByEntityID: () => controller()},
    safety: {blocksAggression: () => true},
  }), false, "an unordered pirate still does nothing in high sec");
});
