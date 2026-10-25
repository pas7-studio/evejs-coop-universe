import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {admission}=require('../integration/coopSessionPresence.cjs');
function fixture(){
 const alice={userid:10,clientID:201,characterID:1001,shipID:501,
  socket:{destroyed:false},_space:{systemID:30000144,shipID:501,initialStateSent:true}};
 const bob={userid:20,clientID:202,characterID:1002,shipID:502,
  socket:{destroyed:false},_space:{systemID:30000144,shipID:502,initialStateSent:true}};
 const hulls=new Map([[501,{kind:'ship',itemID:501,session:alice}],
  [502,{kind:'ship',itemID:502,session:bob}]]);
 const scene={systemID:30000144,sessions:new Map([[201,alice],[202,bob]]),
  getEntityByID:id=>hulls.get(id)||null};
 const sessions=[alice,bob];
 const accounts=new Map([[1001,{accountId:10}],[1002,{accountId:20}]]);
 const inventory=new Map([[1001,{itemID:501,ownerID:1001}],
  [1002,{itemID:502,ownerID:1002}]]);
 const authority={getSessions:()=>sessions.filter(s=>!s.socket.destroyed),
  getCharacterRecord:id=>accounts.get(id),getActiveShipRecord:id=>inventory.get(id)};
 const check=(session,ship=hulls.get(session._space.shipID))=>admission(session,ship,()=>scene,authority).status;
 return {alice,bob,hulls,scene,sessions,accounts,inventory,authority,check};
}
test('two independently authenticated pilots have distinct native custody',()=>{
 const f=fixture();
 assert.equal(f.check(f.alice),'ADMITTED_NATIVE_SESSION');
 assert.equal(f.check(f.bob),'ADMITTED_NATIVE_SESSION');
});
test('foreign account and missing authenticated userid fail closed',()=>{
 const f=fixture();f.alice.userid=20;
 assert.equal(f.check(f.alice),'WRONG_ACCOUNT_OWNER');
 f.alice.userid=0;
 assert.equal(f.check(f.alice),'WRONG_ACCOUNT_OWNER');
});
test('inventory ship must equal selected active hull and be owned by character',()=>{
 const f=fixture();f.inventory.get(1001).itemID=502;
 assert.equal(f.check(f.alice),'WRONG_ACTIVE_SHIP_OWNER');
 f.inventory.get(1001).itemID=501;f.inventory.get(1001).ownerID=1002;
 assert.equal(f.check(f.alice),'WRONG_ACTIVE_SHIP_OWNER');
});
test('ship swap is blocked until both native inventory and Ballpark agree',()=>{
 const f=fixture();f.inventory.set(1001,{itemID:503,ownerID:1001});
 f.hulls.set(503,{kind:'ship',itemID:503,session:f.alice});
 f.alice.shipID=503;
 assert.equal(f.check(f.alice),'REPLACED_OR_WRONG_SYSTEM_SHIP');
 f.alice._space.shipID=503;
 assert.equal(f.check(f.alice),'ADMITTED_NATIVE_SESSION');
});
test('a physical ship bound to a different session cannot be admitted',()=>{
 const f=fixture();f.hulls.get(501).session=f.bob;
 assert.equal(f.check(f.alice),'WRONG_PHYSICAL_SESSION');
});
test('live duplicate character in global registry blocks even across scenes',()=>{
 const f=fixture();const ghost={...f.alice,clientID:203,socket:{destroyed:false},
  _space:{shipID:999,systemID:30000142,initialStateSent:true}};
 f.sessions.push(ghost);
 assert.equal(f.check(f.alice),'AMBIGUOUS_GLOBAL_CHARACTER_SESSION');
 ghost.socket.destroyed=true;
 assert.equal(f.check(f.alice),'ADMITTED_NATIVE_SESSION');
});
test('live duplicate hull in global registry blocks regardless of account',()=>{
 const f=fixture();const ghost={...f.bob,clientID:203,characterID:1003,socket:{destroyed:false},
  _space:{shipID:501,systemID:30000142,initialStateSent:true}};
 f.sessions.push(ghost);
 assert.equal(f.check(f.alice),'AMBIGUOUS_GLOBAL_SHIP_OWNER');
});
test('a ghost removed from global registry cannot use a stale Ballpark scene',()=>{
 const f=fixture();f.sessions.splice(0,1);
 assert.equal(f.check(f.alice),'SESSION_NOT_IN_NATIVE_REGISTRY');
 assert.equal(f.check(f.bob),'ADMITTED_NATIVE_SESSION');
});
test('disconnected A never changes the remaining B and reconnect returns only when native scene moves',()=>{
 const f=fixture();f.alice.socket.destroyed=true;
 assert.equal(f.check(f.alice),'STALE_SESSION');
 assert.equal(f.check(f.bob),'ADMITTED_NATIVE_SESSION');
 const next={...f.alice,socket:{destroyed:false},clientID:204,
  _space:{...f.alice._space}};
 f.sessions.push(next);
 assert.equal(f.check(next),'SESSION_NOT_IN_NATIVE_SCENE');
 f.scene.sessions.delete(201);f.scene.sessions.set(204,next);
 f.hulls.get(501).session=next;
 assert.equal(f.check(next),'ADMITTED_NATIVE_SESSION');
 assert.equal(f.check(f.bob),'ADMITTED_NATIVE_SESSION');
});
test('missing or throwing native authority never silently admits',()=>{
 const f=fixture();
 assert.equal(admission(f.alice,f.hulls.get(501),()=>f.scene,{}).status,'AUTHORITY_UNAVAILABLE');
 assert.equal(admission(f.alice,f.hulls.get(501),()=>f.scene,{
  ...f.authority,getCharacterRecord:()=>{throw Error('native DB down')}}).status,'AUTHORITY_UNAVAILABLE');
});
test('scene membership and connected native readiness remain mandatory',()=>{
 const f=fixture();f.alice._space.initialStateSent=false;
 assert.equal(f.check(f.alice),'PENDING_BALLPARK');
 f.alice._space.initialStateSent=true;f.scene.sessions.delete(201);
 assert.equal(f.check(f.alice),'SESSION_NOT_IN_NATIVE_SCENE');
});
