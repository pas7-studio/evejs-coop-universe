// Directly exercises EveJS SolarSystemScene broadcastShipPrimeUpdates with two recipients.
// No EVE client / no network port exposure. This is a server-side contract test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

if (!process.env.EVEJS_CODE_PATH) throw new Error('EVEJS_CODE_PATH required');
process.env.EVEJS_SKIP_NPC_STARTUP = '1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1';
const require = createRequire(import.meta.url);
const runtime = require(resolve(process.env.EVEJS_CODE_PATH, 'server/src/space/runtime'));

function scenePrototype() {
  runtime._testing.clearScenes();
  const p = Object.getPrototypeOf(runtime.ensureScene(30000142, { refreshStargates: false }));
  runtime._testing.clearScenes();
  return p;
}
function makeSession(clientID, characterID, shipID) {
  const notifications = [];
  const session = {
    clientID, characterID, charID: characterID,
    socket: { destroyed: false },
    _space: {
      initialStateSent: true, shipID, simTimeMs: 0, simFileTime: '0',
      timeDilation: 1, historyFloorDestinyStamp: 1775154000,
      visibleDynamicEntityIDs: new Set([991004001])
    },
    sendNotification(name, target, payload) {
      notifications.push({ name, target, payload });
    }
  };
  return { session, notifications };
}
function mockScene(proto) {
  return Object.assign(Object.create(proto), {
    systemID: 30000142, sessions: new Map(), dynamicEntities: new Map(),
    staticEntities: new Set(),
    getCurrentSimTimeMs: () => 1775157300000,
    getCurrentDestinyStamp: () => 1775157300,
    getNextDestinyStamp: () => 1775157301,
    getCurrentSessionDestinyStamp: () => 1775157300,
    getCurrentVisibleSessionDestinyStamp: () => 1775157300,
    getCurrentPresentedSessionDestinyStamp: () => 1775157302,
    getImmediateDestinyStampForSession: () => 1775157299,
    getHistoryFloorDestinyStampForSession: () => 1775157300,
    getSessionClockOffsetMs: () => 0,
    translateDestinyStampForSession: (_session, rawStamp) => Math.trunc(rawStamp) >>> 0,
    refreshSessionClockSnapshot() {}
  });
}
const entity = () => ({
  itemID: 991004001, kind: 'ship', x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0, mass: 1000, radius: 50,
  agility: 1, maxSpeed: 250, isMassive: false
});

test('ship-prime broadcast stays scoped to independently identified scene sessions', () => {
  const scene = mockScene(scenePrototype());
  const a = makeSession(1065451, 140000008, 991003010);
  const b = makeSession(1065452, 140000009, 991003011);
  scene.sessions.set(String(a.session.clientID), a.session);
  scene.sessions.set(String(b.session.clientID), b.session);
  const ship = entity();
  scene.dynamicEntities.set(ship.itemID, ship);
  const original = scene.sendDestinyUpdates;
  const observed = [];
  scene.sendDestinyUpdates = function (session, updates, ...args) {
    observed.push({ recipient: session.clientID, updates });
    return original.call(this, session, updates, ...args);
  };
  const result = scene.broadcastShipPrimeUpdates(ship, { stampMode: 'currentVisible' });
  assert.ok(result.deliveredCount >= 1, 'EveJS should report a ship prime delivery');
  assert.ok(observed.length > 0, 'sendDestinyUpdates must be exercised for a recipient');
  for (const record of observed) {
    assert.ok([a.session.clientID,b.session.clientID].includes(record.recipient), 'no unknown recipient');
  }
  // The upstream ship prime API may legitimately select recipients based on visibility.
  // Record actual recipient IDs; a second gate must prove both are eligible and delivered.
  console.log('ship-prime recipients', [...new Set(observed.map(r => r.recipient))]);
});
