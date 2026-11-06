'use strict';
/** PF76 — no manual PF55 order may overtake PF56 return/dock or PF60 terminal.
 * SQLite fixture uses BEGIN IMMEDIATE, journal_mode=WAL, synchronous=FULL.
 * Test actors are synthetic; these are durable ordering tests, NOT live EveJS.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const F=require('./fixture.cjs');
const T='corporationRuntime',P='coop-personal-fleet\u001f';
const conflictKey=(suffix)=>P+suffix+F.ASSIGNMENT;
const keys=['return-dock-v1:','dock-native-attempt-v1:',
 'dock-scene-attempt-v1:','terminal-v1:'];
function withDb(fn){const tmp=F.tempDb();let f;
 try{f=F.open(tmp.file);f.makeActive();return fn(f,tmp)}
 finally{f?.close();tmp.cleanup();}}
function expectNoNativeAndNoIntent(f,expected){
 const out=f.orders.issue(F.command());
 assert.equal(out.reason,expected,JSON.stringify(out));
 assert.equal(f.shared.ordersIssued,0);
 assert.equal(f.get(T,F.pf55.key(F.SHIP)),null);
 assert.equal(f.get(T,F.pf55.OP_INDEX),null);
}
for(const phase of ['RETURN_ISSUING','RETURNING','ARRIVAL_OBSERVED',
 'DOCK_ISSUING','DOCKED']){
 test('committed PF56 '+phase+' prevents a new player WARP/ATTACK/FOLLOW order',()=>
  withDb(f=>{
   f.put(T,conflictKey(keys[0]),{version:1,phase,assignmentID:F.ASSIGNMENT});
   expectNoNativeAndNoIntent(f,'PF55_RETURN_DOCK_OR_TERMINAL_PENDING');
  }));
}
for(const prefix of keys.slice(1)){
 test('one-shot '+prefix+' row prevents a foreign concurrent manual command',()=>
  withDb(f=>{
   f.put(T,conflictKey(prefix),{version:1,status:'CONSUMED'});
   expectNoNativeAndNoIntent(f,'PF55_RETURN_DOCK_OR_TERMINAL_PENDING');
  }));
}
test('unexpected/corrupted durable row also denies rather than being treated as absent',()=>
 withDb(f=>{
  f.put(T,conflictKey('return-dock-v1:'),{nonsense:1});
  expectNoNativeAndNoIntent(f,'PF55_RETURN_DOCK_OR_TERMINAL_PENDING');
 }));
test('unknown SQLite read result fails closed before order intent is written',()=>
 withDb(f=>{
  f.shared.onTx=(tx,tables)=>{if(!tables.includes('items'))return;
   const original=tx.get;tx.get=(t,k)=>t===T&&k===conflictKey('return-dock-v1:')
    ?undefined:original(t,k);
  };
  expectNoNativeAndNoIntent(f,'PF55_RETURN_DOCK_CUSTODY_READ_UNKNOWN');
 }));
test('no return/terminal intent preserves ordinary native FOLLOW durable ISSUING',()=>
 withDb(f=>{
  const r=f.orders.issue(F.command());
  assert.equal(r.status,'NEEDS_RECONCILIATION');
  assert.equal(r.nativeAck,'REPORTED_SUCCESS');
  assert.equal(f.shared.ordersIssued,1);
  assert.equal(f.get(T,F.pf55.key(F.SHIP)).phase,'ISSUING');
 }));
test('real SIGKILL after committed PF56 return intent blocks post-restart manual order',
 {skip:process.platform==='win32'},()=>{
  const temp=F.tempDb();let f;
  try{
   f=F.open(temp.file);f.makeActive();
   f.put('npcEntities','pf76-scene',f.shared.scene);
   f.close();f=null;
   const script=`'use strict';const F=require(${JSON.stringify(require.resolve('./fixture.cjs'))});
    const f=F.open(${JSON.stringify(temp.file)});
    f.put('corporationRuntime',${JSON.stringify(conflictKey('return-dock-v1:'))},
      {version:1,phase:'DOCK_ISSUING',assignmentID:F.ASSIGNMENT});
    process.kill(process.pid,'SIGKILL');process.exit(75);`;
   const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:15000});
   assert.equal(child.signal,'SIGKILL',JSON.stringify(child));
   f=F.open(temp.file);
   f.shared.scene=f.get('npcEntities','pf76-scene');
   expectNoNativeAndNoIntent(f,'PF55_RETURN_DOCK_OR_TERMINAL_PENDING');
  }finally{f?.close();temp.cleanup();}
 });
