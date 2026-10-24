// Integration contract across actual EveJS registry and SolarSystemScene prototype.
// This deliberately tests server-side state without pretending to speak the game protocol.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

if (!process.env.EVEJS_CODE_PATH) throw new Error('EVEJS_CODE_PATH is required');
process.env.EVEJS_SKIP_NPC_STARTUP = '1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1';
const require = createRequire(import.meta.url);
const registry = require(resolve(process.env.EVEJS_CODE_PATH, 'server/src/services/chat/sessionRegistry.js'));
const runtime = require(resolve(process.env.EVEJS_CODE_PATH, 'server/src/space/runtime'));
function scenePrototype() {
  runtime._testing.clearScenes();
  const scene = runtime.ensureScene(30000142, { refreshStargates: false });
  const proto = Object.getPrototypeOf(scene);
  runtime._testing.clearScenes();
  return proto;
}
function player(clientID, characterID, shipID) {
  return { clientID, characterID, socket: { destroyed: false },
    _space: { initialStateSent: true, shipID,
      visibleDynamicEntityIDs: new Set([991004001]) } };
}

test('registry and scene independently retain pilot B after pilot A disconnect', () => {
  const a = player(501, 1501, 9501);
  const b = player(502, 1502, 9502);
  const hidden = player(503, 1503, 9503);
  hidden._space.visibleDynamicEntityIDs.clear();
  const records = [];
  const scene = {
    sessions: new Map([[a.clientID,a],[b.clientID,b],[hidden.clientID,hidden]]),
    sendDestinyUpdates(session, updates) {
      records.push({ characterID: session.characterID, updates });
      return true;
    }
  };
  const proto = scenePrototype();
  const entity = { itemID: 991004001, kind: 'ship' };
  const warp = [{ stamp: 42, payload: ['WarpStart'] }];
  registry.register(a); registry.register(b); registry.register(hidden);
  try {
    assert.equal(registry.findSessionByCharacterID(a.characterID), a);
    assert.equal(registry.findSessionByCharacterID(b.characterID), b);
    assert.notEqual(a._space.shipID, b._space.shipID);
    const first = proto.sendSessionlessWarpStartToVisibleSessions.call(scene, entity, warp);
    assert.equal(first.deliveredCount, 2);
    assert.deepEqual(records.map(x => x.characterID).sort(), [1501,1502]);
    for (const r of records) assert.deepEqual(r.updates, warp);
    // Simulate the scene membership and live-registry cleanup done by server disconnect.
    a.socket.destroyed = true;
    scene.sessions.delete(a.clientID);
    registry.unregister(a);
    assert.equal(registry.findSessionByCharacterID(a.characterID), null);
    assert.equal(registry.findSessionByCharacterID(b.characterID), b);
    records.length = 0;
    const second = proto.sendSessionlessWarpStartToVisibleSessions.call(scene, entity, warp);
    assert.equal(second.deliveredCount, 1);
    assert.deepEqual(records.map(x => x.characterID), [1502]);
    assert.ok(scene.sessions.has(b.clientID));
  } finally {
    registry.unregister(a); registry.unregister(b); registry.unregister(hidden);
  }
});
