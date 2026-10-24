// End-to-end *server contract* for two pilots in one EveJS solar-system scene.
// Uses actual EveJS methods to issue GotoPoint, route watcher updates, disconnect,
// and rejoin. Transport and DB remain mocked; not a playable client test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const code = process.env.EVEJS_CODE_PATH;
if (!code) throw new Error('EVEJS_CODE_PATH must identify EveJS/Code');
process.env.EVEJS_SKIP_NPC_STARTUP = '1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1';
const require = createRequire(import.meta.url);
const runtime = require(resolve(code, 'server/src/space/runtime'));
const registry = require(resolve(code, 'server/src/services/chat/sessionRegistry.js'));

function pilot(clientID, characterID, shipID) {
  return {
    clientID, characterID, socket: { destroyed: false },
    _space: {
      initialStateSent: true, shipID, visibleDynamicEntityIDs: new Set([8001, 8002]),
    },
  };
}
function ship(itemID, x) {
  return {
    itemID, kind: 'ship', mode: 'STOP',
    position: { x, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x, y: 0, z: 0 },
    speedFraction: 0, pendingDock: null,
    persistSpaceState: false,
  };
}
test('two players independently command ships and receive each others movement in one scene', () => {
  runtime._testing.clearScenes();
  const proto = Object.getPrototypeOf(runtime.ensureScene(30000142, { refreshStargates: false }));
  runtime._testing.clearScenes();

  const a = pilot(101, 1101, 8001), b = pilot(102, 1102, 8002);
  const shipA = ship(8001, 0), shipB = ship(8002, 3000);
  const events = [], commands = [];
  const scene = Object.assign(Object.create(proto), {
    systemID: 30000142,
    sessions: new Map([[a.clientID, a], [b.clientID, b]]),
    dynamicEntities: new Map([[8001, shipA], [8002, shipB]]),
    getShipEntityForSession(s) {
      return this.dynamicEntities.get(s._space.shipID) || null;
    },
    getCurrentSimTimeMs() { return 1000; },
    dispatchConfiguredSubwarpMovement(entity, builder, now, options) {
      const updates = builder(500);
      commands.push({ shipID: entity.itemID, now, updates, options });
      // The server's real visibility dispatcher is separately tested below.
      return true;
    },
    scheduleWatcherMovementAnchor() { return true; },
    sendDestinyUpdates(s, updates, useQueue, options) {
      events.push({ recipient: s.characterID, updates, options });
      return true;
    },
  });

  registry.register(a); registry.register(b);
  try {
    assert.equal(proto.gotoPoint.call(scene, a, { x: 2500, y: 0, z: 0 }), true);
    assert.equal(proto.gotoPoint.call(scene, b, { x: -500, y: 0, z: 0 }), true);
    assert.equal(shipA.mode, 'GOTO');
    assert.equal(shipB.mode, 'GOTO');
    assert.deepEqual(shipA.targetPoint, { x: 2500, y: 0, z: 0 });
    assert.deepEqual(shipB.targetPoint, { x: -500, y: 0, z: 0 });
    assert.equal(commands.length, 2, 'each pilot has one distinct movement dispatch');
    assert.deepEqual(commands.map(x => x.shipID), [8001, 8002]);
    for (const command of commands) {
      assert.ok(command.updates.some(u => u.payload?.[0] === 'GotoPoint'));
    }

    const updateForA = [{ stamp: 501, payload: ['WarpStart', 8001] }];
    const updateForB = [{ stamp: 502, payload: ['WarpStart', 8002] }];
    assert.equal(proto.sendSessionlessWarpStartToVisibleSessions.call(scene, shipA, updateForA).deliveredCount, 2);
    assert.equal(proto.sendSessionlessWarpStartToVisibleSessions.call(scene, shipB, updateForB).deliveredCount, 2);
    assert.deepEqual(events.map(x => x.recipient), [1101, 1102, 1101, 1102]);

    // A disconnect cannot remove B or leave B's ship uncommandable.
    a.socket.destroyed = true;
    scene.sessions.delete(a.clientID);
    registry.unregister(a);
    events.length = 0;
    assert.equal(proto.sendSessionlessWarpStartToVisibleSessions.call(scene, shipA, updateForA).deliveredCount, 1);
    assert.deepEqual(events.map(x => x.recipient), [1102]);
    assert.equal(registry.findSessionByCharacterID(b.characterID), b);
    assert.equal(proto.gotoPoint.call(scene, b, { x: 9000, y: 10, z: 0 }), true);
    assert.deepEqual(shipB.targetPoint, { x: 9000, y: 10, z: 0 });

    // A reconnects with new connection ID; scene delivers once per live pilot.
    const a2 = pilot(103, 1101, 8001);
    registry.register(a2);
    scene.sessions.set(a2.clientID, a2);
    try {
      events.length = 0;
      assert.equal(proto.sendSessionlessWarpStartToVisibleSessions.call(scene, shipB, updateForB).deliveredCount, 2);
      assert.deepEqual(events.map(x => x.recipient).sort((x,y)=>x-y), [1101, 1102]);
      assert.equal(registry.findSessionByCharacterID(1101), a2);
    } finally {
      registry.unregister(a2);
      scene.sessions.delete(a2.clientID);
    }
  } finally {
    registry.unregister(a);
    registry.unregister(b);
    runtime._testing.clearScenes();
  }
});
