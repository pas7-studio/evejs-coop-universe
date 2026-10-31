import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// A pirate takes a real player hull as prey ONLY when EVEJS_COOP_PIRATE_PREY_PLAYERS=1. The
// default must stay exactly what it was: the world fights itself and a player is not a target.
// Every case here runs against the shipped fork module, not an archived copy.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createRaids} = require(path.join(
  forkRoot, "Code/server/src/space/coopNativeRaids.js"));

const PIRATE = 501;
const PLAYER_SHIP = 90001;
const SYSTEM = 30000144;

function world({playerAt = {x: 5000, y: 0, z: 0}, shipMissing = false, extraShips = {}} = {}) {
  const ships = new Map(Object.entries(extraShips).map(([id, ship]) => [Number(id), ship]));
  ships.set(PIRATE, {
    id: PIRATE,
    kind: "ship",
    nativeNpc: true,
    position: {x: 0, y: 0, z: 0},
    mode: "STOP",
  });
  const sessions = new Map();
  sessions.set(1, {
    characterID: 140000005,
    _space: shipMissing ? {systemID: SYSTEM} : {systemID: SYSTEM, shipID: PLAYER_SHIP},
  });
  if (!shipMissing) {
    ships.set(PLAYER_SHIP, {
      id: PLAYER_SHIP,
      kind: "ship",
      position: playerAt,
      mode: "STOP",
      session: {characterID: 140000005},
    });
  }
  const calls = [];
  const boot = (env) => createRaids({
    env,
    clock: () => Date.UTC(2026, 9, 31, 19, 0, 0),
    warp: (pirateID, targetID) => {
      calls.push({kind: "warp", pirateID, targetID});
      return {success: true};
    },
    attack: (pirateID, targetID) => {
      calls.push({kind: "attack", pirateID, targetID});
      return {success: true};
    },
    gunRange: () => ({meters: 9000, family: "laserTurret"}),
  });
  const scene = {
    systemID: SYSTEM,
    sessions,
    getEntityByID: (id) => ships.get(Number(id)) || null,
  };
  return {boot, scene, calls, ships};
}

test("a player hull is not prey while the flag is off, which is the default", () => {
  const {boot, scene, calls} = world();
  const raids = boot({});
  const result = raids.tick({
    systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [], getCargo: () => [0],
  });
  assert.deepEqual(result.actions, [], "no order, no target");
  assert.deepEqual(calls, [], "and no native command was sent");
});

test("with the flag on, a pirate really engages the player through the normal order path", () => {
  const {boot, scene, calls} = world();
  const raids = boot({EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"});
  const result = raids.tick({
    systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [], getCargo: () => [0],
  });
  assert.equal(result.actions.length, 1, "one order");
  const [order] = result.actions;
  assert.equal(order.targetID, PLAYER_SHIP);
  assert.equal(order.targetRole, "player");
  assert.equal(order.action, "attack", "5 km away is a weapon attack, not an approach");
  assert.deepEqual(calls, [{kind: "attack", pirateID: PIRATE, targetID: PLAYER_SHIP}]);
  assert.equal(order.gunRange.meters, 9000, "the hull fights with its own gun range");
});

test("a far player is approached with a real warp before any weapon order", () => {
  const {boot, scene, calls} = world({playerAt: {x: 9000000, y: 0, z: 0}});
  const raids = boot({EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"});
  const result = raids.tick({
    systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [], getCargo: () => [0],
  });
  assert.equal(result.actions[0].action, "warp-to-hauler");
  assert.equal(result.actions[0].targetRole, "player");
  assert.deepEqual(calls, [{kind: "warp", pirateID: PIRATE, targetID: PLAYER_SHIP}]);
});

test("a session without a ship, or a hull in warp, is never prey", () => {
  const docked = world({shipMissing: true});
  const raidsA = docked.boot({EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"});
  assert.deepEqual(raidsA.tick({
    systemID: SYSTEM, scene: docked.scene, pirates: [PIRATE], fleetShips: [], getCargo: () => [0],
  }).actions, [], "a docked character has no hull to hunt");

  const warping = world();
  warping.ships.get(PLAYER_SHIP).warpState = {to: 1};
  const raidsB = warping.boot({EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"});
  assert.deepEqual(raidsB.tick({
    systemID: SYSTEM, scene: warping.scene, pirates: [PIRATE], fleetShips: [], getCargo: () => [0],
  }).actions, [], "a hull already in warp cannot be caught");
});

test("a nearer NPC hauler is still the better prize, player or not", () => {
  const hauler = {id: 777, kind: "ship", nativeNpc: true, position: {x: 1000, y: 0, z: 0},
    mode: "STOP"};
  const {boot, scene} = world({extraShips: {777: hauler}});
  const raids = boot({EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"});
  const result = raids.tick({
    systemID: SYSTEM,
    scene,
    pirates: [PIRATE],
    fleetShips: [{id: 777, role: "hauler"}],
    getCargo: () => [{moduleID: 0, quantity: 40}],
  });
  assert.equal(result.actions[0].targetID, 777, "the loaded hauler at 1 km wins");
  assert.equal(result.actions[0].targetRole, "hauler");
});

test("the eligibility gate refuses a player hull by default and allows it only when switched on", () => {
  const {isAuthorizedStockMiningRaid} = require(path.join(
    forkRoot, "Code/server/src/space/coopNativeRaidEligibility.js"));
  const links = [{systemID: SYSTEM, entityID: PIRATE, pilotID: "coop-pilot-007", role: "pirate"}];
  const attacker = {itemID: PIRATE, kind: "ship", nativeNpc: true};
  const player = {itemID: PLAYER_SHIP, kind: "ship", session: {characterID: 140000005}};
  const base = {systemID: SYSTEM, attacker, target: player, links, pilots: [], fleetShips: []};

  assert.equal(isAuthorizedStockMiningRaid({...base, env: {}}), false,
    "a player is not a raid target unless an operator says so");
  assert.equal(isAuthorizedStockMiningRaid({
    ...base, env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"},
  }), true, "with the flag on, the linked pirate may hunt the player");
  assert.equal(isAuthorizedStockMiningRaid({
    ...base, links: [], env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"},
  }), false, "an unlinked hull is not a pirate, flag or not");
  assert.equal(isAuthorizedStockMiningRaid({
    systemID: SYSTEM,
    attacker,
    target: {itemID: 555, kind: "ship"},
    links,
    env: {EVEJS_COOP_PIRATE_PREY_PLAYERS: "1"},
  }), false, "an NPC hull still needs the real mining fleet and its own rules");
});
