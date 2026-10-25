import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sampleObserver, createReconciler, reconcileIfEnabled } =
  require('../integration/coopSceneObserverIntegrity.cjs');

function pilot(clientID, characterID, shipID, visible = []) {
  return { clientID, characterID, socket: { destroyed: false },
    _space: { systemID: 30000144, shipID, initialStateSent: true,
      visibleDynamicEntityIDs: new Set(visible) } };
}
function ship(id, x = 0, owner = null, extras = {}) {
  return { itemID: id, kind: 'ship', pilotCharacterID: owner,
    position: { x, y: 0, z: 0 }, ...extras };
}
function fixture() {
  const a = pilot(1, 101, 9001), b = pilot(2, 102, 9002);
  const one = ship(9001, 0, 101), two = ship(9002, 1500, 102);
  const npc = ship(9900, 2000, null, { nativeNpc: true });
  const scene = { systemID: 30000144,
    sessions: new Map([[1, a], [2, b]]),
    dynamicEntities: new Map([[9001, one], [9002, two], [9900, npc]]),
    delivered: [],
    getEntityByID(id) { return this.dynamicEntities.get(id) || null; },
    canSessionSeeDynamicEntity(session, entity) {
      const own = this.dynamicEntities.get(session._space.shipID);
      return Boolean(own && entity.position &&
        Math.abs(entity.position.x - own.position.x) <= 100000);
    },
    syncDynamicVisibilityForSession(session) {
      const cache = session._space.visibleDynamicEntityIDs;
      const expected = new Set([...this.dynamicEntities.values()].filter(e =>
        e.itemID !== session._space.shipID && this.canSessionSeeDynamicEntity(session, e)).map(e => e.itemID));
      for (const id of cache) if (id !== session._space.shipID && !expected.has(id)) {
        cache.delete(id); this.delivered.push({ clientID: session.clientID, type: 'RemoveBalls', id });
      }
      for (const id of expected) if (!cache.has(id)) {
        cache.add(id); this.delivered.push({ clientID: session.clientID, type: 'AddBalls', id });
      }
    }
  };
  return { scene, a, b, one, two, npc };
}
const factory = (opts = {}) => createReconciler({ confirmations: 1, cooldownMs: 0, ...opts });

test('two observers acquire the same real player and native NPC IDs, once per client', () => {
  const { scene, a, b } = fixture();
  const result = factory().reconcile(scene);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.results.map(r => r.status), ['NATIVE_CACHE_RECONCILED', 'NATIVE_CACHE_RECONCILED']);
  assert.deepEqual([...a._space.visibleDynamicEntityIDs].sort(), [9002, 9900]);
  assert.deepEqual([...b._space.visibleDynamicEntityIDs].sort(), [9001, 9900]);
  assert.equal(scene.delivered.length, 4);
  assert.equal(factory().reconcile(scene).attempts, 0, 'no duplicate entity events');
});

test('different grids never deliver an out-of-range ship/NPC', () => {
  const { scene, a, b, two } = fixture();
  two.position.x = 300000;
  factory().reconcile(scene);
  assert.deepEqual([...a._space.visibleDynamicEntityIDs], [9900]);
  assert.deepEqual([...b._space.visibleDynamicEntityIDs], []);
  assert.equal(scene.delivered.some(x => x.clientID === 1 && x.id === 9002), false);
});

test('destruction removes a previously observed NPC through native removal only', () => {
  const { scene, a, b } = fixture();
  factory().reconcile(scene);
  scene.delivered.length = 0;
  scene.dynamicEntities.delete(9900);
  const result = factory().reconcile(scene);
  assert.equal(result.attempts, 2);
  assert.deepEqual(scene.delivered, [
    { clientID: 1, type: 'RemoveBalls', id: 9900 },
    { clientID: 2, type: 'RemoveBalls', id: 9900 }]);
  assert.equal(a._space.visibleDynamicEntityIDs.has(9900), false);
  assert.equal(b._space.visibleDynamicEntityIDs.has(9900), false);
});

test('disconnect A leaves B operational; reconnect new A avoids ghost deliveries', () => {
  const { scene, a, b } = fixture();
  factory().reconcile(scene);
  a.socket.destroyed = true;
  scene.sessions.delete(a.clientID);
  scene.dynamicEntities.get(9900).position.x = 400000;
  scene.delivered.length = 0;
  const result = factory().reconcile(scene);
  assert.equal(result.attempts, 1);
  assert.deepEqual(scene.delivered.map(e => e.clientID), [2]);
  const replacement = pilot(3, 101, 9001);
  scene.sessions.set(3, replacement);
  scene.dynamicEntities.get(9900).position.x = 2000;
  scene.delivered.length = 0;
  const joined = factory().reconcile(scene);
  assert.equal(joined.attempts, 2);
  assert.deepEqual([...replacement._space.visibleDynamicEntityIDs].sort(), [9002, 9900]);
  assert.equal(joined.results.some(r => r.status === 'NATIVE_CACHE_RECONCILED'), true);
  assert.equal(b.socket.destroyed, false);
});

test('warp defers visibility changes; landing removes stale peers from both native caches', () => {
  const { scene, a, b, one } = fixture();
  factory().reconcile(scene);
  scene.delivered.length = 0;
  one.mode = 'WARP';
  assert.equal(sampleObserver(scene, a).reason, 'WARP_IN_PROGRESS');
  assert.equal(factory().reconcile(scene).attempts, 0, 'no premature grid refresh while warp is active');
  one.mode = 'STOP';
  one.position.x = 350000;
  const done = factory().reconcile(scene);
  assert.equal(done.attempts, 2);
  assert.deepEqual([...a._space.visibleDynamicEntityIDs], []);
  assert.deepEqual([...b._space.visibleDynamicEntityIDs], [9900]);
  assert.deepEqual(scene.delivered.filter(x => x.clientID === 1).map(x => x.id).sort(), [9002, 9900]);
  assert.deepEqual(scene.delivered.filter(x => x.clientID === 2).map(x => x.id), [9001]);
});

test('wrong ownership, duplicate character, cross-system and foreign scene cannot mutate visibility', () => {
  const { scene, a, b, one } = fixture();
  one.pilotCharacterID = 666;
  assert.equal(sampleObserver(scene, a).reason, 'FOREIGN_SHIP_OWNER');
  one.pilotCharacterID = 101;
  b.characterID = 101;
  assert.equal(sampleObserver(scene, a).reason, 'DUPLICATE_NATIVE_OWNER');
  b.characterID = 102;
  a._space.systemID = 30000142;
  assert.equal(sampleObserver(scene, a).reason, 'SESSION_SYSTEM_OR_SHIP_MISMATCH');
  a._space.systemID = 30000144;
  scene.sessions.delete(a.clientID);
  assert.equal(sampleObserver(scene, a).reason, 'SESSION_NOT_IN_SCENE');
  const x = factory().reconcile(scene);
  assert.equal(x.attempts, 1);
});

test('ambiguous native object identity and nonfinite authoritative position fail closed', () => {
  const { scene, a, npc } = fixture();
  scene.dynamicEntities.set(9900, { ...npc });
  scene.getEntityByID = (id) => id === 9900 ? npc : scene.dynamicEntities.get(id);
  assert.equal(sampleObserver(scene, a).reason, 'NATIVE_ENTITY_IDENTITY_DRIFT');
  scene.getEntityByID = id => scene.dynamicEntities.get(id);
  scene.dynamicEntities.get(9900).position.x = NaN;
  assert.equal(sampleObserver(scene, a).reason, 'INVALID_NATIVE_POSITION');
});

test('confirmed divergence, cooldown, budget and throwing native sync never fake success', () => {
  const { scene, a, b } = fixture();
  let now = 10;
  const reconciler = createReconciler({ clock: () => now, confirmations: 2, cooldownMs: 100, maxRepairsPerPass: 1 });
  assert.equal(reconciler.reconcile(scene).attempts, 0);
  assert.equal(reconciler.reconcile(scene).attempts, 1);
  scene.delivered.length = 0;
  assert.equal(reconciler.reconcile(scene).attempts, 1, 'B uses next pass after first-pass budget');
  now += 101;
  const done = reconciler.reconcile(scene);
  assert.equal(done.attempts, 0);
  assert.equal(done.results[1].status, 'CONSISTENT');
  a._space.visibleDynamicEntityIDs.clear();
  const original = scene.syncDynamicVisibilityForSession;
  scene.syncDynamicVisibilityForSession = () => { throw Error('broken native RPC'); };
  const broken = factory().reconcile(scene);
  assert.equal(broken.results[0].status, 'NATIVE_SYNC_THROWN');
  assert.equal(a._space.visibleDynamicEntityIDs.size, 0);
  scene.syncDynamicVisibilityForSession = original;
});

test('default OFF does not touch any scene state or issue any Destiny event', () => {
  const { scene } = fixture();
  const old = process.env.EVEJS_COOP_SCENE_OBSERVER_RECONCILE;
  delete process.env.EVEJS_COOP_SCENE_OBSERVER_RECONCILE;
  try { assert.equal(reconcileIfEnabled(scene).status, 'DISABLED');
    assert.deepEqual(scene.delivered, []); }
  finally { if (old === undefined) delete process.env.EVEJS_COOP_SCENE_OBSERVER_RECONCILE;
    else process.env.EVEJS_COOP_SCENE_OBSERVER_RECONCILE = old; }
});

test('unproductive native sync is never called healed and is rate limited', () => {
  const { scene, a } = fixture();
  let time = 1000, calls = 0;
  scene.syncDynamicVisibilityForSession = () => { calls++; return true; };
  const r = createReconciler({ clock: () => time, confirmations: 1, cooldownMs: 5000 });
  assert.equal(r.reconcile(scene).results[0].status, 'NATIVE_SYNC_UNVERIFIED');
  assert.equal(calls, 2);
  assert.equal(a._space.visibleDynamicEntityIDs.size, 0);
  assert.equal(r.reconcile(scene).results[0].status, 'COOLDOWN');
  assert.equal(calls, 2);
  time += 5000;
  assert.equal(r.reconcile(scene).results[0].status, 'NATIVE_SYNC_UNVERIFIED');
  assert.equal(calls, 4);
});
