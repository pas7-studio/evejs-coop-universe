
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// A site wave that materializes next to a player is hostile to that player from its first tick.
// Nothing happens with no player in range, and a player hull is never marked as an NPC target.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {engageNearbyPlayers} = require(path.join(
  forkRoot, "Code/server/src/space/coopSiteAggroOnSpawn.js"));

const PLAYER_SHIP = 90001;
const NPC = 70001;

function world({playerAt = {x: 1000, y: 0, z: 0}, npcAt = {x: 0, y: 0, z: 0}, withPlayer = true} = {}) {
  const entities = new Map();
  entities.set(NPC, {itemID: NPC, kind: "ship", nativeNpc: true, position: npcAt});
  if (withPlayer) {
    entities.set(PLAYER_SHIP, {itemID: PLAYER_SHIP, kind: "ship",
      position: playerAt, session: {characterID: 140000005}});
  }
  const sessions = new Map();
  if (withPlayer) {
    sessions.set(1, {characterID: 140000005, _space: {systemID: 30000142, shipID: PLAYER_SHIP}});
  }
  const controllers = new Map([[NPC, {entityID: NPC, currentTargetID: 0, manualOrder: null,
    runtimeKind: "nativeAmbient"}]]);
  return {
    scene: {systemID: 30000142, sessions, getEntityByID: (id) => entities.get(Number(id)) || null},
    registry: {getControllerByEntityID: (id) => controllers.get(Number(id)) || null},
    controllers,
  };
}

test("the rule does nothing unless it is switched on", () => {
  const {scene, registry, controllers} = world();
  const report = engageNearbyPlayers({scene, entityIDs: [NPC], registry, env: {}});
  assert.equal(report.status, "SKIPPED");
  assert.equal(controllers.get(NPC).lastAggressorID, undefined);
});

test("a wave next to a player takes that player as its aggressor", () => {
  const {scene, registry, controllers} = world();
  const report = engageNearbyPlayers({
    scene, entityIDs: [NPC], registry,
    env: {EVEJS_COOP_SITE_AGGRO_ON_SPAWN: "1"}, now: 1000,
  });
  assert.equal(report.status, "ENGAGED");
  assert.deepEqual(report.engaged, [{entityID: NPC, playerShipID: PLAYER_SHIP, meters: 1000}]);
  const controller = controllers.get(NPC);
  assert.equal(controller.lastAggressorID, PLAYER_SHIP);
  assert.equal(controller.lastAggressorOwnerID, 140000005);
  assert.equal(controller.runtimeKind, "nativeCombat", "an ambient hull now fights");
});

test("a wave far from the player and an empty system stay calm", () => {
  const far = world({playerAt: {x: 900000, y: 0, z: 0}});
  assert.equal(engageNearbyPlayers({
    scene: far.scene, entityIDs: [NPC], registry: far.registry,
    env: {EVEJS_COOP_SITE_AGGRO_ON_SPAWN: "1"},
  }).status, "NO_TARGET_IN_RANGE");
  assert.equal(far.controllers.get(NPC).lastAggressorID, undefined);

  const empty = world({withPlayer: false});
  assert.equal(engageNearbyPlayers({
    scene: empty.scene, entityIDs: [NPC], registry: empty.registry,
    env: {EVEJS_COOP_SITE_AGGRO_ON_SPAWN: "1"},
  }).reason, "NO_PLAYER_IN_SYSTEM");
});
