// Multi-observer warp-start routing against EveJS's REAL SolarSystemScene method.
// No proprietary client; mock transport is only the sendDestinyUpdates sink.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const codePath = process.env.EVEJS_CODE_PATH;
if (!codePath) throw new Error('EVEJS_CODE_PATH must point to an EveJS/Code checkout');
process.env.EVEJS_SKIP_NPC_STARTUP = '1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1';
const require = createRequire(import.meta.url);
const runtime = require(resolve(codePath, 'server/src/space/runtime'));
function getPrototype() {
  runtime._testing.clearScenes();
  const proto = Object.getPrototypeOf(runtime.ensureScene(30000142, { refreshStargates: false }));
  runtime._testing.clearScenes();
  return proto;
}
function pilot(id, shipId, visible, disconnected = false) {
  return { clientID: id, characterID: id + 10000, socket: { destroyed: disconnected },
    _space: { shipID: shipId, initialStateSent: true,
      visibleDynamicEntityIDs: new Set(visible ? [1001] : []) } };
}
test('warp-start delivers once each to two eligible observers; excludes hidden and disconnected', () => {
  const proto = getPrototype();
  const entity = { itemID: 1001, kind: 'ship' };
  const a = pilot(101, 9001, true);
  const b = pilot(102, 9002, true);
  const hidden = pilot(103, 9003, false);
  const closed = pilot(104, 9004, true, true);
  const deliveries = [];
  const scene = {
    sessions: new Map([[101,a],[102,b],[103,hidden],[104,closed]]),
    sendDestinyUpdates(session, updates) {
      deliveries.push({ id: session.clientID, updates });
      return true;
    }
  };
  const event = [{ stamp: 1, payload: ['WarpStart'] }];
  const result = proto.sendSessionlessWarpStartToVisibleSessions.call(scene, entity, event);
  assert.equal(result.deliveredCount, 2);
  assert.deepEqual(deliveries.map(x => x.id).sort(), [101,102]);
  for (const entry of deliveries) assert.deepEqual(entry.updates, event);

  scene.sessions.delete(101);
  deliveries.length = 0;
  const afterDisconnect = proto.sendSessionlessWarpStartToVisibleSessions.call(scene, entity, event);
  assert.equal(afterDisconnect.deliveredCount, 1);
  assert.deepEqual(deliveries.map(x => x.id), [102]);
});
