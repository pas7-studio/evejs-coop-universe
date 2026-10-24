// Source-contract gate for the *actual* EveJS login-in-space restoration path.
// This prevents an accidental regression to bootstrap-before-Ballpark or
// dropping persisted ship state. It does not replace database-backed E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.env.EVEJS_CODE_PATH;
if(!root)throw new Error('EVEJS_CODE_PATH required');
const transitions=readFileSync(resolve(root,'server/src/space/transitions.js'),'utf8');
const disconnect=readFileSync(resolve(root,'server/src/services/_shared/sessionDisconnect.js'),'utf8');
const start=transitions.indexOf('function restoreSpaceSession(session)');
const end=transitions.indexOf('\nfunction ejectSession(',start);
assert.ok(start>=0&&end>start,'Restore function must exist');
const restore=transitions.slice(start,end);
function requireInOrder(body,operations){
  let cursor=-1;
  for(const operation of operations){
    const index=body.indexOf(operation,cursor+1);
    assert.ok(index>cursor,'Missing or reordered: '+operation);
    cursor=index;
  }
}
test('restore requires a valid character and undocked session',()=>{
  assert.match(restore,/!session\.characterID/);
  assert.match(restore,/isDockedSession\(session\)/);
  assert.match(restore,/if \(!activeShip \|\| !activeShip\.spaceState\)/);
});
test('restore repairs persisted state then consumes emergency warp before attaching',()=>{
  requireInOrder(restore,[
    'getActiveShipRecord(session.characterID)',
    'repairActiveShipSpaceStateForLogin(session, activeShip)',
    'consumeEmergencyWarpReturnStateForLogin(',
    'spaceRuntime.attachSession(session, activeShip,'
  ]);
  assert.match(restore,/activeShip\.spaceState\.systemID/);
});
test('restore attaches, queues fitting hydration and waits for client Ballpark bootstrap',()=>{
  requireInOrder(restore,[
    'spaceRuntime.attachSession(session, activeShip,',
    'if (!shipEntity)',
    'queuePostSpaceAttachFittingHydration(',
    'flushPendingCommandSessionEffects(session)',
    'return true'
  ]);
  assert.match(restore,/emitSimClockRebase: false/);
  assert.match(restore,/deferUniverseSiteReconcile: true/);
  assert.doesNotMatch(restore,/sendInitialDestiny|bootstrapDestiny\(/);
});
test('logoff persists ship space state and reattach consumes it',()=>{
  const logoffStart=disconnect.indexOf('function persistCharacterLogoffState(session)');
  const logoffEnd=disconnect.indexOf('\nfunction disconnectCharacterSession(',logoffStart);
  assert.ok(logoffStart>=0&&logoffEnd>logoffStart);
  const save=disconnect.slice(logoffStart,logoffEnd);
  requireInOrder(save,['getActiveShipRecord(characterID)','resolveLiveShipSpaceState(','buildEmergencyWarpLogoffState(','moveShipToSpace(','updateCharacterRecord(']);
  assert.match(save,/persistedSpaceState\.systemID/);
  assert.match(restore,/activeShip\.spaceState/);
});
