// Contract gate for the real EveJS login / disconnect implementation.
// Guards accidental replacement of authoritative persistence and emergency warp
// with our test-only in-memory reconnect helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.env.EVEJS_CODE_PATH;
if(!root)throw Error('EVEJS_CODE_PATH required');
const source=p=>readFileSync(resolve(root,'server/src',p),'utf8');
test('TCP close and error both run real disconnect and registry cleanup',()=>{
 const s=source('network/tcp/index.js');
 for(const event of ['close','error']){
  const section=s.slice(s.indexOf('socket.on("'+event+'"'),s.indexOf('socket.on("'+event+'"')+700);
  assert.match(section,/disconnectCharacterSession\(clientSession/);
  assert.match(section,/sessionRegistry\.unregister\(clientSession\)/);
 }
});
test('character takeover evicts prior session using persistent disconnect, then socket destroy',()=>{
 const s=source('services/character/charService.js');
 const start=s.indexOf('function evictPriorSession('),end=s.indexOf('class CharService',start);
 assert.ok(start>=0&&end>start);
 const body=s.slice(start,end);
 assert.match(body,/disconnectCharacterSession\(priorSession/);
 assert.match(body,/sessionRegistry\.unregister\(priorSession\)/);
 assert.match(body,/priorSocket\.destroy\(\)/);
});
test('disconnect persists character logoff BEFORE detaching, then cleans social systems',()=>{
 const s=source('services/_shared/sessionDisconnect.js');
 const start=s.indexOf('function disconnectCharacterSession(');
 assert.ok(start>=0);
 const body=s.slice(start);
 const operations=['persistCharacterLogoffState(session)','spaceRuntime.detachSession(session','abortTradesForSession(session)','chatHub.unregisterSession(session)','unregisterCharacterSession(session)','clearCharacterFromSession(session'];
 let prev=-1;
 for(const operation of operations){
   const index=body.indexOf(operation);
   assert.ok(index>prev,'Expected lifecycle ordering for '+operation);
   prev=index;
 }
 assert.match(s,/buildEmergencyWarpLogoffState/);
 assert.match(s,/moveShipToSpace/);
});
