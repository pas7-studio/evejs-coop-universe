// Real EveJS scene prototype test with TWO observer sessions; no proprietary client.
// Requires EVEJS_CODE_PATH pointing to an EveJS/Code checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {hasUpstreamCodePath,upstreamSkipReason,upstreamSuiteName} from "./helpers/upstreamCheckout.mjs";

if (!hasUpstreamCodePath) {
  test(upstreamSuiteName, { skip: upstreamSkipReason }, () => {});
} else {

const code = process.env.EVEJS_CODE_PATH;
process.env.EVEJS_SKIP_NPC_STARTUP = '1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1';
const require = createRequire(import.meta.url);
const runtime = require(resolve(code, 'server/src/space/runtime'));
function prototype() {
  runtime._testing.clearScenes();
  const proto = Object.getPrototypeOf(runtime.ensureScene(30000142, { refreshStargates: false }));
  runtime._testing.clearScenes();
  return proto;
}
function pilot(clientID, characterID, visible = true) {
  return { clientID, characterID, socket: { destroyed: false },
    _space: { initialStateSent: true, shipID: 9000 + clientID,
      visibleDynamicEntityIDs: new Set(visible ? [3001] : []),
      freshlyVisibleDynamicEntityIDs: new Set(visible ? [3001] : []) } };
}
function mockScene() {
  const queued = [];
  return { queued, scene: {
    systemID: 30000142,
    sessions: new Map(),
    getCurrentSimTimeMs: () => 1000,
    getCurrentDestinyStamp: () => 77,
    getNextDestinyStamp: () => 78,
    getCurrentVisibleDestinyStampForSession: (_s, stamp) => Number(stamp) || 77,
    getCurrentSessionDestinyStamp: () => 77,
    getImmediateDestinyStampForSession: (_s, stamp = 77) => (Number(stamp) || 77) - 1,
    getHistorySafeSessionDestinyStamp: (_s, _now, lead) => Number(lead) >= 2 ? 79 : 78,
    getCurrentPresentedSessionDestinyStamp: () => 77,
    hasActiveTickDestinyPresentationBatch: () => true,
    queueTickDestinyPresentationUpdates(session, updates) {
      queued.push({ session, names: updates.map(x => x.payload[0]) });
    },
    sendDestinyUpdates() { throw new Error('Expected queued Destiny updates'); },
    canSessionSeeDynamicEntity: () => false
  } };
}
test('two observers get independent removal notifications and one disconnect does not remove the other', () => {
  const proto = prototype();
  const a = pilot(111, 222);
  const b = pilot(112, 223);
  const { scene, queued } = mockScene();
  scene.sessions.set(a.clientID, a);
  scene.sessions.set(b.clientID, b);
  proto.broadcastRemoveBall.call(scene, 3001);
  assert.equal(queued.length, 2);
  assert.deepEqual(new Set(queued.map(x => x.session.clientID)), new Set([111,112]));
  for (const q of queued) assert.deepEqual(q.names, ['RemoveBalls']);
  assert.equal(a._space.visibleDynamicEntityIDs.has(3001), false);
  assert.equal(b._space.visibleDynamicEntityIDs.has(3001), false);

  scene.sessions.delete(a.clientID);
  b._space.visibleDynamicEntityIDs.add(3001);
  queued.length = 0;
  proto.broadcastRemoveBall.call(scene, 3001);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].session, b);
  assert.deepEqual(queued[0].names, ['RemoveBalls']);
});
test('non-observing player does not receive a dynamic entity removal', () => {
  const proto = prototype();
  const visible = pilot(113, 224);
  const hidden = pilot(114, 225, false);
  const { scene, queued } = mockScene();
  scene.sessions.set(visible.clientID, visible);
  scene.sessions.set(hidden.clientID, hidden);
  proto.broadcastRemoveBall.call(scene, 3001);
  assert.deepEqual(queued.map(x => x.session.clientID), [113]);
});
}
